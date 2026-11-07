import type { DesktopServiceRequest, DesktopSurfaceActivity, DesktopSurfaceRequest, DesktopSurfaceResult } from '@proj-airi/stage-shared/kiosk-desktop'
import type { BrowserWindow } from 'electron'

import { createHash } from 'node:crypto'

import { WebContentsView } from 'electron'

import { clipBounds, parsePageUrl } from './policy'

/** Owns one visible website, isolated storage and request ordering for one Kiosk window. */
export class ServiceSurface {
  private view?: WebContentsView
  private sequence = 0
  private documentKey?: string
  private partition?: string
  private failed = false
  private hostGeneration = 0
  private active?: DesktopSurfaceActivity
  private loading?: Promise<void>
  private serviceReady?: Promise<void>
  private navigation = 0
  private removeDownloadGuard?: () => void

  constructor(private readonly window: BrowserWindow, private readonly onActivity: (activity: DesktopSurfaceActivity) => void, private readonly serviceScript: string) {}

  /** Applies the latest host placement; superseded loads cannot restore an older visibility state. */
  async update(input: DesktopSurfaceRequest): Promise<DesktopSurfaceResult> {
    if (input.sequence <= this.sequence)
      return { sequence: input.sequence, state: 'superseded' }
    this.sequence = input.sequence
    const hostGeneration = this.hostGeneration
    this.active = { serviceId: input.serviceId, documentKey: input.documentKey }
    const url = parsePageUrl(input.url)
    // Each service and origin has its own login store inside this installation's userData.
    // A separate store cannot isolate a cart that the vendor itself keys by account.
    const partition = `persist:service-${createHash('sha256').update(JSON.stringify([input.serviceId, url.origin])).digest('hex')}`
    if (partition !== this.partition) {
      this.disposeView()
      this.partition = partition
      this.documentKey = undefined
      this.view = new WebContentsView({ webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      } })
      this.window.contentView.addChildView(this.view)
      this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      const guardNavigation = (event: { preventDefault: () => void }, destination: string) => {
        // OAuth/popups need an explicit policy later; this stage tests same-origin account login.
        if (new URL(destination).origin !== url.origin)
          event.preventDefault()
      }
      this.view.webContents.on('will-navigate', guardNavigation)
      this.view.webContents.on('will-redirect', guardNavigation)
      this.view.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) {
          this.navigation++
          this.serviceReady = undefined
        }
      })
      const current = this.view
      current.webContents.on('input-event', (_event, input) => {
        // Do not retain keys, field values or mouse coordinates in customer activity records.
        if (this.view === current && current.getVisible() && this.active && ['mouseDown', 'touchStart', 'rawKeyDown', 'mouseWheel'].includes(input.type))
          this.onActivity(this.active)
      })
      this.view.webContents.session.setPermissionRequestHandler((_contents, _permission, reply) => reply(false))
      this.view.webContents.session.setPermissionCheckHandler(() => false)
      const session = this.view.webContents.session
      const preventDownload = (event: { preventDefault: () => void }) => event.preventDefault()
      session.on('will-download', preventDownload)
      this.removeDownloadGuard = () => session.removeListener('will-download', preventDownload)
    }
    const view = this.view!
    const bounds = clipBounds(input.bounds, this.window.getContentBounds())
    view.setBounds(bounds)
    const visible = input.visible && bounds.width > 0 && bounds.height > 0
    view.setVisible(visible && !this.failed)
    const key = JSON.stringify([input.documentKey, url.href])
    if (key !== this.documentKey) {
      this.documentKey = key
      this.failed = false
      this.loading = view.webContents.loadURL(url.href).catch(() => {
        // Replacement navigation owns its own load; an old completion cannot hide a new view.
        if (this.view === view && this.documentKey === key) {
          this.failed = true
          view.setVisible(false)
        }
      })
    }
    await this.loading
    if (hostGeneration !== this.hostGeneration || input.sequence !== this.sequence || this.view !== view)
      return { sequence: input.sequence, state: 'superseded' }
    view.setVisible(visible && !this.failed)
    return { sequence: input.sequence, state: this.failed ? 'failed' : visible ? 'visible' : 'hidden' }
  }

  /** Relays bounded operations only to this host's current approved native document. */
  async invoke(input: DesktopServiceRequest): Promise<unknown> {
    const view = this.view
    if (!view || !this.active || input.serviceId !== this.active.serviceId || input.documentKey !== this.active.documentKey)
      throw new Error('Native service document ownership changed.')
    await this.loading
    const generation = this.navigation
    const approved = () => this.view === view && this.navigation === generation && this.active?.serviceId === input.serviceId && this.active?.documentKey === input.documentKey && ['https://app.esgpb.com/order/store/1kgJeql/pick_up/menu', 'https://app.esgpb.com/order/store/1kgJeql/pick_up/orders/create'].includes(view.webContents.getURL().split('?')[0])
    if (!approved())
      throw new Error('Native automation is restricted to the approved PB menu/cart journey.')
    // All JavaScript is bundled application code. The untrusted renderer can
    // choose only a schema-validated operation, never an expression to evaluate.
    this.serviceReady ??= view.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: this.serviceScript }]).then(() => {})
    await this.serviceReady
    if (!approved())
      throw new Error('Native service navigated during initialization.')
    const { kind, request } = input.command
    const result = await view.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `globalThis.__webnaviorPbService[${JSON.stringify(kind)}](${JSON.stringify(request)})` }])
    if (!approved())
      throw new Error('Native service navigated during execution; do not replay.')
    return result
  }

  /** Hides the service immediately when the trusted host document is being replaced. */
  hide() {
    this.view?.setVisible(false)
  }

  /** A reloaded preload starts sequence at one; old-document completions lose ownership. */
  resetHost() {
    this.hostGeneration++
    this.sequence = 0
    this.active = undefined
    this.hide()
  }

  /** Closes the native document while retaining its login store for this installation. */
  dispose() {
    this.disposeView()
  }

  private disposeView() {
    if (!this.view)
      return
    this.window.contentView.removeChildView(this.view)
    this.view.webContents.close()
    this.removeDownloadGuard?.()
    this.removeDownloadGuard = undefined
    this.navigation++
    this.serviceReady = undefined
    this.view = undefined
    this.loading = undefined
  }
}
