import buildTime from '~build/time'

import { isStageWeb } from '@proj-airi/stage-shared'
import { abbreviatedSha, branch } from '~build/git'

import packageJSON from '../../package.json'

export function useBuildInfo() {
  const version = packageJSON.version ?? 'dev'

  return {
    version: isStageWeb() ? `${version} (${abbreviatedSha})` : version,
    // Embed the publication identity in this bundle. A runtime version fetch
    // describes the server's latest release, not necessarily this loaded page.
    release: import.meta.env.VITE_RELEASE_ID?.trim() || `${abbreviatedSha}@${buildTime.toISOString()}`,
    commit: abbreviatedSha,
    branch,
    builtOn: buildTime.toISOString(),
  }
}
