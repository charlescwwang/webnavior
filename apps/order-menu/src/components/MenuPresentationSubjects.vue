<script setup lang="ts">
import type { QueryPresentationSubject } from '../webmcp'

const props = defineProps<{
  selectedId?: string
  subjects: QueryPresentationSubject[]
}>()
const emit = defineEmits<{ select: [subjectId: string | undefined] }>()
</script>

<template>
  <nav class="presentation-subjects" aria-label="顧客提到的餐點方向">
    <button
      :aria-pressed="!props.selectedId"
      :class="['presentation-subject-button', { 'is-selected': !props.selectedId }]"
      type="button"
      @click="emit('select', undefined)"
    >
      綜合顯示
    </button>
    <button
      v-for="subject in props.subjects"
      :key="subject.id"
      :aria-pressed="props.selectedId === subject.id"
      :class="['presentation-subject-button', { 'is-selected': props.selectedId === subject.id }]"
      type="button"
      @click="emit('select', subject.id)"
    >
      {{ subject.label }} <span>{{ subject.itemIds.length }}</span>
    </button>
  </nav>
</template>

<style scoped>
.presentation-subjects { display:flex; flex-wrap:wrap; gap:.55rem; margin:-.15rem 0 1rem; }.presentation-subject-button { border:1px solid #ead7c9; border-radius:999px; padding:.45rem .7rem; background:#fffaf5; color:#70412b; font-size:.82rem; font-weight:700; }.presentation-subject-button span { margin-left:.25rem; color:#9a694f; }.presentation-subject-button.is-selected { border-color:#d95327; background:#d95327; color:#fff; }.presentation-subject-button.is-selected span { color:#fff2e8; }
</style>
