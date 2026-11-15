import { describe, expect, it } from 'vitest'

import { clipBounds, isHostClipboardWrite, isHostMediaRequest, isHostPage, parsePageUrl } from './policy'

describe('kiosk desktop navigation policy', () => {
  it('allows TLS websites and loopback development without embedded credentials', () => {
    expect(parsePageUrl('https://app.esgpb.com/order/').origin).toBe('https://app.esgpb.com')
    expect(parsePageUrl('http://localhost:5169/kiosk/').hostname).toBe('localhost')
    expect(() => parsePageUrl('http://public.example/menu')).toThrow()
    expect(() => parsePageUrl('file:///etc/passwd')).toThrow()
    expect(() => parsePageUrl('https://user:secret@example.com')).toThrow()
  })

  it('keeps privileged navigation inside the Kiosk path and exact origin', () => {
    const entry = new URL('https://example.com/kiosk/')
    expect(isHostPage('https://example.com/kiosk/#/settings', entry)).toBe(true)
    expect(isHostPage('https://example.com/admin', entry)).toBe(false)
    expect(isHostPage('https://example.com/kiosk-attacker/', entry)).toBe(false)
    expect(isHostPage('https://attacker.example/kiosk/', entry)).toBe(false)
  })

  it('clips partially offscreen regions without expanding them or covering host controls', () => {
    expect(clipBounds({ x: -10, y: 20, width: 50, height: 100 }, { width: 80, height: 90 })).toEqual({ x: 0, y: 20, width: 40, height: 70 })
    expect(clipBounds({ x: 100, y: 100, width: 50, height: 100 }, { width: 80, height: 90 })).toEqual({ x: 80, y: 90, width: 0, height: 0 })
  })

  it('admits Kiosk audio and presence camera in both Electron permission callbacks', () => {
    const entry = new URL('https://example.com/kiosk/')
    const page = `${entry.href}#/`
    expect(isHostMediaRequest(page, entry, 'media', entry.origin, { isMainFrame: true, requestingUrl: page, mediaType: 'audio' })).toBe(true)
    expect(isHostMediaRequest(page, entry, 'media', undefined, { isMainFrame: true, requestingUrl: page, mediaTypes: ['video'], securityOrigin: entry.origin })).toBe(true)
    expect(isHostMediaRequest(page, entry, 'media', undefined, { isMainFrame: true, requestingUrl: page, mediaTypes: ['audio', 'video'] })).toBe(true)
    expect(isHostMediaRequest(page, entry, 'media', undefined, { isMainFrame: true, requestingUrl: page, mediaTypes: ['audio', 'video'], securityOrigin: `${entry.origin}/` })).toBe(true)
  })

  it('refuses vendor, embedded, unrelated and unidentified capture requests', () => {
    const entry = new URL('https://example.com/kiosk/')
    const details = { isMainFrame: true, requestingUrl: entry.href, mediaType: 'audio' as const }
    expect(isHostMediaRequest('https://app.esgpb.com/order/', entry, 'media', entry.origin, details)).toBe(false)
    expect(isHostMediaRequest(entry.href, entry, 'media', entry.origin, { ...details, isMainFrame: false })).toBe(false)
    expect(isHostMediaRequest(entry.href, entry, 'media', 'https://attacker.example', details)).toBe(false)
    expect(isHostMediaRequest(entry.href, entry, 'media', entry.origin, { ...details, requestingUrl: 'https://example.com/admin' })).toBe(false)
    expect(isHostMediaRequest(entry.href, entry, 'media', entry.origin, { ...details, securityOrigin: 'null' })).toBe(false)
    expect(isHostMediaRequest(entry.href, entry, 'notifications', entry.origin, details)).toBe(false)
    expect(isHostMediaRequest(entry.href, entry, 'media', entry.origin, { ...details, mediaType: 'unknown' })).toBe(false)
    expect(isHostMediaRequest(entry.href, entry, 'media', entry.origin, { isMainFrame: true, requestingUrl: entry.href, mediaTypes: [] })).toBe(false)
  })
})

// Report: this chat, 2026-11-14 — Kiosk Copy failed to reach the OS clipboard.
it('allows clipboard writes from the host and its owned text popup only, without clipboard reads', () => {
  const entry = new URL('https://example.com/kiosk/')
  expect(isHostClipboardWrite(entry.href, entry, 'clipboard-sanitized-write', entry.origin, { isMainFrame: true, requestingUrl: entry.href })).toBe(true)
  expect(isHostClipboardWrite('about:blank', entry, 'clipboard-sanitized-write', entry.origin, { isMainFrame: true, requestingUrl: 'about:blank' }, true)).toBe(true)
  expect(isHostClipboardWrite('about:blank', entry, 'clipboard-sanitized-write', entry.origin, { isMainFrame: true }, false)).toBe(false)
  expect(isHostClipboardWrite(entry.href, entry, 'clipboard-read', entry.origin, { isMainFrame: true })).toBe(false)
  expect(isHostClipboardWrite(entry.href, entry, 'clipboard-sanitized-write', entry.origin, { isMainFrame: false })).toBe(false)
  expect(isHostClipboardWrite(entry.href, entry, 'clipboard-sanitized-write', 'https://other.example', { isMainFrame: true })).toBe(false)
  expect(isHostClipboardWrite('https://app.esgpb.com/order/', entry, 'clipboard-sanitized-write', entry.origin, { isMainFrame: true })).toBe(false)
})
