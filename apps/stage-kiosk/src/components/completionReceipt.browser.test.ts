import { expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick, toRaw } from 'vue'
import { createI18n } from 'vue-i18n'

import CustomerSessionCompletion from '../../../../packages/stage-ui/src/components/scenarios/customer-session/CustomerSessionCompletion.vue'

import { defaultFeedbackInvitationSettings } from '../../../../packages/stage-ui/src/components/scenarios/feedback-invitation/settings'
import { useFeedbackInvitationEnabled, useFeedbackInvitationSettings } from '../composables/useFeedbackInvitationSettings'
import { kioskInteractionProfile } from '../composables/useKioskInteractiveServices'

const global = { plugins: [createI18n({ legacy: false, locale: 'en', messages: {} })] }

it('keeps the POS order identifier visible with the survey switched off', async () => {
  const screen = render(CustomerSessionCompletion, { global, props: {
    settings: { ...defaultFeedbackInvitationSettings, enabled: false, surveyUrl: 'https://example.com/survey' },
    orderContinuationUrl: 'https://menu.example/menu/?continuation=receipt-token',
    orderResult: { environment: 'live', fulfillmentMode: 'takeout', id: 'local-123', posOrderId: 'POS-42', pickupNumber: '368', status: 'accepted', itemCount: 1, total: 100 },
  } })
  try {
    await expect.element(screen.getByText('POS-42', { exact: true })).not.toBeVisible()
    await screen.getByText('stage.customer-session.completion.order-number', { exact: true }).click()
    await expect.element(screen.getByText('POS-42', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('368', { exact: true })).toBeVisible()
    await expect.element(screen.getByRole('img', { name: 'stage.customer-session.completion.order-qr-alt', exact: true })).toBeVisible()
    await expect.element(screen.getByRole('link', { name: 'stage.customer-session.completion.order-link', exact: true })).toHaveAttribute('href', 'https://menu.example/menu/?continuation=receipt-token')
    await expect.element(screen.getByText('stage.customer-session.completion.pickup-unavailable')).not.toBeInTheDocument()
    await expect.element(screen.getByRole('img', { name: 'stage.customer-session.completion.qr-alt', exact: true })).not.toBeInTheDocument()
  }
  finally { screen.unmount() }
})

it('does not turn a local order id into a pickup number when POS omitted its id', async () => {
  const screen = render(CustomerSessionCompletion, { global, props: {
    settings: { ...defaultFeedbackInvitationSettings },
    orderResult: { environment: 'test', fulfillmentMode: 'takeout', id: 'local-123', status: 'accepted', itemCount: 1, total: 100 },
  } })
  try {
    await expect.element(screen.getByText('local-123', { exact: true })).not.toBeInTheDocument()
    await expect.element(screen.getByText('stage.customer-session.completion.pickup-unavailable')).toBeVisible()
    await expect.element(screen.getByText('stage.customer-session.completion.simulated-notice')).toBeVisible()
  }
  finally { screen.unmount() }
})

it('preserves the local survey switch when a published profile is applied again', async () => {
  const previous = structuredClone(toRaw(kioskInteractionProfile.profile.value))
  const screen = render(defineComponent({ setup() {
    const enabled = useFeedbackInvitationEnabled()
    const settings = useFeedbackInvitationSettings()
    return () => h('div', [
      h('button', { onClick: () => enabled.value = false }, 'Disable survey'),
      h('output', settings.value.enabled ? 'Survey enabled' : 'Survey disabled'),
    ])
  } }))
  try {
    kioskInteractionProfile.profile.value = { ...previous, feedbackInvitation: { ...defaultFeedbackInvitationSettings, enabled: true, surveyUrl: 'https://example.com/survey' } }
    await screen.getByRole('button', { name: 'Disable survey' }).click()
    kioskInteractionProfile.profile.value = { ...kioskInteractionProfile.profile.value }
    await nextTick()
    await expect.element(screen.getByText('Survey disabled', { exact: true })).toBeVisible()
    expect(localStorage.getItem('kiosk/feedback-invitation/enabled')).toBe('false')
  }
  finally {
    screen.unmount()
    kioskInteractionProfile.profile.value = previous
    localStorage.removeItem('kiosk/feedback-invitation/enabled')
  }
})

it('shows table, meal details and total without pickup details for table service', async () => {
  const screen = render(CustomerSessionCompletion, { global, props: {
    settings: { ...defaultFeedbackInvitationSettings },
    orderResult: { environment: 'test', serviceMode: 'table-service', table: { id: 'a03', label: 'a03' }, lines: [{ name: '水餃', quantity: 2, total: 160 }], fulfillmentMode: 'dine-in', id: 'table-order-1', status: 'accepted', itemCount: 2, total: 160 },
  } })
  try {
    await expect.element(screen.getByRole('heading', { name: 'stage.customer-session.completion.table-number a03' })).toBeVisible()
    await expect.element(screen.getByText('水餃 × 2 · 160元', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('stage.customer-session.completion.total 160元', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('stage.customer-session.completion.pickup-unavailable')).not.toBeInTheDocument()
    await expect.element(screen.getByRole('heading', { name: 'stage.customer-session.completion.pickup-number' })).not.toBeInTheDocument()
  }
  finally { screen.unmount() }
})

// Report: this chat, 2026-11-06 — lowercase table letters and oversized simulator IDs.
it('prioritizes uppercase table and total while collapsing a long simulator reference', async () => {
  const screen = render(CustomerSessionCompletion, { global, props: {
    settings: { ...defaultFeedbackInvitationSettings, enabled: false },
    orderResult: { environment: 'test', serviceMode: 'table-service', table: { id: 'a08', label: 'a08' }, fulfillmentMode: 'dine-in', id: 'local', posOrderId: 'SIMULATOR-VERY-LONG-INTERNAL-REFERENCE-123456789', status: 'accepted', itemCount: 1, total: 100, lines: [{ name: '蝦捲', quantity: 1, total: 100 }] },
  } })
  try {
    await expect.element(screen.getByText('A08', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('SIMULATOR-VERY-LONG-INTERNAL-REFERENCE-123456789', { exact: true })).not.toBeVisible()
    expect(screen.getByText('stage.customer-session.completion.simulated-notice', { exact: true }).element().classList.contains('simulation-notice')).toBe(true)
    await expect.element(screen.getByText('蝦捲 × 1 · 100元', { exact: true })).toBeVisible()
  }
  finally { screen.unmount() }
})
