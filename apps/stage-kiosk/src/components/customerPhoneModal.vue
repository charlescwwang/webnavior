<script setup lang="ts">
import { Button, Input } from '@proj-airi/ui'
import { computed, onMounted, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ busy: boolean, error?: 'failed' | 'invalid', listening?: boolean }>()
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
      <div :class="['my-5 rounded-2xl bg-[#fff2e5] p-5', 'flex items-start gap-4']">
        <span aria-hidden="true" :class="['mt-1 size-9 shrink-0 text-[#d95327]', props.listening ? 'i-solar:microphone-3-bold' : 'i-solar:microphone-slash-bold']" />
        <div>
          <p id="customer-phone-description" :class="['m-0 text-lg font-semibold leading-7']">
            {{ t('stage.kiosk.customer-entry.description') }}
          </p>
          <p role="status" :class="['mb-0 mt-2 text-sm leading-6 text-[#786655]']">
            {{ t(props.listening ? 'stage.kiosk.customer-entry.listening' : 'stage.kiosk.customer-entry.not-listening') }}
          </p>
        </div>
      </div>
      <form :class="['grid gap-3 border-t border-[#eadfce] pt-5']" @submit.prevent="valid && !props.busy && emit('submit', phone)">
        <h2 :class="['m-0 text-lg font-semibold']">
          {{ t('stage.kiosk.customer-entry.phone-section-title') }}
        </h2>
        <p :class="['m-0 text-sm leading-6 text-[#786655]']">
          {{ t('stage.kiosk.customer-entry.optional') }}
        </p>
        <label for="kiosk-customer-phone" :class="['font-semibold']">{{ t('stage.kiosk.customer-entry.phone') }}</label>
        <Input id="kiosk-customer-phone" v-model="phone" type="tel" inputmode="numeric" autocomplete="off" maxlength="10" pattern="09[0-9]{8}" placeholder="09xxxxxxxx" aria-describedby="kiosk-test-phone-hint" :disabled="props.busy" :class="['min-h-14 !text-2xl']" />
        <p id="kiosk-test-phone-hint" :class="['m-0 text-sm text-[#786655]']">
          {{ t('stage.kiosk.customer-entry.test-phone-hint') }}
        </p>
        <p v-if="props.error" role="alert" :class="['m-0 text-red-700']">
          {{ t(`stage.kiosk.customer-entry.${props.error}`) }}
        </p>
        <Button type="submit" :disabled="!valid || props.busy" :class="['min-h-14 min-w-0 !whitespace-normal !bg-[#d95327] !text-white']" :label="t('stage.kiosk.customer-entry.confirm')" />
      </form>
      <Button type="button" autofocus :disabled="props.busy" variant="secondary" :class="['mt-4 min-h-12 w-full !whitespace-normal']" :label="t('stage.kiosk.customer-entry.skip')" @click="emit('skip')" />
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
