<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  defaultHeight?: string
  submitOnEnter?: boolean
}>(), {
  submitOnEnter: true,
})

const events = defineEmits<{
  (event: 'submit', message: string): void
  (event: 'pasteFile', files: File[]): void
}>()

const input = defineModel<string>({
  default: '',
})

const textareaRef = ref<HTMLTextAreaElement>()
const textareaHeight = ref('auto')
const isComposing = ref(false)

function onKeyDown(e: KeyboardEvent) {
  if (!props.submitOnEnter)
    return

  // NOTICE: IME commit Enter belongs to text input, not submission. Some browsers
  // emit compositionend before that keydown, leaving only keyCode 229.
  // https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event#keydown_events_with_ime
  if (isComposing.value || e.isComposing || e.keyCode === 229)
    return

  if (e.code === 'Enter' && !e.shiftKey) { // just block Enter is enough, Shift+Enter by default generates a newline
    e.preventDefault()
    // A held key must neither submit again nor insert a newline.
    if (e.repeat)
      return
    events('submit', input.value)
  }
}

function onPaste(e: ClipboardEvent) {
  if (!e.clipboardData)
    return

  const { files } = e.clipboardData
  if (files.length > 0) {
    e.preventDefault()
    events('pasteFile', Array.from(files))
  }
}

// javascript - Creating a textarea with auto-resize - Stack Overflow
// https://stackoverflow.com/questions/454202/creating-a-textarea-with-auto-resize
watch(input, () => {
  textareaHeight.value = 'auto'
  requestAnimationFrame(() => {
    if (!textareaRef.value)
      return
    if (input.value === '') {
      textareaHeight.value = props.defaultHeight || 'fit-content'
      return
    }

    // NOTICE: not sure why 4px is required but if not added, when
    // input happened and placeholder now disappeared, the textarea will shrink
    // a little bit and cause the input box to shake.
    // TODO: find out the root cause and remove this magic number, or at least
    // reference a more specific source.
    textareaHeight.value = `${textareaRef.value.scrollHeight + 4}px`
  })
}, { immediate: true })
</script>

<template>
  <textarea
    ref="textareaRef"
    v-model="input"
    :style="{ height: textareaHeight }"
    @keydown="onKeyDown"
    @compositionstart="isComposing = true"
    @compositionend="isComposing = false"
    @paste="onPaste"
  />
</template>
