<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'

import type { SeatingSnapshot, TableHold } from '../../../order-menu-server/src/domain/seatingContracts'
import type { TableChoice } from '../domain/seating'

const props = defineProps<{ snapshot: SeatingSnapshot, partySize?: number, hold?: TableHold, choices: TableChoice[], busy: boolean, error?: string, locked: boolean }>()
const emit = defineEmits<{ setPartySize: [value: number], reserve: [choiceId: string, splitApproved: boolean], refresh: [], registerControl: [id: string, element: Element | ComponentPublicInstance | null] }>()
</script>

<template>
  <section :class="['seating-panel']" aria-labelledby="seating-heading">
    <h3 id="seating-heading">
      內用人數與桌位
    </h3>
    <p>每桌 4 人；選桌後暫留 10 分鐘。多人需分桌時，請先同意分桌。</p>
    <label>
      用餐人數
      <select :ref="element => emit('registerControl', 'seating:party-size', element)" :value="props.partySize ?? ''" :disabled="props.busy || props.locked" aria-label="用餐人數" @change="emit('setPartySize', Number(($event.target as HTMLSelectElement).value))">
        <option disabled value="">請選擇</option>
        <option v-for="count in 20" :key="count" :value="count">{{ count }} 位</option>
      </select>
    </label>
    <ul :class="['table-statuses']" aria-label="目前桌位">
      <li v-for="table in props.snapshot.tables" :key="table.id">
        {{ table.label }}：{{ table.status === 'free' ? '空桌' : table.status === 'held' ? '暫留中' : '使用中' }}
      </li>
    </ul>
    <p v-if="props.hold" role="status">
      {{ props.hold.tableIds.join('、') }} — {{ props.hold.status === 'occupied' ? '已入座' : props.hold.status === 'locked' ? '付款處理中，桌位已鎖定' : `保留至 ${new Date(props.hold.expiresAt).toLocaleTimeString('zh-TW')}` }}
    </p>
    <div v-else :class="['table-choices']">
      <button v-for="choice in props.choices" :key="choice.id" type="button" :disabled="props.busy" @click="emit('reserve', choice.id, choice.splitRequired)">
        {{ choice.splitRequired ? '同意分桌並選擇 ' : '選擇 ' }}{{ choice.label }}
      </button>
      <p v-if="props.partySize && props.choices.length === 0">
        目前沒有足夠空桌，請洽門市人員或改為自取。
      </p>
    </div>
    <p v-if="props.error" role="alert">
      {{ props.error }}
    </p>
    <button type="button" :disabled="props.busy" @click="emit('refresh')">
      {{ props.busy ? '更新桌位中…' : '重新整理桌位' }}
    </button>
  </section>
</template>

<style scoped>
.seating-panel { display: grid; gap: 12px; padding: 16px 20px; border-top: 1px solid #f0e4da; color: #3d281c; }
h3, p { margin: 0; }
p, li { font-size: 13px; }
label { display: flex; align-items: center; gap: 12px; }
select, button { padding: 10px; border: 1px solid #ead7c9; border-radius: 8px; background: #fff9f3; color: #72351c; }
button:disabled { opacity: .5; }
.table-statuses { display: flex; flex-wrap: wrap; gap: 10px; padding: 0; list-style: none; }
.table-choices { display: flex; flex-wrap: wrap; gap: 10px; }
[role="alert"] { color: #b33d21; }
</style>
