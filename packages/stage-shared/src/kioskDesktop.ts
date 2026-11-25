import type { InferOutput } from 'valibot'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'
import { boolean, finite, integer, literal, maxLength, minLength, minValue, number, object, optional, pick, picklist, pipe, strictObject, string, variant } from 'valibot'

import { discoveryRequestSchema, executionRequestSchema, inspectionRequestSchema } from './interactiveService'

/** CSS-pixel bounds in the trusted Kiosk renderer; the desktop host clips them to its window. */
export const surfaceBoundsSchema = strictObject({
  x: pipe(number(), finite()),
  y: pipe(number(), finite()),
  width: pipe(number(), finite(), minValue(0)),
  height: pipe(number(), finite(), minValue(0)),
})

/** A host-approved service placement. sequence orders requests across component replacement. */
export const desktopSurfaceRequestSchema = strictObject({
  sequence: pipe(number(), integer(), minValue(1)),
  serviceId: pipe(string(), minLength(1), maxLength(120)),
  documentKey: pipe(string(), minLength(1), maxLength(200)),
  url: pipe(string(), minLength(1), maxLength(2000)),
  bounds: surfaceBoundsSchema,
  visible: boolean(),
})
/** Placement can remain loading during website-initiated navigation; only current-document readiness reveals it. */
export const desktopSurfaceResultSchema = object({
  sequence: number(),
  state: picklist(['visible', 'hidden', 'loading', 'failed', 'superseded']),
})
export type DesktopSurfaceRequest = InferOutput<typeof desktopSurfaceRequestSchema>
export type DesktopSurfaceResult = InferOutput<typeof desktopSurfaceResultSchema>
export type SurfaceBounds = InferOutput<typeof surfaceBoundsSchema>
export const desktopSurfaceActivitySchema = pick(desktopSurfaceRequestSchema, ['serviceId', 'documentKey'])
/** Activity identifies its service document without carrying typed keys or personal input. */
export type DesktopSurfaceActivity = InferOutput<typeof desktopSurfaceActivitySchema>
export const gatewayChoiceSchema = picklist(['apple', 'wallet', 'card'])
export type GatewayChoice = InferOutput<typeof gatewayChoiceSchema>
export const desktopSurfaceNavigationSchema = object({
  ...desktopSurfaceActivitySchema.entries,
  revision: pipe(number(), integer(), minValue(1)),
  state: picklist(['loading', 'ready', 'manual-payment', 'failed']),
  gatewayOrder: optional(string()),
  paymentProvider: optional(picklist(['line', 'ecpay'])),
})
/** Full-document navigation only; no merchant URL, scan value or credentials are broadcast. */
export type DesktopSurfaceNavigation = InferOutput<typeof desktopSurfaceNavigationSchema>

/** Narrow preload capability: only a registered host surface, never raw Electron or JavaScript. */
export interface KioskDesktopBridge {
  version: 1
  /** Installed desktop package version supplied by the host process. */
  appVersion?: string
  updateSurface: (input: Omit<DesktopSurfaceRequest, 'sequence'>) => Promise<DesktopSurfaceResult>
  invokeService: (input: DesktopServiceRequest) => Promise<unknown>
  onActivity: (listener: (activity: DesktopSurfaceActivity) => void) => () => void
  onNavigation: (listener: (navigation: DesktopSurfaceNavigation) => void) => () => void
}

export const updateDesktopSurface = defineInvokeEventa<DesktopSurfaceResult, DesktopSurfaceRequest>('airi:kiosk:desktop:surface:v1')
export const desktopSurfaceActivity = defineEventa<DesktopSurfaceActivity>('airi:kiosk:desktop:activity:v1')
export const desktopSurfaceNavigation = defineEventa<DesktopSurfaceNavigation>('airi:kiosk:desktop:navigation:v1')

declare global {
  interface Window {
    airiKioskDesktop?: KioskDesktopBridge
  }
}

/** A finite RPC envelope; renderer input never supplies JavaScript or browser selectors. */
export const desktopServiceRequestSchema = strictObject({
  serviceId: pipe(string(), minLength(1), maxLength(120)),
  documentKey: pipe(string(), minLength(1), maxLength(200)),
  command: variant('kind', [
    strictObject({ kind: literal('return-payment'), revision: pipe(number(), integer(), minValue(1)), reference: pipe(string(), minLength(1), maxLength(200)) }),
    strictObject({ kind: literal('choose-gateway'), revision: pipe(number(), integer(), minValue(1)), reference: string(), choice: gatewayChoiceSchema }),
    strictObject({ kind: literal('discover'), request: discoveryRequestSchema }),
    strictObject({ kind: literal('execute'), request: executionRequestSchema }),
    strictObject({ kind: literal('inspect'), request: inspectionRequestSchema }),
  ]),
})
export type DesktopServiceRequest = InferOutput<typeof desktopServiceRequestSchema>
export const invokeDesktopService = defineInvokeEventa<unknown, DesktopServiceRequest>('airi:kiosk:desktop:service:v1')
