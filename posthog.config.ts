/// <reference types="vite/client" />

import type { PostHogConfig } from 'posthog-js'

function isEnvFlagEnabled(value: string | undefined): boolean {
  if (value == null)
    return false

  return /^(?:1|true|t|yes|y|on)$/i.test(value.trim())
}

// Analytics is opt-in: both an explicit enable flag and this deployment's
// project key are required before the browser makes any analytics request.
export const POSTHOG_PROJECT_KEY = import.meta.env.VITE_POSTHOG_PROJECT_KEY ?? ''
export const POSTHOG_ENABLED = isEnvFlagEnabled(import.meta.env.VITE_ENABLE_POSTHOG) && Boolean(POSTHOG_PROJECT_KEY)

export const DEFAULT_POSTHOG_CONFIG = {
  api_host: 'https://app.posthog.com',
  person_profiles: 'identified_only', // or 'always' to create profiles for anonymous users as well
  // Without this, posthog-js only fires `$pageview` on the initial page load.
  // Every AIRI surface is an SPA (vue-router / VitePress client routing), so
  // route changes would be invisible in PostHog. The '2025-05-24' defaults
  // preset switches `capture_pageview` to 'history_change' — and because
  // `capture_pageleave` defaults to 'if_capture_pageview', every surface
  // that spreads this config also starts emitting `$pageleave`. That is
  // intentional: pageleave is what makes route-level dwell time queryable.
  defaults: '2025-05-24',
} as const satisfies Partial<PostHogConfig>
