/** Lab geometry in meters. Positive azimuth is toward positive X from +Y. */
export function microphonePositions(radiusMm: number): readonly (readonly [
  number,
  number,
])[] {
  const radius = radiusMm / 1000
  const h = radius * Math.sqrt(3) / 2
  return [[0, 0], [-radius, 0], [-radius / 2, -h], [radius / 2, -h], [radius, 0], [radius / 2, h], [-radius / 2, h]]
}
