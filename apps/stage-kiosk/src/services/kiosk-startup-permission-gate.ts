/**
 * Holds optional startup work behind a permission request that must be visible
 * to the visitor first. Browser permission prompts are not safe to overlap.
 */
export function createKioskStartupPermissionGate() {
  let settled = false
  let resolve!: () => void
  const permissionSettled = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })

  function settle() {
    if (settled)
      return
    settled = true
    resolve()
  }

  async function wait() {
    await permissionSettled
  }

  return { settle, wait }
}
