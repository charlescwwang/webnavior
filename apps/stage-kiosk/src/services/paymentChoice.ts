import type { DesktopSurfaceNavigation, GatewayChoice } from '@proj-airi/stage-shared/kiosk-desktop'

import { pbGatewayReceiptSchema } from '@proj-airi/stage-shared/pb-checkout'
import { safeParse } from 'valibot'
import { shallowRef, watch } from 'vue'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { interactiveServiceClient } from './interactiveServiceClient'

/** A whole-turn selection excludes questions, alternatives and negation. */
export function paymentChoiceFromSpeech(text: string) {
  const match = text.replaceAll(/\s/g, '').match(/^請?(?:幫我)?我?(?:想要|想|要)?(?:(?:更換|改換|換|改)[成為用]?)?(?:使用|選擇|選|用|打開)?\s*(apple\s*pay|蘋果支付|綠界\s*(?:pay|支付)|(?:信用卡)?(?:自己|自行|手動)?輸入(?:信用卡)?卡號|信用卡|刷卡|line\s*pay|賴\s*pay)(?:付款|支付|結帳)?[。！!\s]*$/i)
  const name = match?.[1]
  if (!name)
    return
  if (/apple|蘋果/i.test(name))
    return 'apple'
  if (name.startsWith('綠界'))
    return 'wallet'
  if (name.endsWith('卡號'))
    return 'card'
  return /信用卡|刷卡/.test(name) ? 'credit' : 'line'
}

/**
 * Describes this kiosk's payment choices. A question or an unspecified
 * change never carries authority to leave the current payment page.
 */
export function paymentOptionsReply(text: string, methods?: readonly string[], atPayment = false) {
  const compact = text.replaceAll(/\s/g, '')
  const question = /有無|有沒有|能不能|可不可以|是否(?:有|能|支援)|(?:可以|能用|有|支援|接受).*嗎|哪些|哪(?:幾|一)?種|什麼(?:付款|支付|方式)|(?:付款|支付)方式.*什麼|怎麼付|如何付|有(?:其他|別的|別種)|還有|支援|支持/.test(compact)
  const paymentTopic = /付款|支付|付錢|付費|結帳方式|一卡通|悠遊卡|街口|現金|信用卡|刷卡|行動支付|(?:apple|line|綠界)pay/i.test(compact)
  const change = /^請?(?:幫我)?我?(?:想要|想|要)?(?:更換|換|改)(?:個|一個|一種|其他|別的|成別的|成其他)?(?:(?:付款|支付|付費)的?(?:方式|方案)|方式|一種)[。！!]*$/.test(compact)
  const otherOptions = /^(?:請問)?(?:還有沒有|還有|有沒有|有)(?:其他|別的|別種)(?:的|方式|選擇)?(?:嗎|呢)?[？?。！!]*$/.test(compact)
  const unsupported = /^(?:我要用|我想用|用)?一卡通[？?。！!]*$/.test(compact)
  if (!unsupported && (!question || (!paymentTopic && (!atPayment || !otherOptions))) && (!change || (!paymentTopic && !atPayment)))
    return
  const options: string[] = []
  if (!methods || methods.some(method => /^line\s*pay$/i.test(method.trim())))
    options.push('LINE Pay')
  if (!methods || methods.some(method => /^(?:信用卡|credit(?:\s*card)?)$/i.test(method.trim())))
    options.push('信用卡', 'Apple Pay', '綠界 Pay')
  const labels = options.join('、')
  if (!labels)
    return '這張訂單目前沒有可用的付款入口。'
  const prefix = compact.includes('一卡通') ? '目前這台點餐機沒有提供一卡通。' : ''
  return `${prefix}可以使用${labels}。${change ? '您想換成哪一種？' : ''}`
}

/** Only a whole navigation command may leave the current payment provider. */
export function requestsPaymentReturn(text: string) {
  const compact = text.replaceAll(/\s/g, '').replace(/[。！!]+$/, '')
  // A failed payment alone has no navigation intent. Only strip a reason when
  // the remainder independently asks to go back or choose a different method.
  const command = compact.replace(/^(?:這張卡|這個方式|信用卡|這個)?(?:刷不過|不能用|不支援|付不了|付款失敗)[，,。]?/, '')
    .replace(/^(?:麻煩|請)?(?:幫我)?(?:我(?:想要|想|要))?/, '')
  if (/^(?:上一頁|上一步|回上一頁重新選|回去重選付款方式)$/.test(command))
    return true
  const back = /^(?:返回|回到|回去|回|退回去|退回|退到|退)(?:上一頁|上一步|(?:選擇?|選擇其他)?(?:付款|支付)方式(?:選擇)?的?(?:頁面|畫面|頁)?|重選)$/
  const reselect = /^(?:重新選擇|重新選|重選|更換|換|改換|改)(?:一個|個|一種|種|其他|別的|別種)?(?:付款|支付)(?:方式|方法)$/
  return back.test(command) || reselect.test(command)
}

