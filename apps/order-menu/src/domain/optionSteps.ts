import type { MenuOptionGroup } from './order-machine'

/** Traverses the visible adjacent controls; only an unset zero choice needs explicit confirmation. */
export function optionSteps(group: MenuOptionGroup, selected: string | undefined, target: string): string[] {
  const end = group.values.findIndex(value => value.id === target)
  if (end < 0)
    throw new Error('The requested option is not available.')
  if (group.presentation !== 'piece-counter')
    return [target]
  const start = Math.max(0, group.values.findIndex(value => value.id === selected))
  if (start === end)
    return selected === target ? [] : [target]
  const direction = end > start ? 1 : -1
  return Array.from({ length: Math.abs(end - start) }, (_, index) => group.values[start + direction * (index + 1)]!.id)
}
