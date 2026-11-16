import { createPbService } from '../../packages/stage-ui/src/services/pbBrowserService'

/**
 * Exercises the production PB executor, including its API reads and native DOM
 * controls. It adds/edits/removes only a uniquely noted test line. Existing rows
 * are compared afterwards; orders and payments are never submitted by this run.
 * Reload to create a new document/service lifetime before repeating the check.
 */
export async function runCompatibilityCheck(progress) {
  if (document.documentElement.hasAttribute('data-webnavior-pb-bridge'))
    throw new Error('請重新整理後再跑下一輪，讓元件 ID 與文件生命週期重新建立。')
  const report = { version: 1, userAgent: navigator.userAgent, startedAt: new Date().toISOString(), checks: [], ok: false }
  const service = createPbService()
  const binding = service.discover({ version: 1, connectionId: crypto.randomUUID(), challenge: crypto.randomUUID() })
  const call = async (name, input) => {
    const receipt = await service.execute({ connectionId: binding.connectionId, documentId: binding.documentId, toolsRevision: binding.toolsRevision, operationId: crypto.randomUUID(), name, input })
    if (!receipt.result.ok)
      throw new Error(JSON.stringify(receipt.result))
    return receipt.result
  }
  const check = (name, condition) => {
    if (!condition)
      throw new Error(name)
    report.checks.push(name)
    progress(name)
  }
  try {
    if (location.pathname.endsWith('/select-table')) {
      const control = document.querySelector('[role="combobox"]')
      const selected = document.querySelector('.el-select__placeholder').textContent
      const table = selected === '請選擇桌號' ? 'A1 桌' : selected
      await call('browser_table_select', { name: table })
      check('隨機 ID 的桌號選單定位', control.getAttribute('aria-expanded') === 'false')
      await call('browser_start_ordering', { name: table })
      const deadline = performance.now() + 3000
      while (!location.pathname.endsWith('/menu')) {
        if (performance.now() > deadline)
          throw new Error('開始點餐未完成')
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
    const before = await call('browser_cart_get', { includeCatalog: true })
    check('原有 Inertia／菜單／規格 API 讀取', before.products.length === 13)
    await call('browser_search', { query: '水餃' })
    check('原有搜尋 DOM 與非同步結果核對', document.querySelector('.menu-search-meta').textContent === '共找到 2 項')
    const product = before.products.find(product => product.ref === 'p-2589')
    const configuration = product.configurations[0]
    const selection = { version: configuration.version, variantRef: '', choices: [{ ref: 'a-774', quantity: 2 }] }
    const note = `相容測試-${crypto.randomUUID().slice(0, 8)}`
    const added = await call('browser_cart_add', { version: before.cart.version, productRef: product.ref, quantity: 2, unitPrice: 80, note, selection })
    let current = await call('browser_cart_get', { includeCatalog: false })
    const line = current.cart.lines.find(line => line.note === note)
    check('原有商品／加量／份數／備註／加入車定位', Boolean(line && line.quantity === 2 && line.unitPrice === 80 && current.cart.subtotal === before.cart.subtotal + 160 && added.displayUpdated))
    const updated = await call('browser_cart_quantity', { version: current.cart.version, lineRef: line.ref, quantity: 3 })
    current = await call('browser_cart_get', { includeCatalog: false })
    check('原有購物車行定位與改份數', current.cart.lines.find(item => item.ref === line.ref)?.quantity === 3 && updated.displayUpdated)
    await call('browser_cart_remove', { version: current.cart.version, lineRef: line.ref })
    current = await call('browser_cart_get', { includeCatalog: false })
    check('原有 icon 刪除按鈕定位', !current.cart.lines.some(item => item.ref === line.ref))
    check('原有餐點與金額保持一致', JSON.stringify(current.cart.lines) === JSON.stringify(before.cart.lines) && current.cart.subtotal === before.cart.subtotal)

    // Manual additions intentionally bypass the AI's equivalent-row merge,
    // reproducing the vendor's two identical native rows without seeding state.
    await call('browser_search', { query: '水餃' })
    for (let index = 0; index < 2; index++) {
      document.querySelector('[data-action="product"][data-product-id="dumplings"]').click()
      for (const [id, value] of [['extra', '2'], ['quantity', '1'], ['product-note', note]]) {
        const input = document.getElementById(id)
        input.value = value
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
      document.querySelector('[data-action="add"]').click()
      const deadline = performance.now() + 5000
      while (document.querySelector('[data-action="add"]')) {
        if (performance.now() > deadline)
          throw new Error('測試手動加車未完成')
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
    current = await call('browser_cart_get', { includeCatalog: true })
    const sources = current.cart.lines.filter(line => line.note === note)
    check('手動加入保留相同加量的兩列', sources.length === 2 && sources.every(line => line.quantity === 1 && line.unitPrice === 80))
    const chicken = current.products.find(product => product.ref === 'p-2541') ?? current.products.find(product => product.name === '炸雞腿便當')
    const chickenConfiguration = chicken.configurations[0]
    await call('browser_cart_replace', { version: current.cart.version, lineRef: sources[0].ref, lineRefs: sources.map(line => line.ref), retainQuantity: 1, productRef: chicken.ref, quantity: 1, unitPrice: chickenConfiguration.unitPrice, note, selection: { version: chickenConfiguration.version, variantRef: '', choices: [] } })
    current = await call('browser_cart_get', { includeCatalog: true })
    const remaining = current.cart.lines.filter(line => line.note === note)
    check('相同列跨列部分換餐並保留水餃加量', remaining.length === 2 && remaining.some(line => line.name === product.name && line.quantity === 1 && line.unitPrice === 80 && line.options.some(option => option.name === '水餃1顆' && option.quantity === 2)) && remaining.some(line => line.name === chicken.name && line.quantity === 1))
    for (const line of remaining) {
      await call('browser_cart_remove', { version: current.cart.version, lineRef: line.ref })
      current = await call('browser_cart_get', { includeCatalog: false })
    }
    check('跨列測試後原有餐點與金額保持一致', JSON.stringify(current.cart.lines) === JSON.stringify(before.cart.lines) && current.cart.subtotal === before.cart.subtotal)
    report.ok = true
  }
  catch (error) {
    report.error = error.message
  }
  report.finishedAt = new Date().toISOString()
  return report
}
