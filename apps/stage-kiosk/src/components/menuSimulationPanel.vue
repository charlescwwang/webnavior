<script setup lang="ts">
import type { createInteractiveServiceClient } from '@proj-airi/stage-ui/services/interactiveServiceClient'

import type { MenuPageState } from '../../../order-menu/src/domain/order-machine'
import type { MenuTestSnapshot } from '../../../order-menu/src/webmcp'

import { Button, FieldSelect } from '@proj-airi/ui'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { menuPageStates } from '../../../order-menu/src/domain/order-machine'

const props = defineProps<{ bridge: Pick<ReturnType<typeof createInteractiveServiceClient>, 'availability' | 'execute' | 'tools'> }>()
const { t } = useI18n()
const items = shallowRef<MenuTestSnapshot['items']>([])
const itemId = shallowRef('')
const busy = shallowRef(false)
const failed = shallowRef(false)
const tool = computed(() => props.bridge.tools.value.find(tool => tool.name === 'kiosk_test_menu'))
const options = computed(() => items.value.map(item => ({ label: item.name, value: item.id })))
const selected = computed(() => items.value.find(item => item.id === itemId.value))
let revision = 0

async function update(state?: MenuPageState) {
  if (!tool.value || props.bridge.availability.value !== 'ready')
    return
  const current = ++revision
  busy.value = true
  failed.value = false
  try {
    const value = await props.bridge.execute(tool.value, state ? { itemId: itemId.value, state } : {})
    if (current !== revision)
      return
    if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items))
      throw new Error('Invalid menu test snapshot.')
    const next = value.items.map((item: unknown) => {
      if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string' || !('name' in item) || typeof item.name !== 'string' || !('state' in item) || !menuPageStates.includes(item.state as MenuPageState))
        throw new Error('Invalid menu test item.')
      return { id: item.id, name: item.name, state: item.state as MenuPageState }
    })
    items.value = next
    if (!next.some(item => item.id === itemId.value))
      itemId.value = next[0]?.id ?? ''
  }
  catch {
    if (current === revision)
      failed.value = true
  }
  finally {
    if (current === revision)
      busy.value = false
  }
}

watch([tool, props.bridge.availability], () => {
  revision++
  items.value = []
  busy.value = false
  void update()
}, { immediate: true })
onScopeDispose(() => revision++)
</script>

<template>
  <section v-if="tool" :class="['grid gap-3 rounded-2xl border border-white/15 p-4']">
    <h3 :class="['m-0 font-semibold']">
      {{ t('stage.kiosk.menu-test.title') }}
    </h3>
    <p :class="['m-0 text-sm leading-6 opacity-75']">
      {{ t('stage.kiosk.menu-test.description') }}
    </p>
    <FieldSelect v-model="itemId" :label="t('stage.kiosk.menu-test.item')" :options="options" :disabled="busy" layout="vertical" />
    <div :class="['grid grid-cols-2 gap-2']">
      <Button v-for="state in menuPageStates" :key="state" :aria-pressed="selected?.state === state" :toggled="selected?.state === state" :disabled="busy || !itemId" :label="t(`stage.kiosk.menu-test.${state}`)" variant="secondary-muted" @click="update(state)" />
    </div>
    <Button :disabled="busy" :label="t('stage.kiosk.menu-test.refresh')" variant="secondary" @click="update()" />
    <p v-if="failed" role="alert">
      {{ t('stage.kiosk.menu-test.failed') }}
    </p>
  </section>
</template>
