<script setup lang="ts">
import type { ContinuationSnapshot } from '../continuation'

import { errorMessageFrom } from '@moeru/std'
import { computed, onMounted, shallowRef } from 'vue'

import TakeoutChange from './takeoutChange.vue'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { changeToTakeout, pendingOrderKey, readContinuation } from '../continuation'

const props = defineProps<{ token: string, scannedTable?: string }>()
const snapshot = shallowRef<ContinuationSnapshot>()
const error = shallowRef<string>()
const busy = shallowRef(false)
const scanned = shallowRef(props.scannedTable)
const confirmingTakeout = shallowRef(false)
const copy = orderingMessages['zh-Hant'].continuation
const heading = computed(() => {
  if (snapshot.value?.readOnly)
    return copy.receiptTitle
  if (snapshot.value?.fulfillmentMode === 'takeout')
    return copy.takeoutTitle
  if (snapshot.value?.table)
    return copy.tableTitle
  return snapshot.value ? copy.orderTitle : copy.startTitle
})

/** Mirrors a verified response into this tab and the cross-tab pending-table capability. */
function acceptSnapshot(next: ContinuationSnapshot) {
  snapshot.value = next
  // Keep this tab refreshable after binding or pickup clears the shared token.
  // Only a capability validated by the bridge is promoted into its URL.
  const pageUrl = new URL(window.location.href)
  if (pageUrl.searchParams.get('continuation') !== props.token) {
    pageUrl.searchParams.set('continuation', props.token)
    window.history.replaceState(null, '', pageUrl.toString())
  }
  // Only an unbound dine-in order should follow a later table scan. Pickup
  // removes this order's token without disturbing another pending order.
  if (!next.readOnly && next.fulfillmentMode === 'dine-in' && !next.table)
    localStorage.setItem(pendingOrderKey, JSON.stringify({ token: props.token, expiresAt: next.expiresAt }))
  else if (JSON.parse(localStorage.getItem(pendingOrderKey) ?? 'null')?.token === props.token)
    localStorage.removeItem(pendingOrderKey)
}

async function load(confirm = false) {
  if (busy.value)
    return
  if (!props.token) {
    error.value = '尚未帶入 Kiosk 訂單，請先掃描機台上的訂單接續碼。'
    return
  }
  busy.value = true
  error.value = undefined
  try {
    acceptSnapshot(await readContinuation(import.meta.env.VITE_ORDER_MENU_SERVER_URL, props.token, confirm ? scanned.value : undefined))
    confirmingTakeout.value = false
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? '無法讀取訂單。'
  }
  finally { busy.value = false }
}

async function confirmTakeout() {
  if (busy.value || !confirmingTakeout.value || snapshot.value?.fulfillmentMode !== 'dine-in')
    return
  busy.value = true
  error.value = undefined
  try {
    acceptSnapshot(await changeToTakeout(import.meta.env.VITE_ORDER_MENU_SERVER_URL, props.token))
    scanned.value = undefined
    confirmingTakeout.value = false
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? copy.changeFailed
  }
  finally { busy.value = false }
}
onMounted(() => load())
</script>

