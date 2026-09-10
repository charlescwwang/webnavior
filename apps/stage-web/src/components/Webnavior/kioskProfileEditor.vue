<script setup lang="ts">
import type { KioskProfileDraft, KioskSiteManagementCapabilities } from '../../composables/useKioskManagement'

import { Button, Input, Textarea } from '@proj-airi/ui'
import { reactive, watch } from 'vue'

import ExperienceEditorSection from './experienceEditorSection.vue'

const props = defineProps<{
  busy: boolean
  capabilities?: KioskSiteManagementCapabilities
  draft: KioskProfileDraft
}>()

const emit = defineEmits<{
  save: [input: { draft: KioskProfileDraft, publish: boolean }]
  uploadAvatar: [file: File]
  uploadRoleCard: [file: File]
}>()

function cloneDraft(draft: KioskProfileDraft): KioskProfileDraft {
  return {
    ...draft,
    snapshot: {
      ...draft.snapshot,
      ...(draft.snapshot.characterAsset ? { characterAsset: { ...draft.snapshot.characterAsset } } : {}),
      ...(draft.snapshot.characterCard ? { characterCard: { ...draft.snapshot.characterCard } } : {}),
      interactiveService: { ...draft.snapshot.interactiveService },
    },
  }
}

const form = reactive<KioskProfileDraft>(cloneDraft(props.draft))

watch(() => props.draft, draft => Object.assign(form, cloneDraft(draft)))

function save(publish: boolean) {
  emit('save', { draft: cloneDraft(form), publish })
}

function selectAvatar(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.item(0)
  if (file)
    emit('uploadAvatar', file)
  input.value = ''
}

function selectRoleCard(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.item(0)
  if (file)
    emit('uploadRoleCard', file)
  input.value = ''
}
</script>

<template>
  <section :class="['flex flex-col gap-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm', 'dark:border-slate-800 dark:bg-slate-900']">
    <div>
      <h2 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
        互動體驗內容
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
      <div v-if="props.capabilities?.canEditExperience" :class="['grid gap-4 sm:grid-cols-2']">
        <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
          匯入角色卡
          <input type="file" accept=".zip" :class="['block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-cyan-700 file:px-3 file:py-2 file:font-semibold file:text-white hover:file:bg-cyan-800 dark:text-slate-300']" :disabled="busy" @change="selectRoleCard">
          <span :class="['text-xs font-normal text-slate-500 dark:text-slate-400']">讀取 AIRI 角色卡 ZIP 的姓名、個性、情境與系統指示；若封包附帶模型，也會一併帶入。</span>
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
        店別補充指示
        <Textarea v-model="form.snapshot.agentInstructions" :disabled="busy || !props.capabilities?.canEditExperience" :rows="5" placeholder="例如：以親切、簡潔的口吻協助顧客；不確定時主動說明限制。" />
        <span :class="['text-xs font-normal text-slate-500 dark:text-slate-400']">這些內容會加在角色卡指示之後，可用來補充本店的營運規則。</span>
      </label>
    </ExperienceEditorSection>

    <ExperienceEditorSection title="對話行為" description="設定顧客開始互動時會看到的文字。">
      <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
        開場招呼
        <Textarea v-model="form.snapshot.greetingPrompt" :disabled="busy || !props.capabilities?.canEditExperience" :rows="3" />
      </label>
      <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
        停留提醒
        <Textarea v-model="form.snapshot.assistanceReminderPrompt" :disabled="busy || !props.capabilities?.canEditExperience" :rows="3" />
      </label>
    </ExperienceEditorSection>

    <ExperienceEditorSection title="互動服務" description="Kiosk 會在對話區下方內嵌此服務。">
      <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
        服務名稱
        <Input v-model="form.snapshot.interactiveService.title" :disabled="busy || !props.capabilities?.canEditExperience" placeholder="例如：線上點餐" />
      </label>
      <label v-if="props.capabilities?.canEditTechnicalSettings" :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
        服務網址
        <Input v-model="form.snapshot.interactiveService.url" :disabled="busy || !props.capabilities?.canEditExperience" type="url" placeholder="https://example.com/menu" />
      </label>
      <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
        說明
        <Textarea v-model="form.snapshot.interactiveService.description" :disabled="busy || !props.capabilities?.canEditExperience" :rows="2" />
      </label>
    </ExperienceEditorSection>

    <ExperienceEditorSection v-if="props.capabilities?.canEditTechnicalSettings" title="回饋" description="互動結束後提供給顧客的回饋連結。">
      <label :class="['flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200']">
        問卷網址
        <Input v-model="form.snapshot.surveyUrl" :disabled="busy || !props.capabilities?.canEditExperience" type="url" placeholder="https://example.com/feedback" />
      </label>
    </ExperienceEditorSection>

    <div v-if="props.capabilities?.canEditExperience" :class="['flex flex-wrap gap-3 border-t border-slate-200 pt-6 dark:border-slate-800']">
      <Button :disabled="busy" @click="save(false)">
        儲存草稿
      </Button>
      <Button v-if="props.capabilities?.canPublishExperience" :disabled="busy" @click="save(true)">
        發布到此店別
      </Button>
    </div>
  </section>
</template>
