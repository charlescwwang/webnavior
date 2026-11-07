<script setup lang="ts">
import type { ProductPresentation } from '@proj-airi/stage-shared/product-presentation'

import { useI18n } from 'vue-i18n'

defineProps<{ presentation: ProductPresentation }>()

const { t } = useI18n()
</script>

<template>
  <aside :class="['product-presentation']" :aria-label="t('stage.kiosk.product-presentation.title')" aria-live="polite">
    <span v-if="presentation.stage === 'completed'" :class="['self-center text-sm']">{{ t('stage.kiosk.product-presentation.completed') }}</span>
    <span v-if="presentation.cue === 'target-unavailable'" :class="['self-center text-sm']">{{ t('stage.kiosk.product-presentation.unavailable') }}</span>
    <div v-for="product in presentation.products" :key="product.ref" :class="['product-summary']">
      <span :class="['i-solar-chef-hat-heart-bold-duotone', 'shrink-0 text-xl']" aria-hidden="true" />
      <strong>{{ product.name }}</strong>
      <span v-if="product.price !== undefined">{{ t('stage.kiosk.product-presentation.price', { price: product.price }) }}</span>
    </div>
  </aside>
</template>

<style scoped>
.product-presentation { display: flex; gap: .6rem; overflow-x: auto; padding: .6rem; background: #fff4dd; border-bottom: 1px solid #f0c990; max-height: 6rem; }
.product-summary { display: flex; flex: 0 0 auto; align-items: center; gap: .5rem; padding: .5rem .75rem; border: 1px solid #edb96e; border-radius: .85rem; background: white; color: #433019; font-size: clamp(.85rem, 1.5vw, 1.1rem); }
.product-summary span:last-child { white-space: nowrap; }
</style>
