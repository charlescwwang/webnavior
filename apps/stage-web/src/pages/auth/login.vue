<script setup lang="ts">
import { errorMessageFrom } from '@moeru/std'
import { SERVER_URL } from '@proj-airi/stage-ui/libs/server'
import { Button, Input } from '@proj-airi/ui'
import { computed, onMounted, shallowRef } from 'vue'

const email = shallowRef('')
const password = shallowRef('')
const error = shallowRef('')
const submitting = shallowRef(false)
const testAuthenticationEnabled = shallowRef(false)
const authorizationUrl = computed(() => {
  const request = new URL(window.location.href)
  const target = new URL('/api/auth/oauth2/authorize', SERVER_URL)
  target.search = request.search
  return target.toString()
})

async function signIn() {
  submitting.value = true
  error.value = ''
  try {
    const response = await fetch(new URL(
      testAuthenticationEnabled.value
        ? '/api/webnavior/test-auth/session'
        : '/api/auth/sign-in/email',
      SERVER_URL,
    ), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(testAuthenticationEnabled.value
        ? { email: email.value }
        : { email: email.value, password: password.value }),
    })
    if (!response.ok)
      throw new Error(await response.text() || '登入失敗。')

    window.location.assign(authorizationUrl.value)
  }
  catch (cause) {
    error.value = errorMessageFrom(cause) ?? '無法登入，請確認 Email 與密碼。'
  }
  finally {
    submitting.value = false
  }
}

onMounted(async () => {
  try {
    const response = await fetch(new URL('/api/webnavior/test-auth/status', SERVER_URL), { credentials: 'include' })
    if (!response.ok)
      return

    const result = await response.json() as { enabled?: boolean }
    testAuthenticationEnabled.value = result.enabled === true
  }
  catch {
    // The standard password sign-in remains available when the API is offline.
  }
})
</script>

<template>
  <main :class="['flex min-h-screen items-center justify-center bg-slate-950 px-6 py-10 text-slate-100']">
    <section :class="['w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-7 shadow-2xl shadow-black/30']">
      <div :class="['mb-8']">
        <p :class="['mb-2 mt-0 text-sm font-semibold tracking-wide text-cyan-300']">
          WEBNAVIOR
        </p>
        <h1 :class="['m-0 text-2xl font-bold text-white']">
          管理者登入
        </h1>
        <p :class="['mb-0 mt-2 text-sm text-slate-400']">
          {{ testAuthenticationEnabled ? '測試模式：輸入已建立的帳號即可登入。' : '登入後回到 Webnavior Control Center。' }}
        </p>
      </div>

      <form :class="['flex flex-col gap-5']" @submit.prevent="signIn">
        <label :class="['flex flex-col gap-2 text-sm font-semibold text-slate-200']">
          Email
          <Input v-model="email" autocomplete="email" type="email" required />
        </label>
        <label v-if="!testAuthenticationEnabled" :class="['flex flex-col gap-2 text-sm font-semibold text-slate-200']">
          密碼
          <Input v-model="password" autocomplete="current-password" type="password" required />
        </label>
        <p v-if="error" :class="['m-0 rounded-lg bg-red-400/10 px-3 py-2 text-sm text-red-200']">
          {{ error }}
        </p>
        <Button type="submit" :disabled="submitting">
          {{ submitting ? '登入中…' : '登入' }}
        </Button>
      </form>
    </section>
  </main>
</template>

<route lang="yaml">
meta:
  layout: plain
</route>
