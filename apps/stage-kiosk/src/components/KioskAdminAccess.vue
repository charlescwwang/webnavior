<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { useTimeoutFn } from '@vueuse/core'
import { shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { beginKioskAdminSession } from '../services/admin-session'

defineOptions({ inheritAttrs: false })

const router = useRouter()
const route = useRoute()
const { t } = useI18n()

const configuredPin = import.meta.env.VITE_KIOSK_ADMIN_PIN?.trim()
let tapCount = 0
const pin = shallowRef('')
const pinError = shallowRef('')
const pinPromptOpen = shallowRef(false)

// One two-second sequence owns the five taps. VueUse cancels the deadline on
// scope disposal, so taps cannot carry into a later scene or PIN prompt.
const { start: startTapWindow, stop: stopTapWindow } = useTimeoutFn(() => {
  tapCount = 0
}, 2_000, { immediate: false })

function registerTap() {
  if (pinPromptOpen.value)
    return
  if (tapCount === 0)
    startTapWindow()
  tapCount += 1
  if (tapCount < 5)
    return
  tapCount = 0
  stopTapWindow()
  pin.value = ''
  pinError.value = ''
  pinPromptOpen.value = true
}

function appendDigit(digit: string) {
  pin.value += digit
  pinError.value = ''
}

function editPin(removeLast: boolean) {
  pin.value = removeLast ? pin.value.slice(0, -1) : ''
  pinError.value = ''
}

function unlockAdmin() {
  if (!configuredPin) {
    pinError.value = t('stage.kiosk.admin-access.missing-pin')
    return
  }

  if (pin.value !== configuredPin) {
    pinError.value = t('stage.kiosk.admin-access.incorrect-pin')
    return
  }

  pin.value = ''
  pinError.value = ''
  pinPromptOpen.value = false
  beginKioskAdminSession()
  // Keep the customer scene mounted: navigating to the dedicated settings
  // route destroys and recreates the embedded interactive service.
  void router.push({ path: '/', query: { ...route.query, admin: 'true' } })
}

function closePrompt() {
  pin.value = ''
  pinError.value = ''
  pinPromptOpen.value = false
}
</script>

<template>
  <button
    v-bind="$attrs"
    type="button"
    :class="['admin-trigger']"
    data-kiosk-admin-control
    :aria-label="t('stage.kiosk.admin-access.trigger')"
    @click="registerTap"
  >
    <slot />
  </button>

  <Teleport to="body">
    <div v-if="pinPromptOpen" :class="['admin-backdrop']" data-kiosk-admin-control @click.self="closePrompt">
      <form :class="['pin-dialog']" role="dialog" aria-modal="true" aria-labelledby="kiosk-admin-pin-title" @submit.prevent="unlockAdmin" @keydown.esc.prevent="closePrompt">
        <span :class="['pin-kicker']">{{ t('stage.kiosk.admin-access.mode') }}</span>
        <h2 id="kiosk-admin-pin-title">
          {{ t('stage.kiosk.admin-access.title') }}
        </h2>
        <p>{{ t('stage.kiosk.admin-access.description') }}</p>
        <input v-model="pin" type="password" inputmode="none" autocomplete="off" :aria-label="t('stage.kiosk.admin-access.pin-label')" autofocus>
        <p v-if="pinError" :class="['pin-error']" role="alert">
          {{ pinError }}
        </p>
        <div role="group" :aria-label="t('stage.kiosk.admin-access.keypad')" :class="['grid grid-cols-3 gap-2']">
          <Button v-for="digit in ['1', '2', '3', '4', '5', '6', '7', '8', '9']" :key="digit" type="button" :label="digit" variant="secondary" size="lg" :class="['min-h-13']" @click="appendDigit(digit)" />
          <Button type="button" :label="t('stage.kiosk.admin-access.clear')" variant="secondary" :class="['min-h-13']" @click="editPin(false)" />
          <Button type="button" label="0" variant="secondary" size="lg" :class="['min-h-13']" @click="appendDigit('0')" />
          <Button type="button" :label="t('stage.kiosk.admin-access.backspace')" variant="secondary" :class="['min-h-13']" @click="editPin(true)" />
        </div>
        <div :class="['pin-actions']">
          <Button type="button" :label="t('stage.kiosk.admin-access.cancel')" variant="secondary" @click="closePrompt" />
          <Button type="submit" :label="t('stage.kiosk.admin-access.continue')" />
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.admin-trigger { touch-action: manipulation; border: 0; font: inherit; text-align: inherit; cursor: default; }
.admin-backdrop { position: fixed; z-index: 100; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / 58%); backdrop-filter: blur(.35rem); }
.pin-dialog { max-height: calc(100dvh - 2rem); overflow-y: auto; display: grid; width: min(24rem, calc(100vw - 2rem)); gap: .8rem; border: 1px solid rgb(255 255 255 / 18%); border-radius: 1.25rem; padding: 1.4rem; color: #ecfffb; background: #0d2225; box-shadow: 0 2rem 7rem rgb(0 0 0 / 52%); }
.pin-kicker { color: #8bd9cb; font-size: .72rem; font-weight: 800; letter-spacing: .08em; }
.pin-dialog h2, .pin-dialog p { margin: 0; }
.pin-dialog p { color: rgb(217 250 246 / 74%); font-size: .9rem; line-height: 1.5; }
.pin-dialog input { border: 1px solid rgb(255 255 255 / 20%); border-radius: .75rem; padding: .7rem .8rem; color: #ecfffb; background: rgb(255 255 255 / 8%); outline: none; }
.pin-error { color: #ffc78d !important; }
.pin-actions { display: flex; justify-content: end; gap: .6rem; }
</style>
