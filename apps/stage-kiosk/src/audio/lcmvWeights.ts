import type { LcmvTuning } from './tuning'

import { microphonePositions } from './arrayGeometry'
import { fftSize as standaloneFftSize } from './lcmv'
import { defaultLcmv, validateLcmv } from './tuning'
/** Device geometry: centre MIC0, then MIC1..6; positive Y faces between MIC5/6. */
export function designTunedWeights(radiusMm = 44, rate = 48000, tuning: LcmvTuning = defaultLcmv, fftSize = standaloneFftSize): Float64Array {
  validateLcmv(tuning)
  const standalone = rate === 48000 && fftSize === standaloneFftSize
  const binary = rate === 16000 && fftSize === 512
  if (!Number.isFinite(radiusMm) || radiusMm < 10 || radiusMm > 100 || (!standalone && !binary))
    throw new Error('Unsupported array geometry or analysis format.')
  const positions = microphonePositions(radiusMm)
  const angles = [tuning.frontDeg, tuning.suppress1Deg, tuning.suppress2Deg].map(deg => deg * Math.PI / 180)
  const elevations = [tuning.frontElevationDeg, tuning.suppress1ElevationDeg, tuning.suppress2ElevationDeg].map(deg => Math.cos(deg * Math.PI / 180))
  const weights = new Float64Array((fftSize / 2 + 1) * 7 * 2)
  for (let bin = 0; bin <= fftSize / 2; bin++) {
    const a = positions.map(([x, y]) => angles.map((angle, index) => {
      const phase = 2 * Math.PI * bin * rate / fftSize * (x! * Math.sin(angle) + y! * Math.cos(angle)) * elevations[index] / 343
      return [Math.cos(phase), Math.sin(phase)]
    }))
    // Solve the loaded3x3 complex Gram system once at setup, never per audio hop.
    const rows = Array.from({ length: 3 }, (_, i) => {
      const row = new Float64Array(8)
      for (let j = 0; j < 3; j++) {
        for (let ch = 0; ch < 7; ch++) {
          const [ar, ai] = a[ch]![i]!
          const [br, bi] = a[ch]![j]!
          row[j * 2] += ar! * br! + ai! * bi!
          row[j * 2 + 1] += ar! * bi! - ai! * br!
        }
        if (i === j)
          row[j * 2] += tuning.loading * 7
      }
      row[6] = i === 0 ? 1 : 0
      return row
    })
    for (let pivot = 0; pivot < 3; pivot++) {
      const row = rows[pivot]!
      const pr = row[2 * pivot]!
      const pi = row[2 * pivot + 1]!
      const norm = pr * pr + pi * pi
      for (let j = pivot; j < 4; j++) {
        const re = row[2 * j]!
        const im = row[2 * j + 1]!
        row[2 * j] = (re * pr + im * pi) / norm
        row[2 * j + 1] = (im * pr - re * pi) / norm
      }
      for (let i = 0; i < 3; i++) {
        if (i === pivot)
          continue
        const other = rows[i]!
        const re = other[2 * pivot]!
        const im = other[2 * pivot + 1]!
        for (let j = pivot; j < 4; j++) {
          other[2 * j] -= re * row[2 * j]! - im * row[2 * j + 1]!
          other[2 * j + 1] -= re * row[2 * j + 1]! + im * row[2 * j]!
        }
      }
    }
    let targetRe = 0
    let targetIm = 0
    for (let ch = 0; ch < 7; ch++) {
      const offset = (bin * 7 + ch) * 2
      for (let i = 0; i < 3; i++) {
        const [re, im] = a[ch]![i]!
        weights[offset] += re! * rows[i]![6]! - im! * rows[i]![7]!
        weights[offset + 1] += re! * rows[i]![7]! + im! * rows[i]![6]!
      }
      const [frontRe, frontIm] = a[ch]![0]!
      targetRe += weights[offset]! * frontRe! + weights[offset + 1]! * frontIm!
      targetIm += weights[offset]! * frontIm! - weights[offset + 1]! * frontRe!
    }
    const norm = targetRe ** 2 + targetIm ** 2
    for (let ch = 0; ch < 7; ch++) {
      const i = (bin * 7 + ch) * 2
      const re = weights[i]!
      const im = weights[i + 1]!
      weights[i] = (re * targetRe - im * targetIm) / norm
      weights[i + 1] = (im * targetRe + re * targetIm) / norm
    }
  }
  return weights
}
