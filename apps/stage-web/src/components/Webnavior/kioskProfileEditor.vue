<script setup lang="ts">
import type { KioskProfileDraft, KioskSiteManagementCapabilities } from '../../composables/useKioskManagement'

import { Button, FieldCheckbox, Input, Select, Textarea } from '@proj-airi/ui'
import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ExperienceEditorSection from './experienceEditorSection.vue'
import KioskCharacterPackageActions from './kioskCharacterPackageActions.vue'
import OrderingSitesEditor from './orderingSitesEditor.vue'

import { greetingPhraseLimits } from '../../../../server/src/services/domain/kiosk/interactionContracts'

type MotionSlot = 'acknowledge' | 'greeting' | 'idle' | 'listening' | 'presentRecommendations' | 'thinking'

const props = withDefaults(defineProps<{
  allowAssetUpload?: boolean
  busy: boolean
  capabilities?: KioskSiteManagementCapabilities
  draft: KioskProfileDraft
  proactiveVlmEnabled?: boolean
}>(), {
  // Templates edit both banks before a Site exists to own a mode setting.
  proactiveVlmEnabled: undefined,
  // Files belong to a Site; system templates explicitly disable uploads.
  allowAssetUpload: true,
})

const emit = defineEmits<{
  save: [input: { draft: KioskProfileDraft, publish: boolean }]
  uploadAvatar: [file: File, draft: KioskProfileDraft]
  uploadBackground: [file: File, draft: KioskProfileDraft]
  uploadMotion: [input: { file: File, slot: MotionSlot, draft: KioskProfileDraft }]
  uploadRoleCard: [file: File, draft: KioskProfileDraft]
  downloadCharacterPackage: [draft: KioskProfileDraft]
  uploadCharacterPackage: [file: File, draft: KioskProfileDraft]
  updateProactiveVlm: [enabled: boolean]
}>()

const motionSlots: Array<{ description: string, key: MotionSlot, label: string }> = [
  { key: 'idle', label: '待機動作', description: '顧客尚未互動時循環播放。' },
  { key: 'greeting', label: '招呼客人', description: 'Kiosk 主動開口招呼客人時播放一次。' },
  { key: 'listening', label: '聆聽顧客', description: '顧客說話或輸入時循環播放。' },
  { key: 'thinking', label: '思考／查詢中', description: '辨識、LLM 或工具處理時循環播放。' },
  { key: 'presentRecommendations', label: '展示推薦', description: '推薦餐點實際顯示在畫面時播放一次。' },
  { key: 'acknowledge', label: '確認選擇', description: '加入購物車或確認餐點時播放一次。' },
]

function cloneDraft(draft: KioskProfileDraft): KioskProfileDraft {
  return {
    ...draft,
    snapshot: {
      ...draft.snapshot,
      ...(draft.snapshot.characterAsset ? { characterAsset: { ...draft.snapshot.characterAsset } } : {}),
      ...(draft.snapshot.sceneBackground ? { sceneBackground: { ...draft.snapshot.sceneBackground } } : {}),
      ...(draft.snapshot.idleMotion ? { idleMotion: { ...draft.snapshot.idleMotion } } : {}),
      ...(draft.snapshot.motionPack ? { motionPack: { ...draft.snapshot.motionPack } } : {}),
      ...(draft.snapshot.characterCard ? { characterCard: { ...draft.snapshot.characterCard } } : {}),
      ...(draft.snapshot.greetingPhrases ? { greetingPhrases: [...draft.snapshot.greetingPhrases] } : {}),
      interactiveService: { ...draft.snapshot.interactiveService, ...(draft.snapshot.interactiveService.catalogLabels ? { catalogLabels: draft.snapshot.interactiveService.catalogLabels.map(label => ({ ...label, aliases: [...label.aliases] })) } : {}) },
      orderingSites: (draft.snapshot.orderingSites ?? []).map(site => ({ ...site, ...(site.catalogLabels ? { catalogLabels: site.catalogLabels.map(label => ({ ...label, aliases: [...label.aliases] })) } : {}) })),
    },
  }
}

const form = reactive<KioskProfileDraft>(cloneDraft(props.draft))
const { t } = useI18n()
const greetingPhrases = computed({
  get: () => (form.snapshot.greetingPhrases ?? [
    t('stage.kiosk.welcome.first'),
    t('stage.kiosk.welcome.second'),
    t('stage.kiosk.welcome.third'),
  ]).join('\n'),
  set: (value: string) => {
    const phrases = value.split('\n').map(line => line.trim()).filter(Boolean)
    form.snapshot.greetingPhrases = phrases.length ? phrases : undefined
  },
})

