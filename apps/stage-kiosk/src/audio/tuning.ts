import { directionDistance, directionVector } from './spatialGeometry'

export const tuningFields = {
  inputGainDb: {
    label: 'VAD 輸入增益（dB）',
    value: 15,
    min: 0,
    max: 30,
    step: 1,
    help: '調大會一起放大人聲和殘留的 TTS。0 dB 直接送入 VAD，其餘設定會先經限幅器。',
  },
  frontDeg: {
    label: 'LCMV 保留方向（°）',
    value: 0,
    min: -180,
    max: 180,
    step: 1,
    help: '把主要保留方向對準說話站位。0° 是陣列正前方，請先用站位驗證方向。',
  },
  suppress1Deg: {
    label: 'LCMV 抑制方向 1（°）',
    value: -90,
    min: -180,
    max: 180,
    step: 1,
    help: '用其中一個抑制方向對準音響，再檢查附近的使用者聲音有沒有一起變小。',
  },
  suppress2Deg: {
    label: 'LCMV 抑制方向 2（°）',
    value: 90,
    min: -180,
    max: 180,
    step: 1,
    help: '可對準另一側的干擾。兩個抑制方向和保留方向須各不相同。',
  },
  frontElevationDeg: { label: 'LCMV 顧客仰角（°）', value: 70, min: 0, max: 85, step: 1, help: '相對平放陣列平面；0° 水平，90° 正上方。' },
  suppress1ElevationDeg: { label: 'LCMV 抑制方向 1 仰角（°）', value: 70, min: 0, max: 85, step: 1, help: '音響或旁人的仰角，需量測。' },
  suppress2ElevationDeg: { label: 'LCMV 抑制方向 2 仰角（°）', value: 70, min: 0, max: 85, step: 1, help: '音響或旁人的仰角，需量測。' },
  loading: {
    label: 'LCMV 穩定係數（loading）',
    value: 0.03,
    min: 0.001,
    max: 1,
    step: 0.001,
    help: '調大通常讓權重較穩，但指定方向的抑制可能變淺。先確認方向再試這個值。',
  },
} as const
export const lcmvKeys = ['frontDeg', 'suppress1Deg', 'suppress2Deg', 'frontElevationDeg', 'suppress1ElevationDeg', 'suppress2ElevationDeg', 'loading'] as const
export type TuningKey = keyof typeof tuningFields
export type LcmvTuning = Record<typeof lcmvKeys[number], number>
function defaults<K extends TuningKey>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map(key => [key, tuningFields[key].value])) as Record<K, number>
}
export const defaultLcmv = defaults(lcmvKeys)
export function validateSetting(key: TuningKey, value: number) {
  const { label, min, max, step } = tuningFields[key]
  const steps = (value - min) / step
  if (!Number.isFinite(value) || value < min || value > max || Math.abs(steps - Math.round(steps)) > 1e-7)
    throw new Error(`${label}須介於 ${min} 至 ${max}，每格 ${step}`)
  return value
}
export function validateLcmv(settings: LcmvTuning) {
  for (const key of lcmvKeys)
    validateSetting(key, settings[key])
  const dirs = [directionVector(settings.frontDeg, settings.frontElevationDeg), directionVector(settings.suppress1Deg, settings.suppress1ElevationDeg), directionVector(settings.suppress2Deg, settings.suppress2ElevationDeg)]
  if (dirs.some((a, i) => dirs.some((b, j) => j > i && directionDistance(a, b) < 1e-4)))
    throw new Error('LCMV 的保留與抑制方向須不同（方位與仰角一起判斷）')
}
