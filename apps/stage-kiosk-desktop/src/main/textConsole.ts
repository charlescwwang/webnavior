import type { BrowserWindow, WebContents } from 'electron'

import { isTextConsoleRequest } from './policy'

/** Owns the single trusted text popup; it never becomes another ordering host. */
export class TextConsoleWindow {
  private child?: BrowserWindow

  constructor(host: BrowserWindow, entry: URL) {
    host.webContents.setWindowOpenHandler((request) => {
      if (this.child || !isTextConsoleRequest(host.webContents.getURL(), entry, request)) {
        return { action: 'deny' }
      }
      const bounds = host.getContentBounds()
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: host,
          frame: false,
          width: 440,
          height: Math.min(520, bounds.height - 24),
          minWidth: 320,
          minHeight: 52,
          x: bounds.x + Math.max(12, bounds.width - 452),
          y: bounds.y + Math.max(12, bounds.height - 532),
          backgroundColor: '#082c30',
          skipTaskbar: true,
          fullscreenable: false,
          minimizable: false,
          maximizable: false,
          autoHideMenuBar: true,
        },
      }
    })
    host.webContents.on('did-create-window', (child) => {
      this.child = child
      // about:blank shares the trusted opener's origin so Vue can move its
      // existing subtree here. Navigation must never hand that relationship away.
      child.webContents.on('will-navigate', event => event.preventDefault())
      child.webContents.on('will-redirect', event => event.preventDefault())
      child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      child.on('closed', () => {
        if (this.child === child)
          this.child = undefined
      })
    })
    // A retired host's popup must not retain its old Vue handlers or draft input.
    host.webContents.on('did-start-navigation', (event) => {
      if (event.isMainFrame && !event.isSameDocument)
        this.dispose()
    })
  }

  /** Grants text-only clipboard permission to this exact live child, never an arbitrary blank page. */
  owns(contents: WebContents | null): boolean {
    return Boolean(contents && this.child && !this.child.isDestroyed() && this.child.webContents === contents)
  }

  /** Closes the owned popup on host replacement or shutdown, without touching vendor storage. */
  dispose() {
    this.child?.destroy()
    this.child = undefined
  }
}