const greetingPhraseCount = computed(() => greetingPhrases.value.split('\n').length)
const greetingPhraseError = computed(() => {
  if (greetingPhraseCount.value > greetingPhraseLimits.count)
    return t('stage.kiosk.welcome.too-many', { count: greetingPhraseCount.value, limit: greetingPhraseLimits.count })
  if (greetingPhrases.value.split('\n').some(phrase => phrase.length > greetingPhraseLimits.characters))
    return t('stage.kiosk.welcome.too-long', { limit: greetingPhraseLimits.characters })
  return undefined
})

watch(() => props.draft, draft => Object.assign(form, cloneDraft(draft)))

function save(publish: boolean) {
  emit('save', { draft: cloneDraft(form), publish })
}

function selectAvatar(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.item(0)
  if (file)
    emit('uploadAvatar', file, cloneDraft(form))
  input.value = ''
}

function selectBackground(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.item(0)
  if (file)
    emit('uploadBackground', file, cloneDraft(form))
  input.value = ''
}

function selectRoleCard(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.item(0)
  if (file)
    emit('uploadRoleCard', file, cloneDraft(form))
  input.value = ''
}

function selectMotion(slot: MotionSlot, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.item(0)
  if (file)
    emit('uploadMotion', { file, slot, draft: cloneDraft(form) })
  input.value = ''
}
</script>

