<script setup lang="ts">
import { onUnmounted, shallowRef } from 'vue'
import { useRouter } from 'vue-router'

import { beginKioskAdminSession } from '../services/admin-session'

const router = useRouter()

const configuredPin = import.meta.env.VITE_KIOSK_ADMIN_PIN?.trim()
const holdTimer = shallowRef<ReturnType<typeof setTimeout> | undefined>()
const pin = shallowRef('')
const pinError = shallowRef('')
const pinPromptOpen = shallowRef(false)

function clearHoldTimer() {
  if (holdTimer.value)
    clearTimeout(holdTimer.value)
  holdTimer.value = undefined
}

function beginHold() {
  clearHoldTimer()
  holdTimer.value = setTimeout(() => {
    pinPromptOpen.value = true
    holdTimer.value = undefined
  }, 1_200)
}

function cancelHold() {
  clearHoldTimer()
}

function unlockAdmin() {
  if (!configuredPin) {
    pinError.value = '尚未設定管理員 PIN。請設定 VITE_KIOSK_ADMIN_PIN 後重新啟動 Kiosk。'
    return
  }

  if (pin.value !== configuredPin) {
    pinError.value = 'PIN 不正確，請再試一次。'
    return
  }

  pin.value = ''
  pinError.value = ''
  pinPromptOpen.value = false
  beginKioskAdminSession()
  void router.push('/settings')
}

function closePrompt() {
  pin.value = ''
  pinError.value = ''
  pinPromptOpen.value = false
}

onUnmounted(clearHoldTimer)
</script>

<template>
  <button
    type="button"
    class="admin-trigger"
    data-kiosk-admin-control
    aria-label="長按以開啟管理員模式"
    @pointerdown="beginHold"
    @pointerleave="cancelHold"
    @pointerup="cancelHold"
    @pointercancel="cancelHold"
  >
    <slot />
  </button>

  <Teleport to="body">
    <div v-if="pinPromptOpen" class="admin-backdrop" data-kiosk-admin-control @click.self="closePrompt">
      <form class="pin-dialog" @submit.prevent="unlockAdmin">
        <span class="pin-kicker">管理員模式</span>
        <h2>輸入 PIN</h2>
        <p>請輸入管理員 PIN 以調整 Kiosk 設定。</p>
        <input v-model="pin" type="password" inputmode="numeric" autocomplete="off" autofocus>
        <p v-if="pinError" class="pin-error">
          {{ pinError }}
        </p>
        <div class="pin-actions">
          <button type="button" class="secondary-button" @click="closePrompt">
            取消
          </button>
          <button type="submit" class="primary-button">
            繼續
          </button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.admin-trigger { border: 0; font: inherit; text-align: inherit; cursor: default; }
.admin-backdrop { position: fixed; z-index: 29; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / 58%); backdrop-filter: blur(.35rem); }
.pin-dialog { display: grid; width: min(24rem, calc(100vw - 2rem)); gap: .8rem; border: 1px solid rgb(255 255 255 / 18%); border-radius: 1.25rem; padding: 1.4rem; color: #ecfffb; background: #0d2225; box-shadow: 0 2rem 7rem rgb(0 0 0 / 52%); }
.pin-kicker { color: #8bd9cb; font-size: .72rem; font-weight: 800; letter-spacing: .08em; }
.pin-dialog h2, .pin-dialog p { margin: 0; }
.pin-dialog p { color: rgb(217 250 246 / 74%); font-size: .9rem; line-height: 1.5; }
.pin-dialog input { border: 1px solid rgb(255 255 255 / 20%); border-radius: .75rem; padding: .7rem .8rem; color: #ecfffb; background: rgb(255 255 255 / 8%); outline: none; }
.pin-error { color: #ffc78d !important; }
.pin-actions { display: flex; justify-content: end; gap: .6rem; }
.primary-button, .secondary-button { border: 0; border-radius: .7rem; padding: .6rem .9rem; cursor: pointer; }
.primary-button { color: #063437; background: #78e1d1; }
.secondary-button { color: #d9faf6; background: rgb(255 255 255 / 10%); }
</style>
