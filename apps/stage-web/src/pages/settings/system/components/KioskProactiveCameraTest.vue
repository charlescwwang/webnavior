<script setup lang="ts">
import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { ProactiveInteractionDecision, ProactiveInteractionSettings } from '@proj-airi/kiosk-proactive'
import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { Message } from '@xsai/shared-chat'

import { errorMessageFrom } from '@moeru/std'
import { createAttentionObservation, createInteractionWindow, defaultDetectionZone } from '@proj-airi/kiosk-proactive'
import { useLLM } from '@proj-airi/stage-ui/stores/llm'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  settings: ProactiveInteractionSettings
}>()

const modelAssetPath = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const wasmRoot = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm'
const detectionIntervalMs = 200

const video = useTemplateRef<HTMLVideoElement>('video')
const llm = useLLM()
const providers = useProvidersStore()
const { activeModel, activeProvider } = storeToRefs(useConsciousnessStore())
const status = shallowRef<'idle' | 'previewing' | 'starting' | 'observing' | 'failed'>('idle')
const error = shallowRef('')
const decisionLabel = shallowRef('尚未開始觀測。')
const greeting = shallowRef('')
const greetingInFlight = shallowRef(false)
const detectedFaceCount = shallowRef(0)
const presencePeople = shallowRef(0)
const attendingPeople = shallowRef(0)
const previewActive = shallowRef(false)
let cameraStream: MediaStream | undefined
let faceLandmarker: FaceLandmarker | undefined
let animationFrame: number | undefined
let lastDetectionAtMs = -Infinity
let running = false
let interactionWindow = createInteractionWindow(props.settings)

const canStart = computed(() => props.settings.enabled && previewActive.value && status.value !== 'starting' && status.value !== 'observing')
const statusLabel = computed(() => ({
  idle: props.settings.enabled ? '正在等待開啟 webcam 預覽。' : '請先在上方啟用主動互動。',
  previewing: '正在顯示本機 webcam 預覽；尚未開始偵測。',
  starting: '正在載入本機偵測模型…',
  observing: '正在本機觀測；畫面不會上傳或保存。',
  failed: error.value || '無法啟動相機測試。',
}[status.value]))

watch(() => props.settings, () => {
  interactionWindow = createInteractionWindow(props.settings)
  decisionLabel.value = '設定已更新，互動視窗已重設。'
}, { deep: true })

watch(() => props.settings.enabled, (enabled) => {
  if (enabled)
    void startPreview()
  else
    stopPreview()
})

async function startPreview() {
  if (cameraStream || !video.value || !props.settings.enabled)
    return

  if (!navigator.mediaDevices?.getUserMedia) {
    status.value = 'failed'
    error.value = '此瀏覽器不支援相機存取。'
    return
  }

  status.value = 'starting'
  error.value = ''
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    })
    if (!props.settings.enabled) {
      // The permission prompt may resolve after the user turns the feature off.
      // Do not leave a newly granted camera stream running in that case.
      cameraStream.getTracks().forEach(track => track.stop())
      cameraStream = undefined
      status.value = 'idle'
      return
    }
    video.value.srcObject = cameraStream
    await video.value.play()
    previewActive.value = true
    status.value = 'previewing'
  }
  catch (cause) {
    status.value = 'failed'
    error.value = errorMessageFrom(cause) ?? '無法開啟 webcam 預覽。'
  }
}

async function start() {
  if (!props.settings.enabled || !video.value)
    return

  if (!cameraStream)
    await startPreview()
  if (!cameraStream || !canStart.value)
    return

  running = true
  status.value = 'starting'
  error.value = ''
  greeting.value = ''
  detectedFaceCount.value = 0
  presencePeople.value = 0
  attendingPeople.value = 0
  interactionWindow = createInteractionWindow(props.settings)

  try {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(wasmRoot)
    const nextFaceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath },
      runningMode: 'VIDEO',
      numFaces: 4,
      minFaceDetectionConfidence: 0.6,
      minFacePresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    })

    if (!running) {
      nextFaceLandmarker.close()
      return
    }

    faceLandmarker = nextFaceLandmarker
    status.value = 'observing'
    scheduleNextFrame()
  }
  catch (cause) {
    stopDetection()
    status.value = 'failed'
    error.value = errorMessageFrom(cause) ?? '無法啟動本機偵測。'
  }
}

function stopDetection() {
  running = false
  if (animationFrame != null)
    cancelAnimationFrame(animationFrame)
  animationFrame = undefined
  faceLandmarker?.close()
  faceLandmarker = undefined
  if (previewActive.value)
    status.value = 'previewing'
  else if (status.value !== 'failed')
    status.value = 'idle'
}

function stopPreview() {
  stopDetection()
  cameraStream?.getTracks().forEach(track => track.stop())
  cameraStream = undefined
  previewActive.value = false
  if (video.value)
    video.value.srcObject = null
  status.value = 'idle'
}

function scheduleNextFrame() {
  animationFrame = requestAnimationFrame(detectFrame)
}

function detectFrame(nowMs: number) {
  if (!running || !faceLandmarker || !video.value)
    return

  if (nowMs - lastDetectionAtMs >= detectionIntervalMs && video.value.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    lastDetectionAtMs = nowMs
    const result = faceLandmarker.detectForVideo(video.value, nowMs)
    const faces = result.faceLandmarks.map(toFaceLandmarkObservation)
    const observation = createAttentionObservation(
      nowMs,
      faces,
      defaultDetectionZone,
    )
    detectedFaceCount.value = faces.length
    presencePeople.value = observation.presencePeople
    attendingPeople.value = observation.attendingPeople
    const decision = interactionWindow.decide(observation)
    decisionLabel.value = decision.shouldGreet
      ? `命中招呼：偵測區內 ${decision.triggeringPeople} 人。`
      : `觀測結果：${decision.reason}；觸發人數 ${decision.triggeringPeople}。`

    if (decision.shouldGreet)
      void requestGreeting(decision)
  }

  scheduleNextFrame()
}

