<script setup lang="ts">
import type { QueryCondition, QueryView } from '../domain/browsing'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'

const props = defineProps<{ state?: QueryView, locked: boolean, proposedAlternatives?: boolean }>()
const emit = defineEmits<{ remove: [condition: QueryCondition, revision: number] }>()
const copy = orderingMessages['zh-Hant'].queryConditions
</script>

<template>
  <section v-if="props.state?.conditions.length" :class="['query-conditions']" :aria-label="copy.title">
    <p :class="['query-conditions-title']">
      {{ copy.title }}
    </p>
    <ul :class="['query-condition-list']">
      <li v-for="condition in props.state.conditions" :key="`${condition.group}:${condition.value ?? ''}`" :class="['query-condition']">
        <span>{{ condition.label }}</span>
        <button
          v-if="condition.removable" type="button" :disabled="props.locked"
          :aria-label="copy.remove.replace('{condition}', condition.label)"
          @click="emit('remove', condition, props.state.revision)"
        >
          ×
        </button>
      </li>
    </ul>
    <p v-if="props.proposedAlternatives" :class="['query-condition-note']">
      {{ copy.alternatives }}
    </p>
  </section>
</template>

<style scoped>
.query-conditions { margin: 0.75rem 0 1rem; padding: 0.85rem 1rem; border: 1px solid #dcc9b2; border-radius: 1rem; background: #fffaf1; }
.query-conditions-title { margin: 0 0 0.55rem; font-weight: 700; }
.query-condition-list { display: flex; flex-wrap: wrap; gap: 0.5rem; list-style: none; margin: 0; padding: 0; }
.query-condition { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.4rem 0.25rem 0.8rem; border-radius: 1rem; background: #f2e6d7; }
.query-condition button { min-width: 2.75rem; min-height: 2.75rem; border: 0; border-radius: 50%; background: transparent; font-size: 1.6rem; cursor: pointer; }
.query-condition button:disabled { opacity: 0.45; cursor: wait; }
.query-condition-note { margin: 0.6rem 0 0; color: #725d49; }
</style>
