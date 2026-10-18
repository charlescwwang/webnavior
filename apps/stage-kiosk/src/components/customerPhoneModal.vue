<script setup lang="ts">
import { Button, Input } from '@proj-airi/ui'
import { computed, onMounted, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ busy: boolean, error?: 'failed' | 'invalid' }>()
const emit = defineEmits<{ activity: [], submit: [phone: string], skip: [] }>()
const { t } = useI18n()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const phone = shallowRef('')
const valid = computed(() => /^09\d{8}$/.test(phone.value))
// A document-modal dialog would also disable the upper avatar/conversation.
// The surrounding ordering-region overlay owns the local interaction boundary.
onMounted(() => dialog.value?.show())
</script>

<template>
  <div :class="['customer-phone-overlay']">
    <dialog
      ref="dialog"
      aria-labelledby="customer-phone-title"
      aria-describedby="customer-phone-description"
      :class="['customer-phone-modal', 'overflow-y-auto rounded-3xl border-0 bg-white p-7 text-[#3d281c] shadow-2xl sm:p-10']"
      @cancel.prevent="!props.busy && emit('skip')"
      @pointerdown="emit('activity')"
      @keydown="emit('activity')"
      @keydown.esc.prevent="!props.busy && emit('skip')"
    >
      <h1 id="customer-phone-title" :class="['m-0 text-2xl font-bold sm:text-3xl']">
        {{ t('stage.kiosk.customer-entry.title') }}
      </h1>
      <p id="customer-phone-description" :class="['mb-6 mt-4 leading-7 text-[#786655]']">
        {{ t('stage.kiosk.customer-entry.description') }}
      </p>
      <form :class="['grid gap-4']" @submit.prevent="valid && !props.busy && emit('submit', phone)">
        <label for="kiosk-customer-phone" :class="['font-semibold']">{{ t('stage.kiosk.customer-entry.phone') }}</label>
        <Input id="kiosk-customer-phone" v-model="phone" type="tel" inputmode="numeric" autocomplete="off" maxlength="10" pattern="09[0-9]{8}" placeholder="09xxxxxxxx" aria-describedby="kiosk-test-phone-hint" :disabled="props.busy" :class="['min-h-14 !text-2xl']" />
        <p id="kiosk-test-phone-hint" :class="['m-0 text-sm text-[#786655]']">
          {{ t('stage.kiosk.customer-entry.test-phone-hint') }}
        </p>
        <p v-if="props.error" role="alert" :class="['m-0 text-red-700']">
          {{ t(`stage.kiosk.customer-entry.${props.error}`) }}
        </p>
        <div :class="['grid grid-cols-2 gap-3']">
          <Button type="button" autofocus :disabled="props.busy" variant="secondary" :class="['min-h-14 min-w-0 !whitespace-normal']" :label="t('stage.kiosk.customer-entry.skip')" @click="emit('skip')" />
          <Button type="submit" :disabled="!valid || props.busy" :class="['min-h-14 min-w-0 !whitespace-normal !bg-[#d95327] !text-white']" :label="t('stage.kiosk.customer-entry.confirm')" />
        </div>
      </form>
      <p :class="['mb-0 mt-5 text-sm leading-6 text-[#786655]']">
        {{ t('stage.kiosk.customer-entry.voice-hint') }}
      </p>
    </dialog>
  </div>
</template>

<style scoped>
.customer-phone-overlay { position: absolute; inset: 0; z-index: 10; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); place-items: center; box-sizing: border-box; overflow: hidden; padding: clamp(12px, 2vw, 24px); background: rgb(16 23 25 / 25%); }
.customer-phone-modal { position: relative; inset: auto; box-sizing: border-box; width: min(36rem, 100%); min-height: 0; max-height: 100%; overflow-y: auto; margin: 0; }
</style>
