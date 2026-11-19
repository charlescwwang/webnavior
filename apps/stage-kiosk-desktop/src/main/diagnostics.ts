import type { ProcessMetric, Session, WebContents } from 'electron'

import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { freemem, totalmem } from 'node:os'
import { join } from 'node:path'

import { literal, maxValue, minValue, number, object, picklist, pipe, safeParse } from 'valibot'

type Role = 'host' | 'pb'
interface DocumentOwner {
  contents: WebContents
  role: Role
  navigationId: number
  startedAt: number
  probeAt?: number
  remove: () => void
}
interface Request {
  owner: DocumentOwner
  navigationId: number
  startedAt: number
  target: ReturnType<typeof resourceTarget>
  type: string
  attribution: 'contents' | 'session'
  firstByteMs?: number
  status?: number
  fromCache?: boolean
}

const duration = pipe(number(), minValue(0), maxValue(3_600_000))
const modelEvent = object({ kind: literal('model'), model: picklist(['runtime', 'face', 'pose', 'vad', 'avatar']), phase: picklist(['start', 'ready', 'failed', 'slow-inference']), durationMs: duration })
const rendererSample = object({ readyState: picklist(['loading', 'interactive', 'complete']), timeOrigin: number(), longestTaskMs: duration, longTaskCount: number(), domContentLoadedMs: duration, loadMs: duration })

/** Classifies only public resource kinds; never persist paths, queries or fragments. */
function resourceTarget(raw: string) {
  try {
    const url = new URL(raw)
    let resource = 'resource'
    if (url.pathname.endsWith('/menu/select-table'))
      resource = 'table'
    else if (url.pathname.endsWith('/orders/create'))
      resource = 'checkout'
    else if (url.pathname.endsWith('/menu'))
      resource = 'menu'
    else if (url.pathname.startsWith('/kiosk/'))
      resource = 'kiosk'
    const model = /(?:^|\/)(face_landmarker|pose_landmarker_lite)\.task$/.exec(url.pathname)
    const extension = /\.(js|css|wasm|onnx|onnx_data|task|vrm|glb|bin|moc3|png|jpg|webp|woff2?)$/.exec(url.pathname)
    if (model)
      resource = model[1]!
    else if (extension)
      resource = extension[1]!
    return { host: url.hostname, resource }
  }
  catch { return { host: 'invalid', resource: 'resource' } }
}

// Fixed application code in its own isolated world. Buffered long tasks include
// startup work before the first sample. No DOM text, field or stack is inspected.
const rendererProbe = `(() => {
  const state = globalThis.__webnaviorPerformance ??= { longestTaskMs: 0, longTaskCount: 0 };
  if (!state.observer) {
    state.observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        state.longestTaskMs = Math.max(state.longestTaskMs, entry.duration);
        state.longTaskCount++;
      }
    });
    state.observer.observe({ type: 'longtask', buffered: true });
  }
  const navigation = performance.getEntriesByType('navigation')[0];
  const sample = {
    readyState: document.readyState, timeOrigin: performance.timeOrigin,
    longestTaskMs: state.longestTaskMs, longTaskCount: state.longTaskCount,
    domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? 0,
    loadMs: navigation?.loadEventEnd ?? 0
  };
  state.longestTaskMs = 0; state.longTaskCount = 0;
  return sample;
})()`

/**
 * Installation-local flight recorder, independent of Host/visitor reset and the
 * server connection. One process owns three rotating 4 MiB files. Requests are
 * correlated by session-local id plus WebContents/navigation; never by a user.
 * Logging is bounded, asynchronous and never awaited by merchant operations.
 */
export class Diagnostics {
  private readonly runId = randomUUID()
  private readonly beganAt = performance.now()
  private readonly documents = new Map<number, DocumentOwner>()
  private readonly sessions = new Map<Session, () => void>()
  private readonly requests = new Map<string, Request>()
  private readonly queue: string[] = []
  private readonly flushTimer: ReturnType<typeof setInterval>
  private readonly sampleTimer: ReturnType<typeof setInterval>
  private work: Promise<void> = Promise.resolve()
  private flushing = false
  private bytes?: number
  private dropped = 0
  private stopped = false
  private writeFailed = false
  private lastSampleAt = performance.now()

