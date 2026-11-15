<script setup lang="ts">
import type { FastPathTiming } from '../services/kiosk-fast-path'

import { toOrderingTraditionalChinese } from '@proj-airi/stage-ui/libs/taiwan-traditional-chinese'
import { shallowRef } from 'vue'

export interface KioskDecisionEntry {
  id: number
  transcript: string
  source: 'asr' | 'simulation'
  phase?: string
  references?: string[]
  candidates?: string[]
  decision?: string
  confidence?: number
  operation?: string
  authorization?: string
  agentStep?: string
  systemOneStep?: string
  route: 'queued' | 'deciding' | 'fast_path' | 'greeting' | 'main_agent' | 'ignored' | 'incomplete' | 'deferred' | 'unavailable' | 'clarification' | 'customer_entry' | 'execution_failed'
  startedAt: number
  decisionStages?: Array<{ decision: string, operation?: string, authorization?: string }>
  modelContext?: string
  modelExchanges?: string
  modelCalls?: number
  timing?: FastPathTiming
  reason?: string
}

defineProps<{
  entries: readonly KioskDecisionEntry[]
  pendingCount: number
}>()

const open = shallowRef(false)
const routeLabels: Record<KioskDecisionEntry['route'], string> = {
  queued: '等待處理',
  deciding: 'System One 判斷中',
  fast_path: 'Fast Path 已操作網頁',
  greeting: 'Fast Path 招呼回應（未操作網頁）',
  main_agent: '轉交 Main Agent',
  ignored: '背景語句已忽略',
  incomplete: '語句未完成',
  deferred: '等待前一操作',
  unavailable: '判斷不可用，未執行',
  clarification: '等待顧客釐清',
  customer_entry: '等待填寫或略過電話',
  execution_failed: '操作未完成／結果待確認',
}
</script>

<template>
  <div class="inspector-anchor">
    <button type="button" class="inspector-trigger" @click="open = true">
      決策流程
      <span v-if="pendingCount" class="pending-count">{{ pendingCount }} 句等待中</span>
    </button>
    <div v-if="open" class="inspector-scrim" @click.self="open = false">
      <section class="inspector-panel" role="dialog" aria-modal="true" aria-label="System One 決策流程">
        <header class="inspector-header">
          <div>
            <h2>語句決策流程</h2>
            <p>每句獨立顯示 Jev 判斷、候選與執行路線；不顯示完整結帳資料。</p>
          </div>
          <button type="button" class="close-button" aria-label="關閉決策流程" @click="open = false">
            關閉
          </button>
        </header>
        <p v-if="!entries.length" class="empty-state">
          尚未收到 ASR 語句。
        </p>
        <ol v-else class="entry-list">
          <li v-for="entry in [...entries].reverse()" :key="entry.id" class="entry-card">
            <div class="entry-heading">
              <strong>{{ toOrderingTraditionalChinese(entry.transcript) }}</strong>
              <span>{{ entry.source === 'simulation' ? '模擬 ASR' : '語音 ASR' }} · {{ routeLabels[entry.route] }}</span>
            </div>
            <dl class="entry-grid">
              <dt>畫面階段</dt><dd>{{ entry.phase ?? '讀取中' }}</dd>
              <dt>真實參照</dt><dd>{{ entry.references?.join('、') || '無' }}</dd>
              <dt>候選語意</dt><dd>{{ entry.candidates?.join('、') || '無' }}</dd>
              <dt>Jev 判斷</dt><dd>{{ entry.decision ?? '等待中' }}<span v-if="entry.confidence !== undefined">（{{ entry.confidence.toFixed(2) }}）</span></dd>
              <dt v-if="entry.modelCalls !== undefined">
                Jev 呼叫次數
              </dt><dd v-if="entry.modelCalls !== undefined">
                {{ entry.modelCalls }}
              </dd>
              <dt v-if="entry.reason">
                轉交／拒絕原因
              </dt><dd v-if="entry.reason">
                {{ entry.reason }}
              </dd>
              <dt>工具操作</dt><dd>{{ entry.operation ?? '未執行' }}</dd>
              <dt>授權結果</dt><dd>{{ entry.authorization ?? '不適用' }}</dd>
              <dt>Main Agent</dt><dd>{{ entry.agentStep ?? '未轉交' }}</dd>
              <dt>Jev 階段</dt><dd>{{ entry.systemOneStep ?? '尚未開始' }}</dd>
              <dt v-if="entry.decisionStages?.length">
                本輪步驟
              </dt><dd v-if="entry.decisionStages?.length">
                {{ entry.decisionStages.map(step => [step.decision, step.operation, step.authorization].filter(Boolean).join(' → ')).join('；') }}
              </dd>
            </dl>
            <details v-if="entry.modelContext">
              <summary>查看送給 Jev 的角色對話與情境</summary>
              <pre :class="['max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs']">{{ entry.modelContext }}</pre>
            </details>
            <details v-if="entry.modelExchanges">
              <summary>查看每次有限問題、回答與耗時</summary>
              <pre :class="['max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs']">{{ entry.modelExchanges }}</pre>
            </details>
          </li>
        </ol>
      </section>
    </div>
  </div>
</template>

<style scoped>
.inspector-anchor { position: fixed; z-index: 25; top: 1.15rem; right: 1.25rem; }
.inspector-trigger, .close-button { border: 1px solid rgb(120 225 209 / 50%); border-radius: .7rem; padding: .6rem .8rem; color: #e6fffb; background: #17494a; font: inherit; font-size: .8rem; font-weight: 700; cursor: pointer; }
.pending-count { margin-left: .5rem; color: #a8f0e5; }
.inspector-scrim { position: fixed; z-index: 110; inset: 0; display: grid; place-items: center; padding: 1rem; background: rgb(1 10 13 / 76%); }
.inspector-panel { display: flex; width: min(72rem, 100%); max-height: 90dvh; flex-direction: column; gap: 1rem; border: 1px solid rgb(120 225 209 / 38%); border-radius: 1rem; padding: 1.25rem; color: #e6fffb; background: #102928; box-shadow: 0 1rem 3rem rgb(0 0 0 / 45%); }
.inspector-header, .entry-heading { display: flex; justify-content: space-between; gap: 1rem; }
.inspector-header h2, .inspector-header p { margin: 0; }
.inspector-header p { margin-top: .3rem; color: #a9d9d2; font-size: .85rem; }
.entry-list { display: grid; gap: .75rem; overflow: auto; margin: 0; padding: 0; list-style: none; }
.entry-card { border: 1px solid rgb(120 225 209 / 20%); border-radius: .75rem; padding: .8rem; background: rgb(255 255 255 / 4%); }
.entry-heading span { color: #a9d9d2; font-size: .8rem; }
.entry-grid { display: grid; grid-template-columns: 7rem minmax(0, 1fr); gap: .35rem .7rem; margin: .65rem 0 0; font-size: .8rem; }
.entry-grid dt { color: #a9d9d2; }
.entry-grid dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.empty-state { margin: 0; }
</style>
