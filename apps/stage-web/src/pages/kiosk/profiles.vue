<script setup lang="ts">
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
import { onMounted, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'

import KioskTechnicalSettingsEditor from '../../components/Webnavior/kioskModelPolicyEditor.vue'
import KioskProfileEditor from '../../components/Webnavior/kioskProfileEditor.vue'

import { useKioskManagement } from '../../composables/useKioskManagement'

const route = useRoute()
const deleteDialogOpen = shallowRef(false)
const {
  capabilities,
  createProfileDraft,
  deleteSelectedSite,
  devices,
  load,
  loading,
  message,
  profileDraft,
  profileDrafts,
  publishedExperience,
  save,
  saveProactiveVlmEnabled,
  savePerformanceProfile,
  saveVoiceVadSettings,
  saving,
  siteTechnicalSettings,
  selectedSite,
  selectedSiteId,
  selectSite,
  selectProfileDraft,
  sites,
  uploadCharacterAsset,
  uploadMotionAsset,
  uploadSceneBackgroundAsset,
} = useKioskManagement()

async function handleRoleCardUpload(file: File) {
  const uploaded = await uploadCharacterAsset(file, 'role_card')
  if (!profileDraft.value)
    return

  profileDraft.value = {
    ...profileDraft.value,
    snapshot: {
      ...profileDraft.value.snapshot,
      characterAsset: uploaded.asset,
      characterCard: {
        description: uploaded.card.description ?? '',
        personality: uploaded.card.personality ?? '',
        postHistoryInstructions: uploaded.card.post_history_instructions ?? '',
        scenario: uploaded.card.scenario ?? '',
        systemPrompt: uploaded.card.system_prompt ?? '',
      },
      characterName: uploaded.card.name || profileDraft.value.snapshot.characterName,
      greetingPrompt: uploaded.card.first_mes || profileDraft.value.snapshot.greetingPrompt,
    },
  }
}

async function handleAvatarUpload(file: File) {
  const uploaded = await uploadCharacterAsset(file, 'avatar')
  if (!profileDraft.value)
    return
  profileDraft.value = {
    ...profileDraft.value,
    snapshot: { ...profileDraft.value.snapshot, characterAsset: uploaded.asset },
  }
}

async function handleBackgroundUpload(file: File) {
  const uploaded = await uploadSceneBackgroundAsset(file)
  if (!profileDraft.value)
    return
  profileDraft.value = {
    ...profileDraft.value,
    snapshot: { ...profileDraft.value.snapshot, sceneBackground: uploaded.asset },
  }
}

async function handleMotionUpload(input: { file: File, slot: 'acknowledge' | 'greeting' | 'idle' | 'listening' | 'presentRecommendations' | 'thinking' }) {
  const uploaded = await uploadMotionAsset(input.file)
  if (!profileDraft.value)
    return

  profileDraft.value = {
    ...profileDraft.value,
    snapshot: {
      ...profileDraft.value.snapshot,
      ...(input.slot === 'idle' ? { idleMotion: uploaded.asset } : {}),
      motionPack: { ...profileDraft.value.snapshot.motionPack, [input.slot]: uploaded.asset },
    },
  }
}

async function deleteSite() {
  await deleteSelectedSite()
  deleteDialogOpen.value = false
}

onMounted(async () => {
  await load()
  const siteId = typeof route.query.site === 'string' ? route.query.site : undefined
  if (siteId && sites.value.some(site => site.id === siteId))
    await selectSite(siteId)
})

watch(() => route.query.site, async (siteId) => {
  if (typeof siteId === 'string' && sites.value.some(site => site.id === siteId))
    await selectSite(siteId)
})
</script>

<template>
  <div :class="['flex flex-col gap-6']">
    <section :class="['flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between']">
      <div>
        <p :class="['mb-2 mt-0 text-sm font-semibold tracking-wide text-cyan-700 dark:text-cyan-300']">
          CONFIGURATION
        </p>
        <h1 :class="['m-0 text-3xl font-bold tracking-tight text-slate-950 dark:text-white']">
          互動體驗
        </h1>
        <p :class="['mb-0 mt-2 text-sm text-slate-600 dark:text-slate-300']">
          編輯顧客會遇到的內容與互動服務；發布後才會套用到指定店別的 Kiosk。
        </p>
      </div>
      <div :class="['flex items-center gap-3']">
        <span v-if="selectedSite" :class="['rounded-full bg-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200']">{{ devices.length }} 台設備</span>
      </div>
    </section>

    <section :class="['grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]']">
      <div :class="['flex flex-col gap-4']">
        <section :class="['grid gap-2']" aria-label="選擇要設定的 Kiosk">
          <p :class="['mb-1 mt-0 text-sm font-semibold text-slate-700 dark:text-slate-200']">
            選擇 Kiosk 設定
          </p>
          <button
            v-for="site in sites"
            :key="site.id"
            type="button"
            :disabled="loading || saving"
            :class="['flex items-center gap-3 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50', selectedSiteId === site.id ? 'border-cyan-600 bg-cyan-50 text-cyan-950 shadow-sm dark:border-cyan-400 dark:bg-cyan-400/10 dark:text-cyan-50' : 'border-slate-200 bg-white hover:border-cyan-400 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-cyan-500']"
            @click="selectSite(site.id)"
          >
            <span :class="['i-solar:monitor-smartphone-bold-duotone rounded-lg bg-slate-100 p-2 text-xl text-slate-600 dark:bg-slate-800 dark:text-slate-300', selectedSiteId === site.id && 'bg-cyan-100 text-cyan-700 dark:bg-cyan-400/20 dark:text-cyan-200']" />
            <span :class="['min-w-0']">
              <span :class="['block truncate text-sm font-semibold']">{{ site.name }}</span>
              <span :class="['mt-1 block text-xs opacity-70']">前台連結 {{ site.interactionRetentionDays }} 天；系統封存持續保留</span>
            </span>
            <span v-if="selectedSiteId === site.id" :class="['i-solar:check-circle-bold ml-auto text-xl text-cyan-700 dark:text-cyan-300']" />
          </button>
        </section>

        <section :class="['grid gap-2']" aria-label="選擇 Kiosk 設定方案">
          <div :class="['flex items-center justify-between']">
            <p :class="['mb-1 mt-0 text-sm font-semibold text-slate-700 dark:text-slate-200']">
              Kiosk 設定方案
            </p>
            <Button v-if="capabilities?.canEditExperience" size="sm" variant="secondary" :disabled="saving || loading" @click="createProfileDraft">
              新增方案
            </Button>
          </div>
          <button
            v-for="draft in profileDrafts"
            :key="draft.id"
            type="button"
            :disabled="saving || loading"
            :class="['rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50', profileDraft?.id === draft.id ? 'border-cyan-600 bg-cyan-50 shadow-sm dark:border-cyan-400 dark:bg-cyan-400/10' : 'border-slate-200 bg-white hover:border-cyan-400 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-cyan-500']"
            @click="selectProfileDraft(draft)"
          >
            <span :class="['block truncate text-sm font-semibold text-slate-900 dark:text-white']">{{ draft.name }}</span>
            <span :class="['mt-1 block truncate text-xs text-slate-500 dark:text-slate-400']">{{ draft.snapshot.characterName }} · {{ draft.snapshot.interactiveService.title }}</span>
          </button>
          <p v-if="profileDraft && !profileDraft.id" :class="['m-0 rounded-xl border border-dashed border-cyan-500 bg-cyan-50 p-4 text-sm text-cyan-800 dark:bg-cyan-400/10 dark:text-cyan-200']">
            新方案尚未儲存。填好內部識別名稱後按「儲存草稿」，它會出現在這裡供日後選取。
          </p>
        </section>

        <section v-if="selectedSite" :class="['rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900']">
          <h2 :class="['m-0 text-base font-semibold text-slate-950 dark:text-white']">
            {{ selectedSite.name }}
          </h2>
          <dl :class="['mb-0 mt-5 grid gap-4 text-sm']">
            <div>
              <dt :class="['text-slate-500 dark:text-slate-400']">
                已註冊設備
              </dt>
              <dd :class="['mb-0 mt-1 font-semibold text-slate-900 dark:text-white']">
                {{ devices.length }} 台
              </dd>
            </div>
            <div>
              <dt :class="['text-slate-500 dark:text-slate-400']">
                前台互動連結期限
              </dt>
              <dd :class="['mb-0 mt-1 font-semibold text-slate-900 dark:text-white']">
                {{ selectedSite.interactionRetentionDays }} 天
              </dd>
            </div>
            <div v-if="publishedExperience">
              <dt :class="['text-slate-500 dark:text-slate-400']">
                已發布體驗
              </dt>
              <dd :class="['mb-0 mt-1 font-semibold text-slate-900 dark:text-white']">
                {{ publishedExperience.name }} · 店別 v{{ publishedExperience.revision ?? 1 }}
              </dd>
              <p v-if="publishedExperience.sourceTemplateReleaseId" :class="['mb-0 mt-1 text-xs text-slate-500 dark:text-slate-400']">
                {{ publishedExperience.changeScope === 'template_seed' ? '由管理員模板初始化' : '含店別客製變更' }}
              </p>
            </div>
          </dl>
          <Button
            v-if="capabilities?.canEditTechnicalSettings"
            variant="ghost"
            size="sm"
            :disabled="saving || loading"
            :class="['mt-5 text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-400/10']"
            @click="deleteDialogOpen = true"
          >
            <span class="i-solar:trash-bin-trash-bold-duotone" />
            刪除這個店別
          </Button>
        </section>
      </div>

      <div :class="['flex min-w-0 flex-col gap-6']">
        <KioskProfileEditor
          v-if="profileDraft"
          :busy="saving || loading"
          :capabilities="capabilities"
          :draft="profileDraft"
          :proactive-vlm-enabled="siteTechnicalSettings?.proactiveVlmEnabled"
          @update-proactive-vlm="saveProactiveVlmEnabled"
          @save="save($event.draft, $event.publish)"
          @upload-avatar="handleAvatarUpload"
          @upload-background="handleBackgroundUpload"
          @upload-motion="handleMotionUpload"
          @upload-role-card="handleRoleCardUpload"
        />
        <KioskTechnicalSettingsEditor
          v-if="siteTechnicalSettings && capabilities?.canEditTechnicalSettings"
          :busy="saving || loading"
          :settings="siteTechnicalSettings"
          @update-performance-profile="savePerformanceProfile"
          @update-voice-vad-settings="saveVoiceVadSettings"
        />
      </div>
    </section>

    <AlertDialogRoot :open="deleteDialogOpen" @update:open="deleteDialogOpen = $event">
      <AlertDialogPortal>
        <AlertDialogOverlay :class="['fixed inset-0 z-100 bg-black/50']" />
        <AlertDialogContent :class="['fixed left-1/2 top-1/2 z-100 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900']" @interact-outside.prevent>
          <AlertDialogTitle :class="['text-xl font-semibold text-slate-950 dark:text-white']">
            刪除店別？
          </AlertDialogTitle>
          <AlertDialogDescription :class="['mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300']">
            「{{ selectedSite?.name }}」的設備、互動體驗與紀錄會永久刪除，無法復原。
          </AlertDialogDescription>
          <div :class="['mt-6 flex justify-end gap-3']">
            <AlertDialogCancel as-child>
              <Button variant="secondary">
                取消
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction as-child>
              <Button variant="danger" :disabled="saving || loading" @click="deleteSite">
                確認刪除
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialogRoot>

    <p v-if="message" :class="['m-0 text-sm text-amber-700 dark:text-amber-300']">
      {{ message }}
    </p>
  </div>
</template>

<route lang="yaml">
path: /admin/kiosk/profiles
meta:
  layout: webnavior-admin
  title: 互動體驗
</route>
