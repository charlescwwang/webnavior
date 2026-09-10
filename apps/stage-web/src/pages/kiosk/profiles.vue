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
import { RouterLink, useRoute } from 'vue-router'

import KioskModelPolicyEditor from '../../components/Webnavior/kioskModelPolicyEditor.vue'
import KioskProfileEditor from '../../components/Webnavior/kioskProfileEditor.vue'

import { useKioskManagement } from '../../composables/useKioskManagement'

const route = useRoute()
const deleteDialogOpen = shallowRef(false)
const {
  capabilities,
  deleteSelectedSite,
  devices,
  load,
  loading,
  message,
  profileDraft,
  save,
  saveModelPolicy,
  saving,
  siteModelPolicy,
  selectedSite,
  selectedSiteId,
  selectSite,
  sites,
  uploadCharacterAsset,
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
        <RouterLink
          :to="selectedSiteId ? { path: '/kiosk/preview', query: { site: selectedSiteId } } : '/kiosk/preview'"
          :class="['rounded-lg border border-cyan-700 px-3 py-2 text-sm font-semibold text-cyan-800 transition-colors hover:bg-cyan-50 dark:border-cyan-300 dark:text-cyan-200 dark:hover:bg-cyan-400/10']"
        >
          查看草稿預覽
        </RouterLink>
        <span v-if="selectedSite" :class="['rounded-full bg-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200']">{{ devices.length }} 台設備</span>
      </div>
    </section>

    <section :class="['grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]']">
      <div :class="['flex flex-col gap-4']">
        <label :class="['flex flex-col gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200']">
          管理店別
          <select
            :value="selectedSiteId"
            :class="['rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900']"
            @change="selectSite(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="site in sites" :key="site.id" :value="site.id">{{ site.name }}</option>
          </select>
        </label>

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
                互動資料保存
              </dt>
              <dd :class="['mb-0 mt-1 font-semibold text-slate-900 dark:text-white']">
                {{ selectedSite.interactionRetentionDays }} 天
              </dd>
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
          @save="save($event.draft, $event.publish)"
          @upload-avatar="handleAvatarUpload"
          @upload-role-card="handleRoleCardUpload"
        />
        <KioskModelPolicyEditor
          v-if="siteModelPolicy && capabilities?.canEditTechnicalSettings"
          :busy="saving || loading"
          :policy="siteModelPolicy"
          @save="saveModelPolicy"
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
meta:
  layout: webnavior-admin
  title: 互動體驗
</route>
