import type { MaybeRefOrGetter } from 'vue'

import { useMutationObserver } from '@vueuse/core'
import { onBeforeUnmount, onMounted, shallowRef, toValue } from 'vue'

/** Moves the existing Vue console into an owned native popup, retaining its handlers and draft. */
export function useTextConsoleWindow(enabled: MaybeRefOrGetter<boolean>, title: MaybeRefOrGetter<string>) {
  const target = shallowRef<HTMLElement>()
  const failed = shallowRef(false)
  let popup: Window | undefined
  let copiedStyles: Element[] = []
  let expandedHeight = 520
  let disposed = false

  function copyStyles() {
    if (!popup || popup.closed)
      return
    // Scoped component CSS and UnoCSS still belong to the main Vue app. Mirror
    // later lazy styles too, without starting another app/router/device session.
    copiedStyles.forEach(style => style.remove())
    copiedStyles = Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'), style => style.cloneNode(true) as Element)
    popup.document.head.append(...copiedStyles)
  }
  useMutationObserver(document.head, copyStyles, { childList: true, subtree: true, characterData: true })

  function resetPosition() {
    popup?.moveTo(window.screenX + Math.max(12, window.innerWidth - popup.outerWidth - 12), window.screenY + Math.max(12, window.innerHeight - popup.outerHeight - 12))
  }

  function open() {
    if (!toValue(enabled) || disposed || popup)
      return
    const child = window.open('about:blank', 'airi-kiosk-text-console', 'popup,width=440,height=520')
    if (!child) {
      failed.value = true
      return
    }
    popup = child
    failed.value = false
    child.document.title = toValue(title)
    child.document.documentElement.lang = document.documentElement.lang
    child.document.documentElement.className = document.documentElement.className
    const base = child.document.createElement('base')
    base.href = document.baseURI
    child.document.head.append(base)
    child.document.body.style.cssText = 'margin:0;overflow:hidden;background:#082c30;'
    copyStyles()
    // Manual close returns the same subtree to its reserved host region. On
    // unmount the owner closes it instead, so no orphaned console survives.
    child.addEventListener('beforeunload', () => {
      if (popup === child) {
        popup = undefined
        target.value = undefined
      }
    }, { once: true })
    target.value = child.document.body
    expandedHeight = Math.min(520, window.innerHeight - 24)
    child.resizeTo(440, expandedHeight)
    resetPosition()
  }

  function setCollapsed(collapsed: boolean, headerHeight: number) {
    if (!popup)
      return
    if (collapsed)
      expandedHeight = popup.innerHeight
    popup.resizeTo(popup.outerWidth, collapsed ? Math.ceil(headerHeight) + 2 : expandedHeight)
  }

  onMounted(open)
  onBeforeUnmount(() => {
    disposed = true
    popup?.close()
    popup = undefined
    target.value = undefined
  })
  return { target, failed, open, resetPosition, setCollapsed }
}
