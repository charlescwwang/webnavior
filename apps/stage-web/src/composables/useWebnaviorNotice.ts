import { shallowRef } from 'vue'

export interface WebnaviorNotice {
  id: number
  message: string
  tone: 'error' | 'success'
}

const notices = shallowRef<WebnaviorNotice[]>([])
let nextId = 0

/** Central, short-lived feedback for Webnavior API operations. */
export function useWebnaviorNotice() {
  function show(message: string, tone: WebnaviorNotice['tone']) {
    // Avoid filling the viewport when a failed request retries repeatedly.
    if (tone === 'error' && notices.value.some(notice => notice.tone === tone && notice.message === message))
      return
    const id = nextId++
    notices.value = [...notices.value, { id, message, tone }]
    window.setTimeout(dismiss, 5_000, id)
  }

  function dismiss(id: number) {
    notices.value = notices.value.filter(notice => notice.id !== id)
  }

  return {
    dismiss,
    error: (message: string) => show(message, 'error'),
    notices,
    success: (message: string) => show(message, 'success'),
  }
}
