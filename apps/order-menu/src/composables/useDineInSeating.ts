import type { HoldRequest, SeatingSnapshot, TableHold } from '../../../order-menu-server/src/domain/seatingContracts'
import type { SeatingContext } from '../domain/seating'

import { errorMessageFrom } from '@moeru/std'
import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue'

import { tableChoices } from '../domain/seating'

/** Owns party/hold state; only active dine-in rounds poll POS availability. */
export function useDineInSeating(baseUrl: string, isDineInActive: () => boolean) {
  const snapshot = shallowRef<SeatingSnapshot>({ revision: 0, tables: [] })
  const partySize = shallowRef<number>()
  const hold = shallowRef<TableHold>()
  const busy = shallowRef(false)
  const error = shallowRef<string>()
  const synchronized = shallowRef(false)
  let revision = 0
  let disposed = false
  let timer: ReturnType<typeof setInterval> | undefined
  let stopPollingWatch: (() => void) | undefined
  const choices = computed(() => tableChoices(snapshot.value, partySize.value))
  const ready = computed(() => synchronized.value && !!hold.value && ['held', 'locked', 'occupied'].includes(hold.value.status))
  const locked = computed(() => hold.value?.status === 'locked' || hold.value?.status === 'occupied')

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(new URL(`v1/seating${path}`, `${baseUrl.replace(/\/$/, '')}/`), { ...init, signal: AbortSignal.timeout(5000) })
    if (!response.ok)
      throw new Error(response.status === 404 ? '桌位暫留已過期，請重新選桌。' : '桌位狀態已變更或無法確認，請重新整理。')
    return await response.json() as T
  }

  async function read() {
    const next = await request<{ seating: SeatingSnapshot }>('')
    let current = hold.value
    if (current) {
      const response = await fetch(new URL(`v1/seating/holds/${encodeURIComponent(current.id)}`, `${baseUrl.replace(/\/$/, '')}/`), { signal: AbortSignal.timeout(5000) })
      if (response.status === 404)
        current = undefined
      else if (!response.ok)
        throw new Error('無法確認桌位保留狀態。')
      else
        current = (await response.json() as { hold: TableHold }).hold
    }
    if (disposed)
      return
    if (JSON.stringify(next.seating) !== JSON.stringify(snapshot.value) || current?.status !== hold.value?.status || current?.id !== hold.value?.id)
      revision++
    snapshot.value = next.seating
    hold.value = current
    synchronized.value = true
  }

  async function run<T>(action: () => Promise<T>) {
    if (busy.value)
      throw new Error('正在更新桌位，請稍候。')
    busy.value = true
    error.value = undefined
    try {
      return await action()
    }
    catch (cause) {
      synchronized.value = false
      revision++
      error.value = errorMessageFrom(cause) ?? '無法確認桌位。'
      throw cause
    }
    finally { busy.value = false }
  }

  async function refresh() {
    await run(read)
  }
  async function release() {
    await run(async () => {
      if (hold.value) {
        await request(`/holds/${encodeURIComponent(hold.value.id)}`, { method: 'DELETE' })
        hold.value = undefined
        revision++
      }
      await read()
    })
  }
  async function setPartySize(value: number) {
    if (!Number.isInteger(value) || value < 1 || value > 20)
      throw new Error('請輸入 1 至 20 位用餐人數。')
    if (value === partySize.value)
      return
    await release()
    partySize.value = value
    revision++
  }
  async function reserve(choiceId: string, splitApproved: boolean, expectedRevision: number) {
    if (expectedRevision !== revision)
      throw new Error('桌位選項已變更，請重新選擇。')
    await run(async () => {
      if (hold.value)
        throw new Error('已有保留桌位；請先修改人數或取消原桌位。')
      const choice = choices.value.find(choice => choice.id === choiceId)
      if (!choice || !partySize.value)
        throw new Error('請重新選擇可用桌位。')
      const body: HoldRequest = { expectedRevision: snapshot.value.revision, partySize: partySize.value, tableIds: choice.tableIds, splitApproved }
      hold.value = (await request<{ hold: TableHold }>('/holds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).hold
      revision++
      await read()
    })
  }
  function context(): SeatingContext {
    return { revision, partySize: partySize.value, ready: ready.value, choices: synchronized.value && !hold.value ? choices.value : [] }
  }
  function paymentHoldId() {
    if (!ready.value || !hold.value || hold.value.status !== 'held')
      throw new Error('請返回訂單確認可用桌位，再啟動付款。')
    return hold.value.id
  }
  function forgetOccupied() {
    if (hold.value?.status === 'occupied') {
      hold.value = undefined
      partySize.value = undefined
      revision++
    }
  }
  async function reset() {
    if (!hold.value) {
      // A pickup/new round has no POS capability to release. Invalidate local
      // choices without querying seating inventory that it will never use.
      partySize.value = undefined
      synchronized.value = false
      revision++
      return
    }
    await refresh()
    if (hold.value?.status === 'occupied')
      forgetOccupied()
    else
      await release()
    partySize.value = undefined
    revision++
  }
  onMounted(() => {
    stopPollingWatch = watch(() => isDineInActive() && hold.value?.status !== 'occupied', (active) => {
      if (timer) {
        clearInterval(timer)
        timer = undefined
      }
      if (!active)
        return
      if (!busy.value)
        void refresh().catch(() => {})
      // Background freshness is not execution authority: selection and payment
      // still check POS immediately. Never release seats using browser time.
      timer = setInterval(() => {
        if (!busy.value)
          void refresh().catch(() => {})
      }, 30_000)
    }, { immediate: true })
  })
  onUnmounted(() => {
    disposed = true
    stopPollingWatch?.()
    if (timer)
      clearInterval(timer)
    // Closing the page is not authority to release an unresolved payment.
    // Unpaid holds are reclaimed by the POS deadline.
  })
  return { snapshot, partySize, hold, busy, error, choices, ready, locked, refresh, release, setPartySize, reserve, context, paymentHoldId, reset }
}
