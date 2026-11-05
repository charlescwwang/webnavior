/** Test oracle supplied by the user; never included in the runtime. */
export class SpatialEngine {
  constructor(onOutput?: ((output: { raw: Float32Array, mask: Float32Array, gate: Float32Array }) => void) | null)
  push(channels: Float32Array[]): void
  finish(): void
  result(): { raw: Float32Array, mask: Float32Array, gate: Float32Array, sampleRate: number }
}