async function requestGreeting(decision: ProactiveInteractionDecision) {
  if (greetingInFlight.value)
    return

  if (!decision.greetingTrigger)
    return

  greetingInFlight.value = true
  greeting.value = ''
  try {
    const chatProvider = await providers.getProviderInstance<ChatProvider>(activeProvider.value)
    if (!chatProvider || !activeModel.value)
      throw new Error('尚未完成對話 Provider 與模型設定。')

    const messages: Message[] = [
      {
        role: 'system',
        content: decision.greetingTrigger === 'attention'
          ? props.settings.attentionGreetingPrompt
          : props.settings.presenceGreetingPrompt,
      },
      { role: 'user', content: `匿名現場訊號：目前偵測區內約有 ${decision.triggeringPeople} 人，觸發方式為${decision.greetingTrigger === 'attention' ? '看向 kiosk' : '經過偵測區'}。請產生現在應說的主動招呼。` },
    ]
    let buffer = ''
    await llm.stream(activeModel.value, chatProvider, messages, {
      onStreamEvent(event) {
        if (event.type === 'text-delta')
          buffer += event.text
      },
    })
    greeting.value = buffer.trim() || 'Provider 未回傳文字招呼。'
  }
  catch (cause) {
    greeting.value = `招呼測試失敗：${errorMessageFrom(cause) ?? '未知錯誤'}`
  }
  finally {
    greetingInFlight.value = false
  }
}

function toFaceLandmarkObservation(landmarks: NormalizedLandmark[]) {
  const leftEye = landmarks[33]
  const rightEye = landmarks[263]
  const nose = landmarks[1]
  const centre = landmarks[10] ?? nose
  if (!leftEye || !rightEye || !nose || !centre)
    return { centre: { x: 0, y: 0 }, facesCamera: false }

  const eyeMidpoint = (leftEye.x + rightEye.x) / 2
  const eyeDistance = Math.abs(rightEye.x - leftEye.x)
  return {
    centre: { x: centre.x, y: centre.y },
    // This POC deliberately accepts a moderately turned face. The setting is
    // intended to distinguish a person facing the kiosk from a passerby, not
    // to make a biometric identity or gaze-direction claim.
    facesCamera: eyeDistance > 0.015 && Math.abs(nose.x - eyeMidpoint) / eyeDistance <= 0.55,
  }
}

onMounted(() => {
  if (props.settings.enabled)
    void startPreview()
})

onUnmounted(stopPreview)
</script>

<template>
  <section :class="['rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800']">
    <div :class="['flex flex-wrap items-start justify-between gap-4']">
      <div>
        <h3 :class="['m-0 text-base font-semibold']">
          Webcam 預覽與主動互動測試
        </h3>
        <p :class="['mb-0 mt-1 text-sm text-neutral-600 dark:text-neutral-300']">
          啟用後會顯示小型本機 webcam 預覽；確認取景後，再開始驗證觸發規則與選定 Provider 的招呼。不會寫入聊天紀錄。
        </p>
      </div>
      <div :class="['flex gap-2']">
        <Button :disabled="!canStart" :loading="status === 'starting'" @click="start">
          開始偵測
        </Button>
        <Button v-if="status === 'observing'" variant="secondary" @click="stopDetection">
          停止偵測
        </Button>
        <Button v-if="previewActive" variant="secondary" @click="stopPreview">
          關閉鏡頭
        </Button>
        <Button v-else-if="settings.enabled" variant="secondary" :loading="status === 'starting'" @click="startPreview">
          開啟鏡頭
        </Button>
      </div>
    </div>

    <div :class="['mt-4 flex flex-wrap gap-4']">
      <div :class="['relative aspect-video w-full max-w-sm overflow-hidden rounded-xl bg-black']">
        <video ref="video" :class="['h-full w-full object-cover', '-scale-x-100']" autoplay muted playsinline />
        <div v-if="!previewActive" :class="['absolute inset-0 grid place-items-center bg-black/70 px-6 text-center text-sm text-white/80']">
          {{ settings.enabled ? '正在等待 webcam 連線，或點擊「開啟鏡頭」。' : '啟用主動互動後，這裡會顯示 webcam 預覽。' }}
        </div>
        <div :class="['pointer-events-none absolute border-2 border-primary-400', 'left-[20%] top-[15%] h-[70%] w-[60%] rounded-lg']" />
        <span :class="['absolute left-3 top-3 rounded-md bg-black/70 px-2 py-1 text-xs text-white']">
          臉 {{ detectedFaceCount }} · 區內 {{ presencePeople }} · 看向 {{ attendingPeople }}
        </span>
      </div>
      <div :class="['min-w-60 flex flex-1 flex-col gap-3 rounded-xl bg-neutral-100 p-4 dark:bg-neutral-900/60']">
        <p :class="['m-0 text-sm font-medium']">
          {{ statusLabel }}
        </p>
        <p :class="['m-0 text-sm text-neutral-600 dark:text-neutral-300']">
          {{ decisionLabel }}
        </p>
        <div v-if="greeting || greetingInFlight" :class="['rounded-lg bg-primary-50 p-3 text-sm dark:bg-primary-950/30']">
          <p :class="['m-0 text-xs font-semibold text-primary-700 dark:text-primary-300']">
            Provider 測試招呼
          </p>
          <p :class="['mb-0 mt-1 whitespace-pre-wrap']">
            {{ greetingInFlight ? '正在產生招呼…' : greeting }}
          </p>
        </div>
      </div>
    </div>
  </section>
</template>