export const gatewayPage = shallowRef<DesktopSurfaceNavigation>()

/**
 * Waits only for the original order's cashier. Recheck customer ownership
 * after navigation, and let Electron verify the native document revision again.
 */
export async function chooseGateway(choice: GatewayChoice, reference: string, isCurrent: () => boolean): Promise<{ ok: boolean, source: string, customerMessage: string, returnRequired?: boolean }> {
  const messages = orderingMessages['zh-Hant'].checkout.gateway
  const unavailable = { ok: false, source: 'browser', customerMessage: messages.unavailable }
  if (!gatewayPage.value?.gatewayOrder && isCurrent()) {
    await new Promise<void>((resolve) => {
      let stop: () => void
      let timer: ReturnType<typeof setTimeout>
      const finish = () => {
        stop()
        clearTimeout(timer)
        resolve()
      }
      stop = watch(gatewayPage, (page) => {
        if (page?.gatewayOrder || !isCurrent())
          finish()
      }, { flush: 'sync' })
      timer = setTimeout(finish, 8000)
    })
  }
  const page = gatewayPage.value
  if (!isCurrent() || page?.gatewayOrder !== reference || !window.airiKioskDesktop)
    return unavailable
  try {
    const status = await window.airiKioskDesktop.invokeService({ serviceId: page.serviceId, documentKey: page.documentKey, command: { kind: 'choose-gateway', revision: page.revision, reference, choice } })
    if (gatewayPage.value !== page || !isCurrent())
      return unavailable
    if (status === 'return-required')
      return { ...unavailable, returnRequired: true }
    if (status === 'card-ready' || status === 'wallet-ready' || status === 'apple-opened' || status === 'apple-requested')
      return { ok: true, source: 'browser', customerMessage: messages[status] }
  }
  catch { /* The provider may already have switched documents. Never retry a click. */ }
  return unavailable
}

/**
 * Switches gateways through the original PB order. The native PB open command
 * re-reads the order and checks pending status immediately before dispatch.
 */
export async function switchPayment(page: DesktopSurfaceNavigation, choice: NonNullable<ReturnType<typeof paymentChoiceFromSpeech>> | 'back', current: () => boolean) {
  const unavailable = { ok: false, customerMessage: orderingMessages['zh-Hant'].checkout.gateway.unavailable }
  const reference = page.gatewayOrder
  if (!reference || !current() || gatewayPage.value !== page)
    return unavailable
  if (page.paymentProvider === 'line' && choice === 'line')
    return { ok: true, customerMessage: '目前已在 LINE Pay 付款頁。' }
  if (page.paymentProvider === 'ecpay' && choice !== 'line' && choice !== 'back') {
    const local = await chooseGateway(choice === 'credit' ? 'card' : choice, reference, current)
    if (!local.returnRequired)
      return local
  }
  try {
    if (!current() || gatewayPage.value !== page)
      return unavailable
    const returned = await window.airiKioskDesktop?.invokeService({ serviceId: page.serviceId, documentKey: page.documentKey, command: { kind: 'return-payment', revision: page.revision, reference } })
    if (returned !== 'returned' || !current())
      return unavailable
    if (choice === 'back')
      return { ok: true, customerMessage: orderingMessages['zh-Hant'].checkout.gateway.returned }
    // loadURL resolves in main before Vue necessarily processes its navigation
    // event. The old manual page has no tools; wait for its replacement first.
    if (interactiveServiceClient.availability.value === 'manual-payment') {
      await new Promise<void>((resolve) => {
        let stop: () => void
        let timer: ReturnType<typeof setTimeout>
        const finish = () => {
          stop()
          clearTimeout(timer)
          resolve()
        }
        stop = watch(interactiveServiceClient.availability, finish, { flush: 'sync' })
        timer = setTimeout(finish, 8000)
      })
    }
    await interactiveServiceClient.waitUntilReady()
    const open = interactiveServiceClient.tools.value.find(tool => tool.name === 'browser_payment_open')
    if (!open || !current())
      return unavailable
    const method = choice === 'line' ? 'LinePay' : 'Credit'
    const result = await interactiveServiceClient.execute(open, { method, reference })
    const opened = safeParse(pbGatewayReceiptSchema, result)
    if (!opened.success || opened.output.reference !== reference || opened.output.method !== method)
      return unavailable
    if (choice !== 'line' && choice !== 'credit')
      return chooseGateway(choice, reference, current)
    return { ok: true, customerMessage: choice === 'line' ? '已點選 LINE Pay，請在畫面繼續。' : '已點選信用卡，請在綠界選擇付款方式。' }
  }
  catch { return unavailable }
}
