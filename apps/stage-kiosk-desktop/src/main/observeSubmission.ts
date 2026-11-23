/**
 * Runs in the merchant world for one native submit operation. The isolated PB
 * reader arms it immediately before clicking. Only the refusal text crosses
 * worlds. XHR callbacks, credentials and the full merchant response stay here.
 * Keep this function self-contained for Electron's serialized invocation.
 */
export function observeSubmission(operationId: string) {
  const event = `pb-submit-${operationId}`
  const path = location.pathname
  if (!path.endsWith('/orders/create'))
    return
  const controller = new AbortController()
  const options = { signal: controller.signal }
  const original = XMLHttpRequest.prototype.open
  const observed = new Proxy(original, {
    apply(target, xhr: XMLHttpRequest, args: Parameters<typeof original>) {
      const result = Reflect.apply(target, xhr, args)
      const url = new URL(args[1], location.href)
      if (args[0].toUpperCase() !== 'POST' || url.origin !== location.origin || ![path, path.replace(/\/create$/, '')].includes(url.pathname))
        return result
      if (XMLHttpRequest.prototype.open === observed)
        XMLHttpRequest.prototype.open = original
      xhr.addEventListener('load', () => {
        if (xhr.status !== 200 || !xhr.responseURL || new URL(xhr.responseURL).pathname !== path || new URL(xhr.responseURL).origin !== location.origin || location.pathname !== path)
          return
        try {
          const page = xhr.responseType === 'json' ? xhr.response : JSON.parse(xhr.responseText)
          if (page?.component !== 'Order/Create' || new URL(page.url, location.origin).href !== xhr.responseURL)
            return
          const message = page.props?.errors?.order || page.props?.errors?.diningTime
          if (typeof message === 'string' && message.trim())
            document.dispatchEvent(new CustomEvent(event, { detail: message }))
        }
        catch { /* Other response formats remain subject to ordinary checkout verification. */ }
      }, options)
      return result
    },
  })
  document.addEventListener(`${event}-start`, () => {
    XMLHttpRequest.prototype.open = observed
  }, { ...options, once: true })
  document.addEventListener(`${event}-end`, () => {
    if (XMLHttpRequest.prototype.open === observed)
      XMLHttpRequest.prototype.open = original
    controller.abort()
  }, { ...options, once: true })
}
