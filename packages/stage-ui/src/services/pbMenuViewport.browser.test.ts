import { expect, it, vi } from 'vitest'

import { installMenuViewport } from './pbMenuViewport'

it('positions the first category on each return from the cart and respects customer scrolling on the menu', async () => {
  const initialUrl = location.href
  const menu = '/order/store/test/menu'
  const cart = '/order/store/test/orders/create'
  history.replaceState({}, '', menu)
  const viewport = installMenuViewport(menu, cart)
  try {
    const catalog = '<main style="min-height:300vh"><button role="tab">便當</button><section class="category-section"><h3>便當</h3><button><h4>排骨便當</h4></button></section></main>'
    document.body.innerHTML = catalog
    const selected = vi.fn()
    document.querySelector('button')!.addEventListener('click', selected)
    await vi.waitFor(() => expect(selected).toHaveBeenCalledTimes(1))
    for (const manual of [false, true, false]) {
      history.replaceState({}, '', cart)
      document.body.innerHTML = '<form>購物車</form>'
      await Promise.resolve()
      history.replaceState({}, '', menu)
      document.body.innerHTML = '<main>載入中</main>'
      if (manual)
        viewport.takeOver()
      document.body.innerHTML = catalog
      window.scrollTo(0, 120)
      const clicked = vi.fn()
      document.querySelector('button')!.addEventListener('click', clicked)
      await Promise.resolve()
      expect(clicked).toHaveBeenCalledTimes(manual ? 0 : 1)
      viewport.positionMenu()
      expect(clicked).toHaveBeenCalledTimes(manual ? 0 : 1)
    }
  }
  finally {
    viewport.dispose()
    history.replaceState({}, '', initialUrl)
    document.body.replaceChildren()
  }
})
