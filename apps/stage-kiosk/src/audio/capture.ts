/** Same-clock buffers transferred from the array Worklet; sampleStart precedes delay compensation. */
export interface ArrayCapture {
  type: 'capture'
  id: string
  raw: Float32Array
  reference: Float32Array
  processed: Float32Array
  offset: number
  sampleStart: number
}

export type ArrayMessage = ArrayCapture | { type: 'error', reason: string }
