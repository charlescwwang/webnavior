/**
 * Returns true if the provided environment variable represents a truthy value.
 *
 * Truthy values: `true`, `t`, `yes`, `y`, `on`, `1`
 */
export function isEnvTruthy(value: string | undefined | null): boolean {
  if (value == null)
    return false
  return /^(?:1|true|t|yes|y|on)$/i.test(value.trim())
}

export function isFluxPurchaseDisabled(): boolean {
  return isEnvTruthy(import.meta.env.VITE_DISABLE_FLUX_PURCHASE)
}

export function isCustomProvidersDisabled(): boolean {
  return isEnvTruthy(import.meta.env.VITE_DISABLE_CUSTOM_PROVIDERS)
}

/**
 * Returns whether account-gated AIRI cloud features are enabled.
 *
 * A user's local setting takes precedence over the build default so the
 * product can expose this choice from its settings UI. Set
 * `VITE_ENABLE_ACCOUNT_FEATURES=true` to change that default for new users.
 */
export function isAccountFeaturesEnabled(): boolean {
  if (typeof localStorage !== 'undefined') {
    const userSetting = localStorage.getItem('settings/account-features-enabled')
    if (userSetting != null)
      return isEnvTruthy(userSetting)
  }

  return isEnvTruthy(import.meta.env.VITE_ENABLE_ACCOUNT_FEATURES)
}
