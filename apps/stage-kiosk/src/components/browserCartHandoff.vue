<script setup lang="ts">
import type { createInteractiveServiceClient } from '@proj-airi/stage-ui/services/interactiveServiceClient'

import type { createBrowserCartSession } from '../services/browserCartSession'

import { errorMessageFrom } from '@moeru/std'
import { Button, Checkbox } from '@proj-airi/ui'
import { array, boolean, literal, looseObject, number, optional, parse, safeParse, string } from 'valibot'
import { onBeforeUnmount, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  bridge: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute' | 'getDocumentId'>
  gate: ReturnType<typeof createBrowserCartSession>
  serviceUrl: string
  owner?: string
  authorized: boolean
  operationPending: boolean
}>()
const emit = defineEmits<{ prepare: [], resumed: [] }>()
const { t } = useI18n()
const cartSchema = looseObject({ cart: looseObject({ version: string(), subtotal: number(), lines: array(looseObject({ ref: string(), name: string(), quantity: number(), unitPrice: number(), description: optional(string()) })) }) })
type Review = ReturnType<typeof readCart> & { owner: string, serviceUrl: string, documentId: string }
const review = shallowRef<Review>()
const checked = shallowRef(false)
const busy = shallowRef(false)
const error = shallowRef<string>()
let generation = 0

function readCart(raw: unknown) {
  const refused = safeParse(looseObject({ ok: literal(false), customerMessage: optional(string()), error: optional(string()) }), raw)
  if (refused.success) {
    // Explicit vendor/bridge refusal is different from a malformed cart shape.
    if (refused.output.customerMessage)
      throw new Error(refused.output.customerMessage)
    throw new Error(refused.output.error ?? t('stage.kiosk.cart-handoff.failed'))
  }
  return parse(cartSchema, raw).cart
}
function revokeReview() {
  generation++
  review.value = undefined
  checked.value = false
}
watch(() => [props.owner, props.serviceUrl, props.authorized], revokeReview)
onBeforeUnmount(revokeReview)

async function inspect() {
  if (!props.authorized || !props.owner || props.operationPending || busy.value)
    return
  revokeReview()
  const ticket = generation
  const owner = props.owner
  const serviceUrl = props.serviceUrl
  const documentId = props.bridge.getDocumentId()
  const tool = props.bridge.tools.value.find(tool => tool.name === 'browser_cart_get')
  if (!tool || !documentId)
    return
  busy.value = true
  error.value = undefined
  try {
    const cart = readCart(await props.bridge.execute(tool, { includeCatalog: false }))
    if (ticket !== generation || !props.authorized || props.bridge.getDocumentId() !== documentId)
      return
    review.value = { ...cart, owner, serviceUrl, documentId }
  }
  catch (caught) { error.value = errorMessageFrom(caught) ?? t('stage.kiosk.cart-handoff.failed') }
  finally { busy.value = false }
}

async function resume() {
  const current = review.value
  if (!props.authorized || props.operationPending || busy.value || !checked.value || !current)
    return
  busy.value = true
  error.value = undefined
  const ticket = generation
  try {
    const read = props.bridge.tools.value.find(tool => tool.name === 'browser_cart_get')
    const recovery = props.bridge.tools.value.find(tool => tool.name === 'browser_recovery_context')
    if (!read || !recovery)
      throw new Error(t('stage.kiosk.cart-handoff.failed'))
    const status = parse(looseObject({ canRetry: boolean() }), await props.bridge.execute(recovery, {}))
    if (!status.canRetry)
      throw new Error(t('stage.kiosk.cart-handoff.unknown'))
    const fresh = await props.bridge.execute(read, { includeCatalog: false })
    if (ticket !== generation || !props.authorized || props.operationPending || props.owner !== current.owner || props.serviceUrl !== current.serviceUrl || props.bridge.getDocumentId() !== current.documentId)
      throw new Error(t('stage.kiosk.cart-handoff.changed'))
    props.gate.resume(current.owner, current.serviceUrl, current.version, fresh)
    revokeReview()
    emit('resumed')
  }
  catch (caught) {
    const message = errorMessageFrom(caught)
    error.value = message === 'CART_REVIEW_CHANGED' ? t('stage.kiosk.cart-handoff.changed') : message ?? t('stage.kiosk.cart-handoff.failed')
    revokeReview()
  }
  finally { busy.value = false }
}
</script>

<template>
  <section v-if="props.authorized" :class="['grid gap-3 rounded-xl border border-slate-500/30 p-4']" :aria-label="t('stage.kiosk.cart-handoff.title')">
    <h3>{{ t('stage.kiosk.cart-handoff.title') }}</h3>
    <p>{{ t('stage.kiosk.cart-handoff.explanation') }}</p>
    <Button v-if="!props.owner" :disabled="busy || props.operationPending" @click="emit('prepare')">
      {{ t('stage.kiosk.cart-handoff.prepare') }}
    </Button>
    <Button v-else :disabled="busy || props.operationPending" @click="inspect">
      {{ t('stage.kiosk.cart-handoff.inspect') }}
    </Button>
    <template v-if="review">
      <ul :class="['m-0 grid gap-2 pl-5']">
        <li v-for="line in review.lines" :key="line.ref">
          {{ line.name }} {{ line.description }} × {{ line.quantity }} — {{ line.unitPrice * line.quantity }}
        </li>
      </ul>
      <p>{{ t('stage.kiosk.cart-handoff.total', { amount: review.subtotal }) }}</p>
      <label :class="['flex items-center gap-2']">
        <Checkbox v-model="checked" :aria-label="t('stage.kiosk.cart-handoff.reviewed')" />
        {{ t('stage.kiosk.cart-handoff.reviewed') }}
      </label>
      <Button :disabled="!checked || busy || props.operationPending" @click="resume">
        {{ t('stage.kiosk.cart-handoff.resume') }}
      </Button>
    </template>
    <p v-if="error" role="alert">
      {{ error }}
    </p>
  </section>
</template>
