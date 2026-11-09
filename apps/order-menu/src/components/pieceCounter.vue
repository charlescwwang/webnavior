<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'

import type { MenuOptionGroup } from '../domain/order-machine'

import { formatOrderingPrice } from '@proj-airi/stage-shared/kiosk-conversation'
import { computed } from 'vue'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { cartOptionControlId, optionControlId } from '../webmcp'

const props = defineProps<{ group: MenuOptionGroup, selected?: string, ownerId: string, cart?: boolean, disabled?: boolean }>()
const emit = defineEmits<{
  select: [valueId: string]
  registerControl: [id: string, element: Element | ComponentPublicInstance | null]
}>()
// The supplier projection owns the ordered 0–100 choices. The POS value ID,
// rather than a second local counter, stays the source of truth in both views.
const index = computed(() => Math.max(0, props.group.values.findIndex(value => value.id === props.selected)))
const value = computed(() => props.group.values[index.value]!)
const previous = computed(() => props.group.values[index.value - 1])
const next = computed(() => props.group.values[index.value + 1])
const copy = orderingMessages['zh-Hant']
function controlRef(valueId: string | undefined) {
  if (!valueId)
    return undefined
  const id = props.cart ? cartOptionControlId(props.ownerId, props.group.id, valueId) : optionControlId(props.ownerId, props.group.id, valueId)
  return (element: Element | ComponentPublicInstance | null) => emit('registerControl', id, element)
}
</script>

<template>
  <div :class="['piece-counter']">
    <div :class="['piece-counter-steps']" role="group" :aria-label="props.group.label">
      <button :ref="controlRef(previous?.id)" type="button" :disabled="props.disabled || !previous" :aria-label="copy.supplierDecreasePiece" @click="previous && emit('select', previous.id)">
        −
      </button>
      <output aria-live="polite">{{ index }} {{ copy.supplierPieceUnit }}</output>
      <button :ref="controlRef(next?.id)" type="button" :disabled="props.disabled || !next" :aria-label="copy.supplierIncreasePiece" @click="next && emit('select', next.id)">
        ＋
      </button>
    </div>
    <span>{{ copy.supplierExtraPrice }} {{ formatOrderingPrice(value.priceDelta) }}</span>
    <button v-if="!props.selected" :ref="controlRef(value.id)" type="button" :disabled="props.disabled" :class="['piece-counter-zero']" @click="emit('select', value.id)">
      {{ copy.supplierNoExtraPieces }}
    </button>
  </div>
</template>

<style scoped>
.piece-counter { display:flex; flex-wrap:wrap; align-items:center; gap:12px; margin-top:12px; color:#765; }
.piece-counter-steps { display:grid; grid-template-columns:44px 76px 44px; align-items:center; border:1px solid #ead7c9; border-radius:10px; overflow:hidden; text-align:center; }
.piece-counter-steps button { min-height:44px; padding:0; background:#fff9f3; color:#803813; font-size:22px; }
.piece-counter-steps button:disabled { color:#c6b8ae; }
.piece-counter-steps output { font-weight:800; font-variant-numeric:tabular-nums; }
.piece-counter-zero { min-height:44px; padding:8px 12px; border:1px solid #ead7c9; background:#fff9f3; color:#803813; }
</style>
