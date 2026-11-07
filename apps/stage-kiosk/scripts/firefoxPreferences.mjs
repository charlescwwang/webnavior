/**
 * Keep Firefox acceptance from relying on Playwright's relaxed cookie defaults.
 * This changes only the dedicated test profile; personal Firefox is untouched.
 */
export const firefoxPrivacyPreferences = {
  // NOTICE: Playwright1.60 sets laxByDefault=false and Standard blocking to
  // cookieBehavior0 in coreBundle.js (around41955/42079). Explicitly retain Lax
  // and partition foreign cookies; these tests must not depend on that bypass.
  'network.cookie.sameSite.laxByDefault': true,
  'network.cookie.cookieBehavior': 5,
  'network.cookie.cookieBehavior.pbmode': 5,
}
