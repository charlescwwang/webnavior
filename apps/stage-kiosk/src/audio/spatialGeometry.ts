/** Unit vector: azimuth from +Y toward +X; elevation above the array plane. */
export function directionVector(azimuth: number, elevation: number): [
  number,
  number,
  number,
] {
  const a = azimuth * Math.PI / 180
  const e = elevation * Math.PI / 180
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)]
}
/** Great-circle angle, avoiding unstable azimuth comparisons near the zenith. */
export function directionDistance(a: readonly number[], b: readonly number[]) {
  const n = Math.hypot(...a) * Math.hypot(...b)
  return n > 1e-12 ? Math.acos(Math.max(-1, Math.min(1, a.reduce((s, v, i) => s + v * b[i], 0) / n))) * 180 / Math.PI : 180
}
