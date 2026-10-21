/** Observable page scenarios, without asserting inventory quantities. */
export const menuPageStates = ['available', 'sold-out', 'unknown', 'selection-failure'] as const
export type MenuPageState = typeof menuPageStates[number]
