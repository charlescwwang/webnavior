<script setup lang="ts">
import type { AiConnection } from '../../composables/useWebnaviorAiControl'

import { Button } from '@proj-airi/ui'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui'
import { onMounted, shallowRef } from 'vue'

import AiCapabilityBindings from '../../components/Webnavior/AiCapabilityBindings.vue'
import AiConnectionForm from '../../components/Webnavior/AiConnectionForm.vue'

import { useWebnaviorAiControl } from '../../composables/useWebnaviorAiControl'
import { useWebnaviorNotice } from '../../composables/useWebnaviorNotice'

const aiControl = useWebnaviorAiControl()
const notice = useWebnaviorNotice()
const editingConnection = shallowRef<AiConnection>()
const pendingDeletion = shallowRef<AiConnection>()

async function createConnection(input: Parameters<typeof aiControl.createConnection>[0]) {
  try {
    await aiControl.createConnection(input)
    editingConnection.value = undefined
    notice.success('服務連線已儲存。請接著讀取模型清單。')
  }
  catch {}
}

async function updateConnection(input: Parameters<typeof aiControl.updateConnection>[1] & { id: string }) {
  try {
    const { id, ...connection } = input
    await aiControl.updateConnection(id, connection)
    editingConnection.value = undefined
    notice.success('服務連線已更新。若已變更網址或服務類型，請重新讀取模型清單後再套用。')
  }
  catch {}
}

async function refreshModels(connectionId: string) {
  try {
    await aiControl.refreshModels(connectionId)
    notice.success('模型清單已更新。現在可指派給 Kiosk 能力。')
  }
  catch {}
}

async function removeConnection() {
  if (!pendingDeletion.value)
    return
  try {
    await aiControl.deleteConnection(pendingDeletion.value.id)
    pendingDeletion.value = undefined
    notice.success('服務連線已移除。')
  }
  catch {}
}

async function saveBinding(input: Parameters<typeof aiControl.saveBinding>[0]) {
  try {
    await aiControl.saveBinding(input)
    notice.success('能力模型已儲存；完成其他選擇後再套用。')
  }
  catch {}
}

async function apply() {
  try {
    const result = await aiControl.apply()
    notice.success(`已套用 ${result.appliedCapabilities.length} 項 Kiosk AI 能力；下一次請求會使用新設定。`)
  }
  catch {}
}

onMounted(aiControl.load)
</script>

<template>
  <div :class="['flex max-w-5xl flex-col gap-6']">
    <section>
      <p :class="['mb-2 mt-0 text-sm font-semibold tracking-wide text-cyan-700 dark:text-cyan-300']">
        Webnavior 系統管理
      </p>
      <h1 :class="['m-0 text-2xl font-bold text-slate-950 dark:text-white']">
        Kiosk AI 服務
      </h1>
      <p :class="['mb-0 mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300']">
        管理服務連線、讀取模型，並分別指派 Kiosk 的對話、視覺、語音與語意判斷能力。這裡是唯一的模型設定來源。
      </p>
    </section>

    <p v-if="aiControl.error.value" :class="['m-0 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200']">
      {{ aiControl.error.value }}
    </p>

    <AiConnectionForm
      :busy="aiControl.busy.value"
      :connection="editingConnection"
      @cancel="editingConnection = undefined"
      @create="createConnection"
      @update="updateConnection"
    />

    <section :class="['flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900']">
      <div :class="['flex flex-wrap items-start justify-between gap-3']">
        <div>
          <h2 :class="['m-0 text-lg font-semibold text-slate-950 dark:text-white']">
            已儲存的服務
          </h2>
          <p :class="['mb-0 mt-1 text-sm text-slate-600 dark:text-slate-300']">
            每次讀取模型清單都由 Server 使用已加密保存的 Key；Key 不會回傳到瀏覽器。
          </p>
        </div>
        <Button :disabled="aiControl.busy.value" @click="aiControl.load">
          重新整理
        </Button>
      </div>

      <p v-if="!aiControl.connections.value.length && !aiControl.busy.value" :class="['m-0 text-sm text-slate-500 dark:text-slate-400']">
        尚未建立 AI 服務連線。
      </p>
      <article v-for="connection in aiControl.connections.value" :key="connection.id" :class="['flex flex-col gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800']">
        <div :class="['flex flex-wrap items-start justify-between gap-3']">
          <div>
            <h3 :class="['m-0 text-base font-semibold text-slate-900 dark:text-white']">
              {{ connection.name }}
            </h3>
            <p :class="['mb-0 mt-1 break-all text-sm text-slate-600 dark:text-slate-300']">
              {{ connection.kind }} · {{ connection.baseURL }} · {{ connection.hasApiKey ? '已保存 API Key' : '未使用 API Key' }}
            </p>
          </div>
          <div :class="['flex flex-wrap gap-2']">
            <Button :disabled="aiControl.busy.value" @click="editingConnection = connection">
              編輯
            </Button>
            <Button :disabled="aiControl.busy.value" @click="refreshModels(connection.id)">
              讀取模型
            </Button>
            <Button :disabled="aiControl.busy.value" @click="pendingDeletion = connection">
              移除
            </Button>
          </div>
        </div>
        <p v-if="connection.lastCheckError" :class="['m-0 text-sm text-red-600 dark:text-red-300']">
          上次讀取失敗：{{ connection.lastCheckError }}
        </p>
        <p :class="['m-0 text-sm text-slate-600 dark:text-slate-300']">
          {{ connection.discoveredModels.length ? `已讀取 ${connection.discoveredModels.length} 個模型：${connection.discoveredModels.map(model => model.id).join('、')}` : '尚未讀取模型清單。' }}
        </p>
      </article>
    </section>

    <AiCapabilityBindings
      :bindings="aiControl.bindings.value"
      :busy="aiControl.busy.value"
      :connections="aiControl.connections.value"
      @apply="apply"
      @save="saveBinding"
    />

    <AlertDialogRoot :open="Boolean(pendingDeletion)" @update:open="open => !open && (pendingDeletion = undefined)">
      <AlertDialogPortal>
        <AlertDialogOverlay :class="['fixed inset-0 z-100 bg-black/50']" />
        <AlertDialogContent :class="['fixed left-1/2 top-1/2 z-100 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900']" @interact-outside.prevent>
          <AlertDialogTitle :class="['text-xl font-semibold text-slate-950 dark:text-white']">
            移除 AI 服務連線？
          </AlertDialogTitle>
          <AlertDialogDescription :class="['mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300']">
            「{{ pendingDeletion?.name }}」若仍被任何能力使用，系統會拒絕移除；請先改綁定其他服務。
          </AlertDialogDescription>
          <div :class="['mt-6 flex justify-end gap-3']">
            <AlertDialogCancel as-child>
              <Button :disabled="aiControl.busy.value">
                取消
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction as-child>
              <Button :disabled="aiControl.busy.value" @click="removeConnection">
                確認移除
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialogRoot>
  </div>
</template>
