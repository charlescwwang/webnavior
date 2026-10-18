import type { EffectScope } from 'vue'

import type { SimulationSelection } from './usePaymentSimulation'

import QRCode from 'qrcode'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, shallowRef } from 'vue'

import { usePaymentSimulation } from './usePaymentSimulation'

const scopes: EffectScope[] = []
afterEach(() => {
  for (const scope of scopes.splice(0))
    scope.stop()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('test QR payment countdown', () => {
  it.each(['linepay', 'jkopay'] as const)('completes %s exactly once after five seconds without a button', async (method) => {
    vi.useFakeTimers()
    // NOTICE: @types/qrcode/index.d.ts:418-426 ends with a void callback
    // overload. An implementation preserves the Promise call form without casts.
    const encode = vi.spyOn(QRCode, 'toDataURL').mockImplementation(async () => 'data:image/png;base64,test')
    const complete = vi.fn()
    const scope = effectScope()
    scopes.push(scope)
    const simulation = scope.run(() => usePaymentSimulation(() => ({ method, total: '$130' }), complete))!
    expect(encode).not.toHaveBeenCalled()
    simulation.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(simulation.qr.value).toBe('data:image/png;base64,test')
    expect(simulation.remaining.value).toBe(5)
    expect(JSON.parse(encode.mock.calls[0]![0] as string)).toEqual({ simulation: 'AIRI TEST ONLY - NO REAL PAYMENT', method, total: '$130' })
    await vi.advanceTimersByTimeAsync(4_999)
    expect(simulation.remaining.value).toBe(1)
    expect(complete).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(simulation.remaining.value).toBe(0)
    expect(complete).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(complete).toHaveBeenCalledOnce()
  })

  it('cancels when returning or payment becomes locked, and restarts for a fresh choice', async () => {
    vi.useFakeTimers()
    vi.spyOn(QRCode, 'toDataURL').mockImplementation(async () => 'data:image/png;base64,test')
    const complete = vi.fn()
    const selection = shallowRef<SimulationSelection | undefined>({ method: 'linepay', total: '$130' })
    const scope = effectScope()
    scopes.push(scope)
    const simulation = scope.run(() => usePaymentSimulation(() => selection.value, complete))!
    simulation.start()
    await vi.advanceTimersByTimeAsync(2_000)
    selection.value = undefined
    await vi.advanceTimersByTimeAsync(10_000)
    expect(complete).not.toHaveBeenCalled()
    expect(simulation.qr.value).toBe('')
    selection.value = { method: 'jkopay', total: '$130' }
    await vi.advanceTimersByTimeAsync(4_999)
    expect(complete).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(complete).toHaveBeenCalledOnce()
  })

  it('resets all five seconds when the method or amount changes', async () => {
    vi.useFakeTimers()
    vi.spyOn(QRCode, 'toDataURL').mockImplementation(async () => 'data:image/png;base64,test')
    const complete = vi.fn()
    const selection = shallowRef<SimulationSelection>({ method: 'linepay', total: '$130' })
    const scope = effectScope()
    scopes.push(scope)
    const simulation = scope.run(() => usePaymentSimulation(() => selection.value, complete))!
    simulation.start()
    await vi.advanceTimersByTimeAsync(2_000)
    selection.value = { method: 'jkopay', total: '$130' }
    await vi.advanceTimersByTimeAsync(2_000)
    selection.value = { method: 'jkopay', total: '$160' }
    await vi.advanceTimersByTimeAsync(4_999)
    expect(complete).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(complete).toHaveBeenCalledOnce()
  })

  it('cancels its timer when the payment screen is disposed', async () => {
    vi.useFakeTimers()
    vi.spyOn(QRCode, 'toDataURL').mockImplementation(async () => 'data:image/png;base64,test')
    const complete = vi.fn()
    const scope = effectScope()
    scopes.push(scope)
    const simulation = scope.run(() => usePaymentSimulation(() => ({ method: 'linepay', total: '$130' }), complete))!
    simulation.start()
    await vi.advanceTimersByTimeAsync(2_000)
    scope.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(complete).not.toHaveBeenCalled()
  })

  it('ignores an old QR response after changing the payment method', async () => {
    vi.useFakeTimers()
    let finishOldQr!: (image: string) => void
    vi.spyOn(QRCode, 'toDataURL')
      .mockImplementationOnce(() => new Promise<string>(resolve => finishOldQr = resolve))
      .mockImplementation(async () => 'data:image/png;base64,new')
    const complete = vi.fn()
    const selection = shallowRef<SimulationSelection>({ method: 'linepay', total: '$130' })
    const scope = effectScope()
    scopes.push(scope)
    const simulation = scope.run(() => usePaymentSimulation(() => selection.value, complete))!
    simulation.start()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(complete).not.toHaveBeenCalled()
    selection.value = { method: 'jkopay', total: '$130' }
    await vi.advanceTimersByTimeAsync(2_000)
    finishOldQr('data:image/png;base64,old')
    await vi.advanceTimersByTimeAsync(2_999)
    expect(simulation.qr.value).toBe('data:image/png;base64,new')
    expect(complete).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(complete).toHaveBeenCalledOnce()
  })

  it('does not complete or retry automatically when QR generation fails', async () => {
    vi.useFakeTimers()
    const encode = vi.spyOn(QRCode, 'toDataURL').mockRejectedValue(new Error('QR generation failed'))
    const complete = vi.fn()
    const scope = effectScope()
    scopes.push(scope)
    const simulation = scope.run(() => usePaymentSimulation(() => ({ method: 'linepay', total: '$130' }), complete))!
    simulation.start()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(simulation.error.value).toBe('QR generation failed')
    expect(simulation.qr.value).toBe('')
    expect(encode).toHaveBeenCalledOnce()
    expect(complete).not.toHaveBeenCalled()
  })

  it('generates an actual QR image using the existing qrcode package', async () => {
    const scope = effectScope()
    scopes.push(scope)
    const simulation = scope.run(() => usePaymentSimulation(() => ({ method: 'linepay', total: '$130' }), vi.fn()))!
    simulation.start()
    await vi.waitFor(() => expect(simulation.qr.value).toMatch(/^data:image\/png;base64,/))
    expect(simulation.error.value).toBeUndefined()
  })
})