<template>
  <main :class="['continuation-page']">
    <span :class="['test-label']">{{ snapshot?.environment === 'test' ? copy.testOrder : copy.receiptTitle }}</span>
    <h1>{{ heading }}</h1>
    <p v-if="error" role="alert">
      {{ error }}
    </p>
    <button v-if="(!snapshot || error) && !busy" type="button" @click="load()">
      重新讀取
    </button>
    <template v-if="snapshot">
      <section v-if="snapshot.pickupNumber" :class="['pickup-number']">
        <h2>{{ copy.pickupNumber }}</h2>
        <strong :class="['text-6xl font-bold tabular-nums']">{{ snapshot.pickupNumber }}</strong>
      </section>
      <p v-if="snapshot.readOnly">
        {{ copy.receiptHint }}
      </p>
      <p :class="['order-number']">
        訂單 {{ snapshot.orderId }}
      </p>
      <p v-if="snapshot.phoneLabel">
        本次記錄手機 {{ snapshot.phoneLabel }}
      </p>
      <ul>
        <li v-for="(line, index) in snapshot.lines" :key="index">
          {{ line.name }} × {{ line.quantity }}
        </li>
      </ul>
      <p :class="['total']">
        總計 {{ snapshot.total }}元
      </p>
      <p>{{ copy.mode }} {{ snapshot.fulfillmentMode === 'takeout' ? copy.takeout : copy.dineIn }}</p>
      <section v-if="!snapshot.readOnly && snapshot.fulfillmentMode === 'takeout'" role="status">
        <h2>{{ copy.takeoutTitle }}</h2>
        <p>{{ copy.changed }}</p>
        <small>{{ copy.testNotice }}</small>
      </section>
      <template v-else-if="!snapshot.readOnly && !confirmingTakeout">
        <section v-if="snapshot.table" role="status">
          <h2>送餐桌號 {{ snapshot.table.label.toUpperCase() }}</h2>
          <p>訂單與桌號已綁定，等待餐點備妥。</p>
          <small>目前只模擬送餐目的地，沒有啟動真實機器人。</small>
        </section>
        <section v-else-if="scanned === 'demo-a08'">
          <h2>已掃到 A08 桌</h2>
          <p>確認將這筆訂單送到 A08 桌嗎？</p>
          <button type="button" :disabled="busy" @click="load(true)">
            確認綁定 A08 桌
          </button>
          <button type="button" :disabled="busy" @click="scanned = undefined">
            重新掃碼
          </button>
        </section>
        <section v-else>
          <h2>尚未綁定桌號</h2>
          <p>請入座後掃描桌上的 QR Code，再確認送餐桌號。</p>
          <p v-if="scanned" role="alert">
            無法辨識這個測試桌碼，請重新掃描。
          </p>
          <button type="button" :disabled="busy" @click="scanned = 'demo-a08'">
            電腦測試：模擬掃描桌碼
          </button>
          <small>模擬器固定辨識 A08；不提供桌號選單或手動輸入。</small>
        </section>
      </template>
      <TakeoutChange
        v-if="!snapshot.readOnly && snapshot.fulfillmentMode === 'dine-in'"
        :busy="busy"
        :confirming="confirmingTakeout"
        :table="snapshot.table?.label.toUpperCase()"
        @request="confirmingTakeout = true"
        @cancel="confirmingTakeout = false"
        @confirm="confirmTakeout"
      />
    </template>
    <p v-else-if="busy">
      正在讀取訂單…
    </p>
  </main>
</template>

<style scoped>
.continuation-page {
  max-width: 540px;
  margin: 32px auto;
  padding: clamp(22px,5vw,38px);
  border-radius: 24px;
  background: #fff;
  color: #3d281c;
  box-shadow: 0 12px 26px #7a3b141a;
}

.test-label {
  color: #a94b24;
  font-size: 13px;
  font-weight: 700;
}

.continuation-page h1 {
  font-size: 28px;
  line-height: 1.4;
}

.continuation-page p {
  line-height: 1.7;
}

.order-number {
  overflow-wrap: anywhere;
  font-size: 13px;
  color: #786655;
}

.continuation-page ul {
  padding: 18px 18px 18px 34px;
  background: #fff8ee;
  border-radius: 12px;
  line-height: 2;
}

.total {
  font-size: 21px;
  font-weight: 700;
}

.continuation-page section {
  display: grid;
  gap: 12px;
  border-top: 1px solid #ead7c9;
  margin-top: 24px;
  padding-top: 20px;
}

.continuation-page section h2,.continuation-page section p {
  margin: 0;
}

.continuation-page button {
  border: 0;
  border-radius: 12px;
  padding: 16px;
  background: #d95327;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
}

.continuation-page button:disabled {
  opacity: .5;
}

.continuation-page small {
  color: #786655;
  line-height: 1.6;
}

.continuation-page [role=alert] {
  color: #a72717;
}
</style>
