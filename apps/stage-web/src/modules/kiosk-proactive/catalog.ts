import type * as KioskProactive from '@proj-airi/kiosk-proactive'

/**
 * POC catalog for browser-delivered kiosk modules.
 *
 * It deliberately knows only how to locate a module. A future signed remote
 * registry can replace this catalog without changing the module's policy API.
 */
export const kioskModuleCatalog = {
  'kiosk-proactive': {
    id: 'kiosk-proactive',
    title: '主動互動',
    load: () => import('@proj-airi/kiosk-proactive'),
  },
} as const

export type KioskProactiveModule = typeof KioskProactive

/** Loads the optional module only after the administrator requests it. */
export async function loadKioskProactiveModule(): Promise<KioskProactiveModule> {
  return kioskModuleCatalog['kiosk-proactive'].load()
}
