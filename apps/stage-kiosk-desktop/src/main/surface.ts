import type { DesktopServiceRequest, DesktopSurfaceActivity, DesktopSurfaceNavigation, DesktopSurfaceRequest, DesktopSurfaceResult } from '@proj-airi/stage-shared/kiosk-desktop'
import type { BrowserWindow, Event, WebContentsWillNavigateEventParams, WebContentsWillRedirectEventParams } from 'electron'

import type { Diagnostics } from './diagnostics'

import { createHash } from 'node:crypto'

import { executionResultSchema } from '@proj-airi/stage-shared/interactive-service'
import { pbGatewayReceiptSchema, pbSubmissionResultSchema } from '@proj-airi/stage-shared/pb-checkout'
import { isPbJourneyPage, isPbOrderResultUrl, isPbTableEntryUrl, menuEntryReceiptSchema, readPbJourney, tableSelectionReceiptSchema } from '@proj-airi/stage-shared/pb-journey'
import { WebContentsView } from 'electron'
import { safeParse } from 'valibot'

import { selectGatewayChoice } from './gatewayChoice'
import { observeSubmission } from './observeSubmission'
import { createPaymentNavigation } from './paymentNavigation'
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
  // Display readiness and automation readiness are separate: a parsed document
  // can paint while images still prevent did-finish-load. Navigation revokes
  // tools until the full load completes, without hiding that renderable page.
  private documentLoading = false
  private serviceReady?: Promise<void>
  private paymentNavigation?: ReturnType<typeof createPaymentNavigation>
  private navigation = 0
  private navigationTarget?: string
  private serviceEntry?: string
  private desiredVisible = false
  private removeDownloadGuard?: () => void
  private maintenanceRenders = new Map<WebContentsView, { users: number, throttled: boolean }>()

  constructor(private readonly window: BrowserWindow, private readonly onActivity: (activity: DesktopSurfaceActivity) => void, private readonly serviceScript: string, private readonly onNavigation: (navigation: DesktopSurfaceNavigation) => void, private readonly diagnostics: Diagnostics) {}

  /** Applies the latest host placement; superseded loads cannot restore an older visibility state. */
  async update(input: DesktopSurfaceRequest): Promise<DesktopSurfaceResult> {
    if (input.sequence <= this.sequence)
      return { sequence: input.sequence, state: 'superseded' }
    this.sequence = input.sequence
    const hostGeneration = this.hostGeneration
    this.active = { serviceId: input.serviceId, documentKey: input.documentKey }
    const url = parsePageUrl(input.url)
    this.serviceEntry = url.href
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
      const paymentNavigation = createPaymentNavigation(url.href)
      this.paymentNavigation = paymentNavigation
      const paymentView = this.view
      this.view.webContents.setWindowOpenHandler((details) => {
        const view = this.view
        const manualHandoff = view === paymentView && paymentNavigation.isManualPage(view.webContents.getURL())
        // Native payment links may request a new tab. Keep that explicit user
        // handoff in the owned view; arbitrary popups remain denied.
        if (view === paymentView && paymentNavigation.allow(view.webContents.getURL(), details.url)
          && (manualHandoff || /\/order\/(?:linepay|ecpay)\/redirect\//.test(details.url) || new URL(details.url).origin !== url.origin)) {
          const postBody = details.postBody
          // Some gateways POST into a named window. Preserve that native form
          // handoff instead of silently turning it into a GET; never log it.
          void view.webContents.loadURL(details.url, postBody
            ? {
                postData: postBody.data,
                extraHeaders: `Content-Type: ${postBody.contentType}${postBody.boundary ? `; boundary=${postBody.boundary}` : ''}\r\n`,
              }
            : undefined).catch(() => {})
        }
        return { action: 'deny' }
      })
      const guardNavigation = (event: Event<WebContentsWillNavigateEventParams | WebContentsWillRedirectEventParams>) => {
        if (this.view !== paymentView || !paymentNavigation.allow(paymentView.webContents.getURL(), event.url))
          event.preventDefault()
      }
      this.view.webContents.on('will-navigate', guardNavigation)
      this.view.webContents.on('will-redirect', guardNavigation)
      const current = this.view
      this.diagnostics.observe(current.webContents, 'pb')
      // NOTICE: Use event details, not deprecated positional arguments. Both
      // the installed type contract and the pilot runtime support these fields;
      // electron.d.ts:16445 and https://www.electronjs.org/docs/latest/api/web-contents#event-did-start-navigation
      // define isMainFrame/isSameDocument on the event itself.
      current.webContents.on('did-start-navigation', (event) => {
        if (this.view === current && event.isMainFrame && !event.isSameDocument) {
          this.navigation++
          this.navigationTarget = event.url
          this.serviceReady = undefined
          this.documentLoading = true
          this.failed = false
          current.setVisible(this.desiredVisible)
          if (this.view === current && this.active)
            this.onNavigation({ ...this.active, revision: this.navigation, state: 'loading' })
        }
      })
      current.webContents.on('dom-ready', () => {
        if (this.view !== current || !this.active || this.failed)
          return
        current.setVisible(this.desiredVisible)
      })
      current.webContents.on('did-finish-load', () => {
        if (this.view !== current || !this.active || this.failed)
          return
        this.documentLoading = false
        this.failed = false
        current.setVisible(this.desiredVisible)
        this.onNavigation({ ...this.active, revision: this.navigation, paymentProvider: paymentNavigation.providerAt(current.webContents.getURL()), gatewayOrder: paymentNavigation.gatewayOrder(current.webContents.getURL()), state: paymentNavigation.isManualPage(current.webContents.getURL()) ? 'manual-payment' : 'ready' })
      })
      current.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
        // Chromium aborts the previous load during a redirect. The following
        // document owns the final readiness; it is not a failed merchant page.
        if (code === -3 || !mainFrame || this.view !== current || !this.active)
          return
        this.documentLoading = false
        this.failed = true
        current.setVisible(false)
        this.onNavigation({ ...this.active, revision: this.navigation, state: 'failed' })
      })
      current.webContents.on('render-process-gone', () => {
        if (this.view !== current || !this.active)
          return
        // A crashed renderer can retain its URL without another load event.
        // Revoke admission and release the Host's loading wait; never replay
        // pending merchant work or let an old view fail its replacement.
        this.documentLoading = false
        this.serviceReady = undefined
        this.failed = true
        current.setVisible(false)
        this.onNavigation({ ...this.active, revision: this.navigation, state: 'failed' })
      })
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
    this.desiredVisible = visible
    const key = JSON.stringify([input.documentKey, url.href])
    if (key !== this.documentKey) {
      this.documentKey = key
      this.failed = false
      this.documentLoading = true
      const loading = view.webContents.loadURL(url.href).catch(() => {
        // Navigation events own readiness and failure. A superseded loadURL
        // can reject with ERR_ABORTED after a new placement or PB Start has
        // already navigated successfully; its promise must not hide that page.
        // Actual main-frame failures still revoke the view in did-fail-load.
      })
      this.loading = loading
    }
    // Navigation readiness governs automation only. Keep Chromium's current
    // website visible; Host refresh/reset must never replace it with a cover.
    view.setVisible(visible && !this.failed)
    await this.loading
    if (hostGeneration !== this.hostGeneration || input.sequence !== this.sequence || this.view !== view)
      return { sequence: input.sequence, state: 'superseded' }
    // A website-initiated table navigation does not replace loadURL's already
    // settled promise. Placement may show a renderable document, but must not
    // announce tool readiness; its navigation event still owns that boundary.
    view.setVisible(visible && !this.failed)
    if (this.documentLoading)
      return { sequence: input.sequence, state: 'loading' }
    return { sequence: input.sequence, state: this.failed ? 'failed' : visible ? 'visible' : 'hidden' }
  }

  /** Relays bounded operations only to this host's current approved native document. */
  async invoke(input: DesktopServiceRequest): Promise<unknown> {
    const command = input.command
    const maintenance = command.kind === 'execute'
      && (command.request.name === 'browser_customer_reset' || (command.request.name === 'browser_start_ordering' && command.request.input.forReset === true))
    if (!maintenance)
      return this.invokeCurrent(input)
    const view = this.view
    if (!view || !this.active || input.serviceId !== this.active.serviceId || input.documentKey !== this.active.documentKey)
      throw new Error('Native service document ownership changed.')
    // PB's SSR leave mask needs rendering frames to release Start. Hiding the
    // view pauses those frames, so private reception maintenance temporarily
    // keeps rendering alive without showing or forcibly clicking through it.
    // Restore the prior setting after the last overlapping maintenance call,
    // including rejection/navigation. Normal customer calls never acquire it.
    // https://www.electronjs.org/docs/latest/api/web-contents#contentssetbackgroundthrottlingallowed
    let rendering = this.maintenanceRenders.get(view)
    if (!rendering) {
      rendering = { users: 0, throttled: view.webContents.getBackgroundThrottling() }
      this.maintenanceRenders.set(view, rendering)
      view.webContents.setBackgroundThrottling(false)
    }
    rendering.users++
    try {
      return await this.invokeCurrent(input)
    }
    finally {
      if (--rendering.users === 0) {
        this.maintenanceRenders.delete(view)
        if (!view.webContents.isDestroyed())
          view.webContents.setBackgroundThrottling(rendering.throttled)
      }
    }
  }

  private async invokeCurrent(input: DesktopServiceRequest): Promise<unknown> {
    const view = this.view
    if (!view || !this.active || input.serviceId !== this.active.serviceId || input.documentKey !== this.active.documentKey)
      throw new Error('Native service document ownership changed.')
    await this.loading
    const generation = this.navigation
    const hostGeneration = this.hostGeneration
    const entry = this.serviceEntry!
    const beforeUrl = new URL(view.webContents.getURL())
    const command = input.command
    if (command.kind === 'choose-gateway' || command.kind === 'return-payment') {
      const current = () => this.view === view && this.navigation === command.revision && this.hostGeneration === hostGeneration
        && this.active?.documentKey === input.documentKey && this.active.serviceId === input.serviceId
        && !this.documentLoading && !this.failed && view.getVisible()
        && this.paymentNavigation?.gatewayOrder(view.webContents.getURL()) === command.reference
      if (!current())
        return 'unavailable'
      if (command.kind === 'return-payment') {
        const target = this.paymentNavigation?.returnUrl(beforeUrl.href, command.reference)
        if (!target)
          return 'unavailable'
        await view.webContents.loadURL(target)
        return this.view === view && this.hostGeneration === hostGeneration && view.webContents.getURL() === target ? 'returned' : 'unavailable'
      }
      if (this.paymentNavigation?.providerAt(beforeUrl.href) !== 'ecpay')
        return 'unavailable'
      // Only the three enum values enter this isolated function. Never install
      // the PB adapter or expose selectors, card data or gateway frames to the host.
      const result = await view.webContents.executeJavaScriptInIsolatedWorld(1002, [{ code: `(${selectGatewayChoice.toString()})(${JSON.stringify(command.choice)})` }], true)
      return current() ? result : 'unavailable'
    }
    const before = readPbJourney(beforeUrl.href)
    const approved = () => this.view === view && !this.failed && !this.documentLoading && this.navigation === generation && this.active?.serviceId === input.serviceId && this.active?.documentKey === input.documentKey && (isPbJourneyPage(entry, view.webContents.getURL()) || (isPbOrderResultUrl(entry, view.webContents.getURL()) && (command.kind !== 'execute' || ['browser_state_get', 'browser_reception_reset'].includes(command.request.name) || (command.request.name === 'browser_payment_open' && beforeUrl.pathname.endsWith('/choosePayment')))))
    if (!approved())
      throw new Error('Native automation is restricted to the approved PB menu/cart journey.')
    // All JavaScript is bundled application code. The untrusted renderer can
    // choose only a schema-validated operation, never an expression to evaluate.
    this.serviceReady ??= view.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: this.serviceScript }]).then(() => {})
    await this.serviceReady
    if (!approved())
      throw new Error('Native service navigated during initialization.')
    const { kind, request } = command
    const finish = kind === 'execute' ? this.diagnostics.operation(request.name, request.operationId) : undefined
    const submissionEvent = kind === 'execute' && request.name === 'browser_order_submit' && beforeUrl.pathname === before?.cartPath ? `pb-submit-${request.operationId}` : undefined
    let result: unknown
    try {
      if (submissionEvent && kind === 'execute') {
        await view.webContents.executeJavaScript(`(${observeSubmission.toString()})(${JSON.stringify(request.operationId)})`)
        if (!approved())
          throw new Error('Checkout document changed before submission.')
      }
      result = await view.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `globalThis.__webnaviorPbService[${JSON.stringify(kind)}](${JSON.stringify(request)})` }])
    }
    finally {
      finish?.()
      if (submissionEvent && this.navigation === generation && this.view === view && view.webContents.getURL() === beforeUrl.href)
        await view.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `document.dispatchEvent(new Event(${JSON.stringify(`${submissionEvent}-end`)}))` }]).catch(() => {})
    }
    if (!approved()) {
      // Start intentionally replaces its table document. Acknowledge dispatch
      // once navigation to this exact menu has started; page readiness belongs
      // to the loading/ready events, not this receipt. Slow assets must not turn
      // an accepted click into a rejection. This proves no cart/order effect.
      // Every other stale-document result, especially a cart write, still fails.
      const receipt = safeParse(executionResultSchema, result)
      if (kind === 'execute' && request.name === 'browser_payment_open' && receipt.success) {
        const gateway = safeParse(pbGatewayReceiptSchema, receipt.output.result)
        if (gateway.success && gateway.output.reference === request.input.reference && gateway.output.method === request.input.method
          && receipt.output.connectionId === request.connectionId && receipt.output.documentId === request.documentId && receipt.output.operationId === request.operationId
          && this.view === view && !this.failed && this.hostGeneration === hostGeneration
          && this.active?.serviceId === input.serviceId && this.active?.documentKey === input.documentKey) {
          const provider = gateway.output.method === 'Credit' ? 'ecpay' : 'linepay'
          if (this.navigationTarget === `${beforeUrl.origin}/order/${provider}/redirect/${gateway.output.reference}/${gateway.output.method}`)
            return result
        }
      }
      const submission = receipt.success && safeParse(pbSubmissionResultSchema, receipt.output.result)
      // Inertia/history navigation can replace the cart URL without starting a
      // new document. The last full-navigation target is stale in that case;
      // use the committed current URL, retaining every receipt/owner check.
      const submissionTarget = this.navigation === generation ? view.webContents.getURL() : this.navigationTarget
      if (kind === 'execute' && request.name === 'browser_order_submit' && receipt.success
        && receipt.output.connectionId === request.connectionId && receipt.output.documentId === request.documentId && receipt.output.operationId === request.operationId
        && submission && submission.success
        && beforeUrl.pathname === before?.cartPath && submissionTarget && isPbOrderResultUrl(entry, submissionTarget)
        && this.view === view && this.hostGeneration === hostGeneration && this.active?.serviceId === input.serviceId && this.active?.documentKey === input.documentKey) {
        // This acknowledges one native click, not merchant acceptance/payment.
        // The result page permits only the separate Host state reader, never editor tools.
        return result
      }
      const returned = receipt.success && safeParse(tableSelectionReceiptSchema, receipt.output.result)
      if (kind === 'execute' && request.name === 'browser_return_table' && before?.tablePath
        && receipt.success && receipt.output.connectionId === request.connectionId && receipt.output.documentId === request.documentId && receipt.output.operationId === request.operationId
        && returned && returned.success
        && this.navigationTarget && new URL(this.navigationTarget).origin === before.origin && new URL(this.navigationTarget).pathname === before.tablePath
        && !new URL(this.navigationTarget).search && !new URL(this.navigationTarget).hash
        && this.view === view && !this.failed && this.hostGeneration === hostGeneration && this.navigation > generation
        && this.active?.serviceId === input.serviceId && this.active?.documentKey === input.documentKey) {
        // Only this request's same-store table navigation can cross retirement;
        // it cannot settle a cart write or restore the previous document tools.
        return result
      }
      const started = receipt.success && safeParse(menuEntryReceiptSchema, receipt.output.result)
      if (kind === 'execute' && request.name === 'browser_start_ordering'
        && receipt.success && receipt.output.connectionId === request.connectionId && receipt.output.documentId === request.documentId && receipt.output.operationId === request.operationId
        && started && started.success && started.output.selectedTable === request.input.name
        && before?.tablePath === beforeUrl.pathname) {
        // did-start-navigation precedes getURL's commit. Its target, rather
        // than the still-visible old URL, identifies the accepted destination.
        const target = this.navigationTarget ? readPbJourney(this.navigationTarget) : undefined
        const menuTarget = target && new URL(entry).origin === target.origin && before.basePath === target.basePath && new URL(this.navigationTarget!).pathname === before.menuPath
        const tableEntryTarget = this.navigationTarget && isPbTableEntryUrl(entry, this.navigationTarget)
        if ((menuTarget || tableEntryTarget)
          && this.view === view && !this.failed && this.hostGeneration === hostGeneration && this.navigation > generation
          && this.active?.serviceId === input.serviceId && this.active?.documentKey === input.documentKey) {
          return result
        }
        throw new Error(`Native menu entry has not reached an approved target (targetApproved=${Boolean(target)}, ownerCurrent=${this.view === view && this.hostGeneration === hostGeneration}, navigationStarted=${this.navigation > generation}, loadFailed=${this.failed}).`)
      }
      throw new Error('Native service navigated during execution; do not replay.')
    }
    if (kind === 'execute' && ['browser_invoice_select', 'browser_checkout_prepare'].includes(request.name)
      && view.getVisible() && this.window.isFocused()) {
      const receipt = safeParse(executionResultSchema, result)
      const payload = receipt.success ? receipt.output.result : undefined
      if (payload && typeof payload === 'object' && 'ok' in payload && payload.ok === true) {
        // DOM focus inside an isolated WebContentsView does not transfer the
        // native keyboard from the Host. Only an explicit checkout entry action
        // may hand it to an editable merchant field; passive reads never do.
        const editing = await view.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `(() => {
          const field = document.activeElement;
          return location.pathname.endsWith('/orders/create') && field instanceof HTMLInputElement
            && field.matches('.order-create input:not([type="radio"]):not([type="hidden"])')
            && !field.disabled && !field.readOnly && field.getClientRects().length > 0;
        })()` }])
        if (editing && approved() && view.getVisible() && this.window.isFocused())
          view.webContents.focus()
      }
    }
    return result
  }

  /** Hides the service immediately when the trusted host document is being replaced. */
  hide() {
    this.desiredVisible = false
    this.view?.setVisible(false)
  }

  /** A reloaded preload starts sequence at one; old-document completions lose ownership. */
  resetHost() {
    this.hostGeneration++
    this.sequence = 0
    this.active = undefined
    // The reloaded Host can reuse the same service/revision key. Its next
    // placement must load the configured entry, not adopt the previous view's
    // SPA menu/checkout URL merely because that old key still compares equal.
    this.documentKey = undefined
    this.hide()
  }

  /** Closes the native document while retaining its login store for this installation. */
  dispose() {
    this.disposeView()
  }

  private disposeView() {
    this.navigationTarget = undefined
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
    this.documentLoading = false
  }
}
