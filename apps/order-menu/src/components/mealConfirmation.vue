<script setup lang="ts">
import type { PresentedQuestion } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'

import Button from '../../../../packages/ui/src/components/misc/button.vue'

import { mealMessages } from '../mealClarification'

defineProps<{ question: PresentedQuestion, locked: boolean }>()
const emit = defineEmits<{ answer: [candidateId: string] }>()
</script>

<template>
  <aside :class="['meal-confirmation']" role="status" aria-live="polite">
    <p>{{ question.question }}</p>
    <div :class="['meal-confirmation-answers']">
      <Button
        v-for="choice in question.choices"
        :key="choice.id"
        :class="['meal-confirmation-answer']"
        :disabled="locked"
        :label="choice.id.endsWith(':yes') ? mealMessages.yes : mealMessages.no"
        variant="secondary"
        @click="emit('answer', choice.id)"
      />
    </div>
  </aside>
</template>

<style scoped>
.meal-confirmation { position:fixed; z-index:60; right:20px; bottom:100px; left:20px; max-width:540px; margin:auto; border:2px solid #d95327; border-radius:20px; padding:20px; color:#3d281c; background:#fffdf9; box-shadow:0 8px 32px #3d281c33; }
.meal-confirmation p { margin:0 0 16px; font-size:22px; font-weight:700; }
.meal-confirmation-answers { display:flex; gap:16px; }
.meal-confirmation-answer { min-height:52px; flex:1; border:1px solid #d95327; border-radius:12px; padding:12px; color:#3d281c; background:#fff1e5; font-size:20px; cursor:pointer; }
.meal-confirmation-answer:disabled { opacity:.5; cursor:wait; }
</style>