  constructor(private readonly directory: string, private readonly metrics: () => ProcessMetric[]) {
    this.write('recorder-start', { schemaVersion: 1 })
    this.flushTimer = setInterval(() => void this.flush(), 1000)
    this.sampleTimer = setInterval(() => this.sample(), 5000)
    this.flushTimer.unref()
    this.sampleTimer.unref()
  }

  private write(event: string, fields: object = {}) {
    if (this.stopped)
      return
    if (this.queue.length >= 512) {
      this.dropped++
      return
    }
    this.queue.push(`${JSON.stringify({ at: new Date().toISOString(), runId: this.runId, elapsedMs: Math.round(performance.now() - this.beganAt), event, ...fields })}\n`)
  }

  /** Observes one owned page; request listeners are shared only within its Session. */
  observe(contents: WebContents, role: Role) {
    if (this.stopped || this.documents.has(contents.id))
      return
    const owner: DocumentOwner = { contents, role, navigationId: 0, startedAt: performance.now(), remove: () => {} }
    this.documents.set(contents.id, owner)
    const removers: Array<() => void> = []
    const phase = (event: string, fields: object = {}) => this.write(event, { role, contentsId: contents.id, pid: contents.isDestroyed() ? undefined : contents.getOSProcessId(), navigationId: owner.navigationId, durationMs: Math.round(performance.now() - owner.startedAt), ...fields })
    // Named handlers preserve exact Electron overload types and teardown ownership.
    const onStart = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (!event.isMainFrame)
        return
      if (!event.isSameDocument) {
        owner.navigationId++
        owner.startedAt = performance.now()
      }
      phase(event.isSameDocument ? 'same-document-navigation' : 'navigation-start', resourceTarget(event.url))
    }
    const onDom = () => phase('dom-ready')
    const onFinish = () => phase('load-finished')
    const onFail = (_event: Electron.Event, code: number, _description: string, url: string, mainFrame: boolean) => phase('load-failed', { code, mainFrame, ...resourceTarget(url) })
    const onGone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => phase('renderer-gone', { reason: details.reason, exitCode: details.exitCode })
    const onUnresponsive = () => phase('renderer-unresponsive')
    const onResponsive = () => phase('renderer-responsive')
    const onConsole = (event: Electron.Event<Electron.WebContentsConsoleMessageEventParams>) => {
      // Capture only our numeric performance envelope. Arbitrary console output
      // can contain customer fields, URLs and server responses and is discarded.
      const prefix = '[webnavior-performance] '
      if (role !== 'host' || !event.message.startsWith(prefix) || event.message.length > 512)
        return
      try {
        const result = safeParse(modelEvent, JSON.parse(event.message.slice(prefix.length)))
        if (result.success)
          phase('model', result.output)
      }
      catch { /* Non-JSON console messages are not diagnostic envelopes. */ }
    }
    contents.on('did-start-navigation', onStart)
    contents.on('dom-ready', onDom)
    contents.on('did-finish-load', onFinish)
    contents.on('did-fail-load', onFail)
    contents.on('render-process-gone', onGone)
    contents.on('unresponsive', onUnresponsive)
    contents.on('responsive', onResponsive)
    contents.on('console-message', onConsole)
    removers.push(() => {
      contents.removeListener('did-start-navigation', onStart)
      contents.removeListener('dom-ready', onDom)
      contents.removeListener('did-finish-load', onFinish)
      contents.removeListener('did-fail-load', onFail)
      contents.removeListener('render-process-gone', onGone)
      contents.removeListener('unresponsive', onUnresponsive)
      contents.removeListener('responsive', onResponsive)
      contents.removeListener('console-message', onConsole)
    })
    owner.remove = () => {
      for (const remove of removers)
        remove()
      this.documents.delete(contents.id)
      for (const [key, request] of this.requests) {
        if (request.owner === owner) {
          this.write('request-interrupted', this.requestFields(key, request))
          this.requests.delete(key)
        }
      }
    }
    contents.once('destroyed', owner.remove)
    removers.push(() => contents.removeListener('destroyed', owner.remove))
    this.observeSession(contents.session)
  }

  private observeSession(session: Session) {
    if (this.sessions.has(session))
      return
    // Electron permits one listener per webRequest phase. These private Host/PB
    // sessions have no other webRequest owner; detach only our own registrations.
    // https://www.electronjs.org/docs/latest/api/web-request
    const prefix = `${this.sessions.size}:`
    session.webRequest.onBeforeRequest((details, callback) => {
      callback({})
      let owner = details.webContentsId === undefined ? undefined : this.documents.get(details.webContentsId)
      const attribution = owner ? 'contents' : 'session'
      if (!owner && details.webContentsId === undefined) {
        // Worker model fetches may omit WebContents identity. A private session
        // with exactly one observed page is attributable only at session level;
        // never pretend this is an exact frame/document correlation.
        const candidates = [...this.documents.values()].filter(item => item.contents.session === session)
        if (candidates.length === 1)
          owner = candidates[0]
      }
      if (!owner)
        return
      if (this.requests.size >= 256) {
        this.dropped++
        return
      }
      const key = prefix + details.id
      // Redirects keep the request id. Retain their first start time so a slow
      // redirect chain cannot be misreported as a fast final response.
      const prior = this.requests.get(key)
      const request: Request = { owner, attribution, navigationId: owner.navigationId, startedAt: prior?.startedAt ?? performance.now(), target: resourceTarget(details.url), type: details.resourceType }
      this.requests.set(key, request)
      if (['mainFrame', 'xhr'].includes(details.resourceType) || ['task', 'onnx', 'wasm', 'vrm', 'face_landmarker', 'pose_landmarker_lite'].includes(request.target.resource))
        this.write('request-start', this.requestFields(key, request))
    })
    session.webRequest.onResponseStarted((details) => {
      const request = this.requests.get(prefix + details.id)
      if (request) {
        request.firstByteMs = Math.round(performance.now() - request.startedAt)
        request.status = details.statusCode
        request.fromCache = details.fromCache
      }
    })
    session.webRequest.onCompleted(details => this.finishRequest(prefix + details.id))
    session.webRequest.onErrorOccurred(details => this.finishRequest(prefix + details.id, /^net::ERR_[A-Z0-9_]+$/.test(details.error) ? details.error : 'network-error'))
    this.sessions.set(session, () => {
      session.webRequest.onBeforeRequest(null)
      session.webRequest.onResponseStarted(null)
      session.webRequest.onCompleted(null)
      session.webRequest.onErrorOccurred(null)
    })
  }

  private requestFields(requestId: string, request: Request) {
    return { requestId, role: request.owner.role, attribution: request.attribution, contentsId: request.attribution === 'contents' ? request.owner.contents.id : undefined, navigationId: request.attribution === 'contents' ? request.navigationId : undefined, ...request.target, type: request.type, durationMs: Math.round(performance.now() - request.startedAt), firstByteMs: request.firstByteMs, status: request.status, fromCache: request.fromCache }
  }

  private finishRequest(key: string, error?: string) {
    const request = this.requests.get(key)
    if (!request)
      return
    this.requests.delete(key)
    const fields = this.requestFields(key, request)
    // Fast images/fonts are noise. Retain important requests, all failures and
    // slow resources, while sampling still reports requests that never finish.
    if (error || fields.durationMs >= 1500 || ['mainFrame', 'xhr'].includes(request.type) || ['task', 'onnx', 'wasm', 'vrm', 'face_landmarker', 'pose_landmarker_lite'].includes(request.target.resource))
      this.write(error ? 'request-failed' : 'request-completed', { ...fields, ...(error ? { error } : {}) })
  }

  /** Marks only a declared tool and hashed correlation id, never its arguments/result. */
  operation(name: string, operationId: string = randomUUID()) {
    const startedAt = performance.now()
    const names = ['browser_start_ordering', 'browser_customer_reset', 'browser_cart_get', 'browser_state_get', 'browser_recovery_context', 'browser_table_select', 'browser_order_submit', 'browser_invoice_select', 'browser_checkout_prepare', 'native-audio-status', 'native-audio-start', 'native-audio-open', 'array-input-connect']
    name = names.includes(name) ? name : 'other'
    const correlation = createHash('sha256').update(operationId).digest('hex').slice(0, 16)
    this.write('operation-start', { name, correlation })
    return () => this.write('operation-finished', { name, correlation, durationMs: Math.round(performance.now() - startedAt) })
  }

  private sample() {
    const now = performance.now()
    const eventLoopLagMs = Math.max(0, Math.round(now - this.lastSampleAt - 5000))
    this.lastSampleAt = now
    try {
      this.write('process-sample', { eventLoopLagMs, freeMemoryMiB: Math.round(freemem() / 1048576), totalMemoryMiB: Math.round(totalmem() / 1048576), processes: this.metrics().map(item => ({ pid: item.pid, type: item.type, cpuPercent: item.cpu.percentCPUUsage, workingSetKiB: item.memory.workingSetSize })) })
    }
    catch { this.write('process-sample-unavailable') }
    for (const [key, request] of this.requests) {
      if (now - request.startedAt >= 4000)
        this.write('request-pending', this.requestFields(key, request))
    }
    for (const owner of this.documents.values()) {
      if (owner.probeAt !== undefined) {
        this.write('renderer-probe-pending', { role: owner.role, contentsId: owner.contents.id, durationMs: Math.round(now - owner.probeAt) })
        continue
      }
      if (owner.contents.isDestroyed())
        continue
      owner.probeAt = now
      const navigationId = owner.navigationId
      void owner.contents.executeJavaScriptInIsolatedWorld(1002, [{ code: rendererProbe }]).then((value: unknown) => {
        const result = safeParse(rendererSample, value)
        if (result.success && !this.stopped && this.documents.get(owner.contents.id) === owner && owner.navigationId === navigationId)
          this.write('renderer-performance', { role: owner.role, contentsId: owner.contents.id, pid: owner.contents.isDestroyed() ? undefined : owner.contents.getOSProcessId(), navigationId, ...result.output })
      }).catch(() => {
        // Navigation/destruction can reject a pending read. It is not a PB
        // connection failure and must not trigger refresh or any merchant tool.
        if (!this.stopped && this.documents.get(owner.contents.id) === owner && owner.navigationId === navigationId)
          this.write('renderer-probe-unavailable', { role: owner.role, contentsId: owner.contents.id, navigationId })
      }).finally(() => { owner.probeAt = undefined })
    }
  }

  /** Serializes bounded batches; disk failure drops diagnostics, never blocks ordering. */
  flush(): Promise<void> {
    // A stalled disk must not create one queued promise per timer tick.
    if (this.flushing)
      return this.work
    this.flushing = true
    const run = this.work.then(async () => {
      if (!this.queue.length)
        return
      if (this.dropped) {
        this.queue.shift()
        this.queue.push(`${JSON.stringify({ at: new Date().toISOString(), runId: this.runId, elapsedMs: Math.round(performance.now() - this.beganAt), event: 'records-dropped', count: this.dropped })}\n`)
        this.dropped = 0
      }
      const batch = this.queue.splice(0).join('')
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const current = join(this.directory, 'current.jsonl')
      this.bytes ??= await stat(current).then(value => value.size).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT')
          return 0
        throw error
      })
      if (this.bytes + Buffer.byteLength(batch) > 4 * 1024 * 1024) {
        const move = async (from: string, to: string) => rename(join(this.directory, from), join(this.directory, to)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT')
            throw error
        })
        await move('previous.jsonl', 'older.jsonl')
        await move('current.jsonl', 'previous.jsonl')
        this.bytes = 0
      }
      await appendFile(current, batch, { mode: 0o600 })
      this.bytes += Buffer.byteLength(batch)
    })
    this.work = run.catch(() => {
      this.bytes = undefined
      if (!this.writeFailed) {
        this.writeFailed = true
        console.warn('Kiosk diagnostics could not write its local log; ordering remains available.')
      }
    }).finally(() => { this.flushing = false })
    return this.work
  }

  /** Stops observers/timers, records interrupted requests and drains the last batch. */
  async dispose() {
    clearInterval(this.flushTimer)
    clearInterval(this.sampleTimer)
    for (const owner of this.documents.values())
      owner.remove()
    for (const remove of this.sessions.values())
      remove()
    this.sessions.clear()
    this.write('recorder-stop')
    this.stopped = true
    await this.flush()
    if (this.queue.length)
      await this.flush()
  }
}