<template>
  <section :class="['flex flex-col gap-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm', 'dark:border-slate-800 dark:bg-slate-900']">
    <div>
      <h2 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
        Kiosk 設定
      </h2>
      <p :class="['mb-0 mt-1 text-sm text-slate-500 dark:text-slate-400']">
        {{ props.capabilities?.canEditExperience ? '儲存只會更新體驗草稿；發布後才會套用到此店別的設備。' : '你可以查看此店別目前的互動體驗，但沒有編輯權限。' }}
      </p>
    </div>

    <ExperienceEditorSection initially-open title="基本資訊" description="用於在管理端辨識這份互動體驗。">
      <label v-if="props.capabilities?.canEditTechnicalSettings" :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
        內部識別名稱
        <Input v-model="form.name" :disabled="busy || !props.capabilities?.canEditExperience" placeholder="例如：午餐時段迎賓" />
        <span :class="['text-xs font-normal text-slate-500 dark:text-slate-400']">只供管理端辨識，不會顯示給顧客。</span>
      </label>
    </ExperienceEditorSection>

    <ExperienceEditorSection title="角色卡與虛擬角色" description="匯入角色卡可帶入角色文字，並將 VRM 或 Live2D 模型保存到 Server；發布後 Kiosk 會自動下載及快取。">
      <KioskCharacterPackageActions
        v-if="props.capabilities?.canEditExperience && props.allowAssetUpload"
        :busy="busy"
        @download="emit('downloadCharacterPackage', cloneDraft(form))"
        @upload="emit('uploadCharacterPackage', $event, cloneDraft(form))"
      />
      <div v-if="props.capabilities?.canEditExperience && props.allowAssetUpload !== false" :class="['grid gap-4 sm:grid-cols-2']">
        <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
          匯入角色卡
          <input type="file" accept=".zip" :class="['block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-cyan-700 file:px-3 file:py-2 file:font-semibold file:text-white hover:file:bg-cyan-800 dark:text-slate-300']" :disabled="busy" @change="selectRoleCard">
          <span :class="['text-xs font-normal text-slate-500 dark:text-slate-400']">{{ t('stage.kiosk.character-editor.card-package') }}</span>
        </label>
        <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
          更換虛擬角色
          <input type="file" accept=".vrm,.zip" :class="['block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:font-semibold file:text-white hover:file:bg-slate-800 dark:text-slate-300']" :disabled="busy" @change="selectAvatar">
          <span :class="['text-xs font-normal text-slate-500 dark:text-slate-400']">只更換顧客看到的 VRM 或 Live2D，不會變更角色卡文字內容。</span>
        </label>
      </div>
      <div v-if="form.snapshot.characterAsset" :class="['rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950/40']">
        <span :class="['font-semibold text-slate-900 dark:text-white']">目前虛擬角色：</span>
        <span :class="['text-slate-600 dark:text-slate-300']">{{ form.snapshot.characterAsset.name }}（{{ form.snapshot.characterAsset.format === 'vrm' ? 'VRM' : 'Live2D' }}）</span>
      </div>
      <p v-else :class="['m-0 text-sm text-slate-600 dark:text-slate-300']">
        {{ t('stage.kiosk.character-editor.builtin') }}
      </p>
      <p v-if="props.capabilities?.canEditExperience && props.allowAssetUpload" :class="['m-0 text-xs text-slate-500 dark:text-slate-400']">
        {{ t('stage.kiosk.character-editor.publish-hint') }}
      </p>
      <div v-if="props.capabilities?.canEditExperience && props.allowAssetUpload && form.snapshot.characterAsset?.format === 'vrm'" :class="['grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30']">
        <div>
          <p :class="['m-0 text-sm font-semibold text-amber-950 dark:text-amber-100']">
            角色動作包
          </p>
          <p :class="['mb-0 mt-1 text-xs text-amber-900 dark:text-amber-200']">
            依檔名可協助辨識，但請確認每個欄位的動作角色。
          </p>
        </div>
        <label v-for="slot in motionSlots" :key="slot.key" :class="['flex flex-col gap-1 text-sm font-medium text-slate-700 dark:text-slate-200']">
          {{ slot.label }}
          <input type="file" accept=".vrma" :disabled="busy" @change="selectMotion(slot.key, $event)">
          <span :class="['text-xs font-normal text-slate-500 dark:text-slate-400']">{{ form.snapshot.motionPack?.[slot.key]?.name ?? slot.description }}</span>
        </label>
      </div>
      <div v-if="form.snapshot.characterCard" :class="['grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40']">
        <p :class="['m-0 text-sm font-semibold text-slate-900 dark:text-white']">
          已匯入角色卡內容
        </p>
        <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
          角色介紹
          <Textarea v-model="form.snapshot.characterCard.description" :disabled="busy || !props.capabilities?.canEditExperience" :rows="4" />
        </label>
        <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
          個性與語氣
          <Textarea v-model="form.snapshot.characterCard.personality" :disabled="busy || !props.capabilities?.canEditExperience" :rows="4" />
        </label>
        <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
          服務情境
          <Textarea v-model="form.snapshot.characterCard.scenario" :disabled="busy || !props.capabilities?.canEditExperience" :rows="4" />
        </label>
        <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
          角色系統指示
          <Textarea v-model="form.snapshot.characterCard.systemPrompt" :disabled="busy || !props.capabilities?.canEditExperience" :rows="7" />
        </label>
        <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
          持續互動原則
          <Textarea v-model="form.snapshot.characterCard.postHistoryInstructions" :disabled="busy || !props.capabilities?.canEditExperience" :rows="5" />
        </label>
      </div>
      <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
        顧客看到的服務員名稱
        <Input v-model="form.snapshot.characterName" :disabled="busy || !props.capabilities?.canEditExperience" placeholder="例如：店務助手" />
      </label>
      <label v-if="props.capabilities?.canEditTechnicalSettings" :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
        店別補充指示（選填）
        <Textarea v-model="form.snapshot.agentInstructions" :disabled="busy || !props.capabilities?.canEditExperience" :rows="5" placeholder="例如：以親切、簡潔的口吻協助顧客；不確定時主動說明限制。" />
        <span :class="['text-xs font-normal text-slate-500 dark:text-slate-400']">這些內容會加在角色卡指示之後，可用來補充本店的營運規則；沒有額外規則時可以留空。</span>
      </label>
    </ExperienceEditorSection>

    <ExperienceEditorSection title="服務場景" description="未設定圖片時，Kiosk 會使用內建的柔和櫃台氛圍；上傳後，圖片會顯示在服務員後方。">
      <label v-if="props.capabilities?.canEditExperience && props.allowAssetUpload !== false" :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
        自訂場景背景
        <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" :class="['block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-amber-700 file:px-3 file:py-2 file:font-semibold file:text-white hover:file:bg-amber-800 dark:text-slate-300']" :disabled="busy" @change="selectBackground">
        <span :class="['text-xs font-normal text-slate-500 dark:text-slate-400']">支援 PNG、JPEG、WebP，最大 12 MB。建議使用沒有文字的店內、櫃台或品牌氛圍圖片。</span>
      </label>
      <p :class="['m-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300']">
        {{ form.snapshot.sceneBackground ? `目前場景背景：${form.snapshot.sceneBackground.name}` : '目前使用內建櫃台氛圍。' }}
      </p>
    </ExperienceEditorSection>

    <ExperienceEditorSection title="對話行為" description="設定顧客開始互動時會看到的文字。">
      <FieldCheckbox
        v-model="form.snapshot.voiceConversationOnly"
        :disabled="busy || !props.capabilities?.canEditExperience"
        label="僅允許語音對話"
        description="啟用後，已設定 ASR 與 TTS 的 Kiosk 不會顯示文字輸入欄，顧客只能透過麥克風說話。"
      />
      <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
        停留提醒
        <Textarea v-model="form.snapshot.assistanceReminderPrompt" :disabled="busy || !props.capabilities?.canEditExperience" :rows="3" />
      </label>
    </ExperienceEditorSection>

    <ExperienceEditorSection initially-open :title="t('stage.kiosk.welcome.section-title')" :description="props.proactiveVlmEnabled === undefined ? t('stage.kiosk.welcome.content-description') : t('stage.kiosk.welcome.section-description')">
      <label v-if="props.proactiveVlmEnabled !== undefined" :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
        {{ t('stage.kiosk.welcome.mode-label') }}
        <Select
          :model-value="props.proactiveVlmEnabled ? 'vlm' : 'fixed'"
          :options="[
            { label: t('stage.kiosk.welcome.mode-fixed'), value: 'fixed' },
            { label: t('stage.kiosk.welcome.mode-vlm'), value: 'vlm' },
          ]"
          :disabled="busy || !props.capabilities?.canEditTechnicalSettings"
          @update:model-value="emit('updateProactiveVlm', $event === 'vlm')"
        />
        <span :class="['text-xs font-normal text-slate-500 dark:text-slate-400']">{{ t('stage.kiosk.welcome.mode-save-hint') }}</span>
        <span :class="['text-xs font-normal text-slate-500 dark:text-slate-400']">{{ t('stage.kiosk.welcome.vlm-description') }}</span>
      </label>
      <label v-if="props.proactiveVlmEnabled !== true" :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
        {{ t('stage.kiosk.welcome.editor-label') }}
        <Textarea v-model="greetingPhrases" :disabled="busy || !props.capabilities?.canEditExperience" :rows="4" />
        <span :class="['text-xs font-normal text-slate-500 dark:text-slate-400']">{{ t('stage.kiosk.welcome.count', { count: greetingPhraseCount, limit: greetingPhraseLimits.count }) }}</span>
        <span :class="['text-xs font-normal text-slate-500 dark:text-slate-400']">{{ t('stage.kiosk.welcome.editor-hint', { limit: greetingPhraseLimits.count, characters: greetingPhraseLimits.characters }) }}</span>
      </label>
      <p v-if="greetingPhraseError" role="alert" :class="['m-0 text-sm text-red-600 dark:text-red-400']">
        {{ greetingPhraseError }}
      </p>
      <label v-if="props.proactiveVlmEnabled !== false" :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
        {{ t('stage.kiosk.welcome.vlm-prompt-label') }}
        <Textarea v-model="form.snapshot.greetingPrompt" :disabled="busy || !props.capabilities?.canEditExperience" :rows="3" />
        <span :class="['text-xs font-normal text-slate-500 dark:text-slate-400']">{{ t('stage.kiosk.welcome.vlm-prompt-hint') }}</span>
      </label>
    </ExperienceEditorSection>

    <OrderingSitesEditor
      v-model="form.snapshot.orderingSites"
      v-model:default-site="form.snapshot.interactiveService"
      :disabled="busy"
      :can-edit="Boolean(props.capabilities?.canEditExperience)"
      :technical="Boolean(props.capabilities?.canEditTechnicalSettings)"
    />

    <ExperienceEditorSection v-if="props.capabilities?.canEditTechnicalSettings" title="回饋" description="互動結束後提供給顧客的回饋連結。">
      <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
        問卷網址
        <Input v-model="form.snapshot.surveyUrl" :disabled="busy || !props.capabilities?.canEditExperience" type="url" placeholder="https://example.com/feedback" />
      </label>
    </ExperienceEditorSection>

    <div v-if="props.capabilities?.canEditExperience" :class="['flex flex-wrap gap-3 border-t border-slate-200 pt-6 dark:border-slate-800']">
      <Button :disabled="busy || Boolean(greetingPhraseError)" @click="save(false)">
        儲存草稿
      </Button>
      <Button v-if="props.capabilities?.canPublishExperience" :disabled="busy || Boolean(greetingPhraseError)" @click="save(true)">
        發布到此店別
      </Button>
    </div>
  </section>
</template>
