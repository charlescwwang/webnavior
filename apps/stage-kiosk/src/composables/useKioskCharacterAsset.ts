import type { KioskProfile } from '../services/kiosk-device'

import { DisplayModelFormat, useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useSettingsStageModel } from '@proj-airi/stage-ui/stores/settings/stage-model'

const assetCacheKey = 'webnavior/kiosk/character-asset'
const apiBaseUrl = (import.meta.env.VITE_API_SERVER_URL ?? 'http://localhost:5168').replace(/\/$/, '')

interface CachedAsset {
  modelId: string
  sha256: string
}

interface AssetCacheState {
  current?: CachedAsset
  previous?: CachedAsset
}

/**
 * Synchronizes the published server avatar to AIRI's existing IndexedDB model
 * store. The server hash is authoritative; Kiosk only re-downloads when the
 * published reference changes, then retains the current and prior file cache.
 */
export function useKioskCharacterAsset() {
  const displayModels = useDisplayModelsStore()
  const stageModel = useSettingsStageModel()

  async function apply(profile: KioskProfile) {
    const asset = profile.snapshot.characterAsset
    if (!asset)
      return

    const cache = readCache()
    if (cache.current?.sha256 === asset.sha256 && await displayModels.getDisplayModel(cache.current.modelId)) {
      stageModel.stageModelSelected = cache.current.modelId
      await stageModel.updateStageModel()
      return
    }

    const response = await fetch(`${apiBaseUrl}/assets/kiosk/${encodeURIComponent(asset.id)}`)
    if (!response.ok)
      throw new Error(`Failed to download kiosk character asset: ${response.status}`)

    const file = new File([
      await response.blob(),
    ], asset.name, { type: asset.format === 'vrm' ? 'model/gltf-binary' : 'application/zip' })
    const model = await displayModels.addDisplayModel(
      asset.format === 'vrm' ? DisplayModelFormat.VRM : DisplayModelFormat.Live2dZip,
      file,
    )
    if (cache.previous && cache.current && cache.previous.modelId !== cache.current.modelId)
      await displayModels.removeDisplayModel(cache.previous.modelId)
    writeCache({ current: { modelId: model.id, sha256: asset.sha256 }, previous: cache.current })
    stageModel.stageModelSelected = model.id
    await stageModel.updateStageModel()
  }

  function readCache(): AssetCacheState {
    try {
      const value = localStorage.getItem(assetCacheKey)
      if (!value)
        return {}
      const parsed = JSON.parse(value) as Record<string, unknown>
      // The browser cache was introduced after profiles already existed. An
      // older one-record value is harmless and becomes the current entry.
      if (typeof parsed.modelId === 'string' && typeof parsed.sha256 === 'string')
        return { current: { modelId: parsed.modelId, sha256: parsed.sha256 } }
      return {
        current: isCachedAsset(parsed.current) ? parsed.current : undefined,
        previous: isCachedAsset(parsed.previous) ? parsed.previous : undefined,
      }
    }
    catch {
      return {}
    }
  }

  function writeCache(value: AssetCacheState) {
    localStorage.setItem(assetCacheKey, JSON.stringify(value))
  }

  return { apply }
}

function isCachedAsset(value: unknown): value is CachedAsset {
  return typeof value === 'object'
    && value !== null
    && typeof (value as CachedAsset).modelId === 'string'
    && typeof (value as CachedAsset).sha256 === 'string'
}
