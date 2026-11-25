<script setup lang="ts">
import { gatewayPage, switchPayment } from '../services/paymentChoice'

const props = defineProps<{ disabled: boolean, label: string, owner: () => () => boolean }>()
const emit = defineEmits<{ result: [message: string] }>()
const busy = defineModel<boolean>('busy', { required: true })

async function returnToMethods() {
  const page = gatewayPage.value
  const current = props.owner()
  if (!page?.gatewayOrder || busy.value || props.disabled || !current())
    return
  busy.value = true
  try {
    const result = await switchPayment(page, 'back', current)
    if (current())
      emit('result', result.customerMessage)
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <button type="button" :disabled="disabled || busy" @click="returnToMethods">
    <span :class="['i-solar:arrow-left-outline h-4 w-4']" aria-hidden="true" />
    {{ label }}
  </button>
</template>
