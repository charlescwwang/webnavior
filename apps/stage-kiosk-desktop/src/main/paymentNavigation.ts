import { isPbJourneyPage, isPbOrderResultUrl, readPbStateJourney } from '@proj-airi/stage-shared/pb-journey'

/** Owns manual LINE Pay / credit navigation only; provider documents never gain PB tool authority. */
export function createPaymentNavigation(entry: string) {
  const journey = readPbStateJourney(entry)
  const origin = new URL(entry).origin
  let orderReference: string | undefined
  let providerEntered = false
  let method: string | undefined
  const providers = new Set(['https://web-pay.line.me', 'https://access.line.me', 'https://payment.ecpay.com.tw'])
  const referenceAt = (url: URL) => journey && url.origin === journey.origin && url.pathname.startsWith(journey.basePath)
    ? url.pathname.slice(journey.basePath.length).match(/^orders\/([\w-]{1,200})\/choosePayment$/)?.[1]
    : undefined
  return {
    isManualPage(value: string) {
      const url = new URL(value)
      const merchantCallback = url.origin === origin && !isPbJourneyPage(entry, value) && !isPbOrderResultUrl(entry, value)
      return Boolean(orderReference && (merchantCallback
        || (providerEntered && url.protocol === 'https:' && url.origin !== origin)))
    },
    allow(currentUrl: string, targetUrl: string): boolean {
      const current = new URL(currentUrl)
      const target = new URL(targetUrl)
      if (target.username || target.password)
        return false
      const payment = target.origin === origin ? target.pathname.match(/^\/order\/(linepay|ecpay)\/redirect\/([\w-]{1,200})\/(LinePay|Credit)$/) : undefined
      if (payment) {
        const reference = referenceAt(current)
        if (!reference || payment[2] !== reference || target.search || target.hash
          || (payment[1] === 'linepay' ? payment[3] !== 'LinePay' : payment[3] !== 'Credit')) {
          return false
        }
        orderReference = reference
        providerEntered = false
        method = payment[1]
        return true
      }
      if (target.origin === origin) {
        if (providerEntered) {
          const suffix = journey && target.pathname.startsWith(journey.basePath) ? target.pathname.slice(journey.basePath.length) : ''
          const result = suffix.match(/^orders\/([\w-]{1,200})(?:\/choosePayment)?$/)
          if (!orderReference || (result && result[1] !== orderReference))
            return false
          // Merchant callback endpoints can be intermediate forms/redirects.
          // Keep the manual state until an approved menu/order page returns;
          // those callback documents never receive native automation either.
          if (!isPbJourneyPage(entry, target.href) && !isPbOrderResultUrl(entry, target.href))
            return true
        }
        orderReference = undefined
        providerEntered = false
        method = undefined
        return true
      }
      // The merchant wrapper is admitted above before its HTTP 302 commits.
      // Sources: observed PB redirect and LINE's web payment/login contracts:
      // https://developers-pay.line.me/online/implement-basic-payment
      // https://developers.line.biz/en/docs/line-login/integrate-line-login/
      if (!orderReference || !journey || target.protocol !== 'https:' || target.port)
        return false
      const gateway = method === 'ecpay' ? target.origin === 'https://payment.ecpay.com.tw' : providers.has(target.origin) && target.origin !== 'https://payment.ecpay.com.tw'
      if (!providerEntered && !gateway)
        return false
      // After the selected gateway accepts the handoff, its normal HTTPS
      // authentication chain (including bank 3-D Secure) belongs to the human.
      // No page in that chain receives our native PB adapter or tool authority.
      providerEntered = true
      return true
    },
  }
}
