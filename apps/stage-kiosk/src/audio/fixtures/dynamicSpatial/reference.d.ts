export class SpatialEngine {
  push: (channels: Float32Array[]) => void
  finish: () => void
  result: () => { raw: Float32Array, mask: Float32Array, gate: Float32Array }
}
