// Recovery must work independently of the cached Vue router and auth bootstrap.
// Remove only this origin's root management worker, never tokens or device state.
document.getElementById('recover').addEventListener('click', async (event) => {
  const button = event.currentTarget
  const status = document.getElementById('status')
  button.disabled = true
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      for (const registration of registrations) {
        const script = registration.active?.scriptURL ?? registration.waiting?.scriptURL ?? registration.installing?.scriptURL
        if (registration.scope !== `${location.origin}/` || !script)
          continue
        const path = new URL(script).pathname
        if (path === '/sw.js' || /^\/webnavior-sw-\d+\.js$/.test(path))
          await registration.unregister()
      }
    }
    location.replace(`/admin?refresh=${Date.now()}`)
  }
  catch {
    status.textContent = '修復未完成，請關閉其他後台分頁後再試一次。'
    button.disabled = false
  }
})
