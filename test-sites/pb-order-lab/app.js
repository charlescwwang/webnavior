import { basePath, categories, products, revision, tables } from './catalog.js'
import { invoiceError, pay, selection, setCartQuantity, submit } from './order.js'
import { pageSnapshot, routeRegistry } from './fixtureProtocol.js'
import { runCompatibilityCheck } from './contractCheck.js'

const storageKey = 'pb-order-lab:v1'
const app = document.querySelector('#app')
const modalRoot = document.querySelector('#modal-root')
const invoiceLabels = { none: '無載具 (存入綠界電子發票載具)', citizen: '自然人憑證', carrier: '手機載具', tax: '統一編號', donation: '捐贈發票' }
const paymentLabels = { unpaid: '尚未付款', succeeded: '模擬付款成功', failed: '模擬付款失敗', cancelled: '已取消模擬付款', uncertain: '模擬結果不明，請核對' }
const emptyInvoice = () => ({ type: 'none', code: '', phone: '', email: '' })
const fresh = () => ({ schemaVersion: 1, draftStarted: false, tables, table: '', cart: [], invoice: emptyInvoice(), note: '', orders: [], checkoutKey: crypto.randomUUID() })
let state = fresh()
let query = ''
let category = ''
let selectedTable = tables[0]
let storageAvailable = true
let noticeTimer
let searchTimer
let restoreFocus
let sessionRevision = 0
let syncQueue = Promise.resolve()
const renderToken = crypto.randomUUID().slice(0, 8)

// The simulator owns the browser-profile session; sessionStorage is a reload/
// restart backup. A stale tab cannot overwrite a newer server revision. Corrupt
// backups are retained for inspection instead of silently overwritten.
try {
  const saved = sessionStorage.getItem(storageKey)
  if (saved) {
    const parsed = JSON.parse(saved)
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.cart) || !Array.isArray(parsed.orders) || !parsed.invoice || typeof parsed.checkoutKey !== 'string')
      throw new Error('Unsupported stored session')
    state = parsed
  }
}
catch {
  storageAvailable = false
  document.querySelector('#storage-warning').hidden = false
  document.querySelector('#storage-warning').textContent = '無法讀取儲存資料；目前以記憶體模式測試，重新整理將不保留本次變更。'
}

function save() {
  try {
    if (storageAvailable)
      sessionStorage.setItem(storageKey, JSON.stringify(state))
  }
  catch {
    storageAvailable = false
    document.querySelector('#storage-warning').hidden = false
    document.querySelector('#storage-warning').textContent = '瀏覽器無法儲存本次變更，請先匯出訂單；重新整理可能遺失資料。'
  }
  const snapshot = structuredClone(state)
  syncQueue = syncQueue.then(async () => {
    const response = await fetch('/__lab/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: sessionRevision, state: snapshot }) })
    const result = await response.json()
    if (!response.ok)
      throw new Error(result.error ?? '測試伺服器未完成同步，請重新整理核對。')
    sessionRevision = result.revision
    document.querySelector('#app').setAttribute('data-page', JSON.stringify(pageSnapshot(state, location.pathname + location.search)))
  }).catch((error) => {
    document.querySelector('#storage-warning').hidden = false
    document.querySelector('#storage-warning').textContent = error.message
    throw error
  })
  return syncQueue
}

// All user-entered notes and persisted fields cross this HTML boundary.
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const money = value => `$${value.toLocaleString('en-US')}`
const total = () => state.cart.reduce((sum, line) => sum + line.subtotal, 0)
const date = value => new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })
const now = () => ({ id: crypto.randomUUID(), now: new Date().toISOString() })
const button = (label, action, attrs = '') => `<button type="button" data-action="${action}" ${attrs}>${label}</button>`
const icon = name => `<img class="icon" src="/assets/${name}.svg" alt="" aria-hidden="true">`
const image = product => product.image ? `<img src="${product.image}" alt="${escape(product.name)}">` : '<div class="no-image">無圖片</div>'
const stepper = (name, value, min, max, label) => `<div class="stepper"><span role="button" tabindex="0" data-action="step" data-field="${name}" data-delta="-1" aria-label="減少${label}">${icon('minus')}</span><input type="number" id="${name}" name="${name}" data-testid="${name}" aria-label="${label}" min="${min}" max="${max}" step="1" value="${value}"><span role="button" tabindex="0" data-action="step" data-field="${name}" data-delta="1" aria-label="增加${label}">${icon('plus')}</span></div>`

function notify(message) {
  clearTimeout(noticeTimer)
  const notice = document.querySelector('#notice')
  notice.textContent = message
  notice.classList.add('visible')
  noticeTimer = setTimeout(() => notice.classList.remove('visible'), 3000)
}

function go(path) {
  closeModal()
  history.pushState({}, '', path)
  render()
  window.scrollTo(0, 0)
}

function showModal(content, className = '') {
  closeModal()
  restoreFocus = document.activeElement
  modalRoot.innerHTML = `<dialog role="dialog" class="${className}" aria-label="點餐對話框"><div class="dialog-header">${button(icon('close'), 'close', 'class="el-dialog__headerbtn" aria-label="關閉此對話框"')}</div>${content}</dialog>`
  const dialog = modalRoot.querySelector('dialog')
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeModal() })
  dialog.showModal()
}

function closeModal() {
  modalRoot.querySelector('dialog')?.close()
  modalRoot.replaceChildren()
  restoreFocus?.focus()
}

function render() {
  app.setAttribute('data-page', JSON.stringify(pageSnapshot(state, location.pathname + location.search)))
  clearTimeout(searchTimer)
  query = ''
  category = ''
  const path = location.pathname
  if (path === '/' || path.endsWith('/select-table'))
    renderTables()
  else if (path === `${basePath}/menu`)
    renderMenu()
  else if (path === `${basePath}/orders/create`) {
    // PB rebuilds checkout form fields on page entry, but keeps them during cart edits.
    state.invoice = emptyInvoice()
    state.note = ''
    renderCheckout()
  }
  else if (path === '/test/orders')
    renderHistory()
  else if (path.startsWith(`${basePath}/orders/`)) {
    const id = decodeURIComponent(path.split('/')[6] ?? '')
    const order = state.orders.find(order => order.orderId === id)
    if (!order)
      app.innerHTML = `<section class="empty"><h1>找不到此瀏覽器的測試訂單</h1><p>訂單只保存在建立它的瀏覽器分頁。</p>${button('返回選桌', 'tables')}</section>`
    else if (path.endsWith('/payment'))
      renderPayment(order)
    else
      renderReceipt(order)
  }
  else
    app.innerHTML = `<section class="empty"><h1>找不到此頁面</h1>${button('返回選桌', 'tables')}</section>`
}

function renderTables() {
  selectedTable = tables[0]
  const listId = `el-id-${renderToken}-tables`
  app.innerHTML = `<section class="select-screen"><div class="mode">♧ 內用</div><div class="table-row__select"><span>桌號</span><div class="el-select"><input id="el-id-${renderToken}-table" role="combobox" aria-label="桌號" aria-controls="${listId}" aria-expanded="false" readonly data-action="table-toggle" data-testid="table-select"><span class="el-select__placeholder">${escape(selectedTable)}</span><div class="el-select-dropdown" id="${listId}" role="listbox" hidden>${tables.map(table => `<div role="option" tabindex="0" aria-selected="${selectedTable === table}" data-action="table-option" data-table="${table}">${table}</div>`).join('')}</div></div></div>${button('開始點餐', 'start', 'class="primary wide" data-testid="start-order"')}<p class="muted">全天開放測試。選桌與送單皆只影響本機模擬資料。</p></section>`
}

function renderMenu() {
  if (!state.table) {
    go(`${basePath}/menu/select-table`)
    return
  }
  app.innerHTML = `<div class="menu-shell"><div class="menu-head"><h2>菜單 <span class="badge">內用</span></h2>${button(`桌號 ${escape(state.table)}`, 'tables', 'class="badge" data-testid="current-table"')}</div><div class="search-wrap"><input id="menu-search" name="search" type="search" value="${escape(query)}" placeholder="搜尋品項，例如：拿鐵、雞腿、套餐" aria-label="搜尋品項" data-testid="menu-search" autocomplete="off"></div><div class="menu-search-meta" aria-live="polite"></div>${button('總覽', 'overview')}<nav class="tabs" role="tablist" aria-label="菜單分類"></nav><div id="products"></div></div><div class="sticky-bar"><span><b data-testid="cart-count">${state.cart.reduce((sum, line) => sum + line.quantity, 0)}</b> 份餐點</span>${button(`${state.cart.length ? `<span class="text-xl font-bold ms-2">${money(total())}</span>` : money(0)} 去結算`, 'checkout', 'class="primary" data-testid="checkout"')}</div>`
  renderProducts()
}

function renderProducts() {
  const matches = products.filter(item => `${item.name} ${item.description ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  const visibleCategories = categories.filter(group => matches.some(item => item.categoryId === group.id))
  if (!visibleCategories.some(group => group.id === category))
    category = visibleCategories[0]?.id ?? ''
  document.querySelector('.tabs').innerHTML = visibleCategories.map(group => button(group.name, 'category', `role="tab" aria-selected="${category === group.id}" data-category="${group.id}" id="tab-${group.id}"`)).join('')
  document.querySelector('.menu-search-meta').textContent = query ? `共找到 ${matches.length} 項` : ''
  document.querySelector('#products').innerHTML = categories.map(group => {
    const items = matches.filter(item => item.categoryId === group.id)
    return items.length ? `<section class="category" id="pane-${group.id}"><h3>${group.name}</h3><div class="grid">${items.map(item => `<div class="menu-card" role="button" tabindex="0" data-action="product" data-product-id="${item.id}" data-testid="product-${item.id}" aria-label="${escape(item.name)} ${money(item.price)}"><div class="card-info"><div><h4>${escape(item.name)}</h4>${item.description ? `<p>${escape(item.description)}</p>` : ''}</div><div class="bottom"><span class="price">${money(item.price)}</span><span class="plus" aria-hidden="true">${icon('plus')}</span></div></div>${item.image ? image(item) : ''}</div>`).join('')}</div></section>` : ''
  }).join('') || '<section class="empty"><h3>找不到符合的餐點</h3><p>請試試其他關鍵字。</p></section>'
}

function openProduct(productId, lineId) {
  const product = products.find(item => item.id === productId)
  if (!product)
    return
  const line = state.cart.find(item => item.lineId === lineId)
  showModal(`<div class="dialog-content menu-dialog">${product.image ? image(product) : ''}<h1>${escape(product.name)}</h1>${product.description ? `<p>${escape(product.description)}</p>` : ''}<h4>價格 <span class="price">${money(product.price)}</span></h4>${product.extraPrice ? `<div class="product-item"><h4>加量</h4><span class="muted">可選 100 / 已選 <span id="extra-count">${line?.extra ?? 0}</span></span><ul><li class="extra-row"><div class="flex-col"><span>水餃 <span>${money(product.extraPrice)}</span></span></div>${stepper('extra', line?.extra ?? 0, 0, 100, '加量水餃顆數')}</li></ul></div>` : ''}<div class="field"><label for="product-note">商品備註</label><input id="product-note" name="productNote" placeholder="商品有特殊需求，請在此備註" data-testid="product-note" value="${escape(line?.note)}"></div><div id="product-error" role="alert"></div></div><div class="dialog-footer">${stepper('quantity', line?.quantity ?? 1, 1, Number.MAX_SAFE_INTEGER, '份數')}${button(`選好了 共計<span id="selection-total">${money(line?.subtotal ?? product.price)}</span>`, 'add', `class="primary" data-product-id="${product.id}" data-line-id="${lineId ?? ''}" data-testid="add-to-cart"`)}</div>`, 'product-modal')
}

function updateSelection() {
  const target = modalRoot.querySelector('[data-action="add"]')
  if (!target)
    return
  try {
    const result = selection(target.dataset.productId, Number(document.querySelector('#quantity').value), Number(document.querySelector('#extra')?.value ?? 0))
    document.querySelector('#selection-total').textContent = money(result.subtotal)
    if (document.querySelector('#extra-count'))
      document.querySelector('#extra-count').textContent = result.extra
    document.querySelector('#product-error').textContent = ''
  }
  catch (error) {
    document.querySelector('#product-error').textContent = error.message
  }
}

function renderCheckout() {
  if (!state.cart.length) {
    app.innerHTML = `<section class="empty order-create"><h2>購物車是空的</h2><p>先逛逛菜單，把喜歡的品項加入購物車吧！</p>${button('立即點餐', 'menu', 'class="primary"')}</section>`
    return
  }
  app.innerHTML = `<section class="checkout order-create"><div class="panel"><div class="panel-title"><h3>確認訂單</h3><a href="${basePath}/menu" data-action="menu">繼續點餐</a></div><div class="panel-title"><span>查看細節（${state.cart.length}個品項）</span>${button('清空', 'clear', 'data-testid="clear-cart"')}</div>${state.cart.map(line => `<article class="cart-row produce-item" data-line-id="${line.lineId}" data-product-id="${line.productId}">${image(products.find(item => item.id === line.productId))}<div class="line-body"><h3>${escape(line.name)} <span>(${money(line.unitPrice)})</span></h3><div class="product-attr"><div><div class="ml-4">${line.extra ? `<span>水餃${line.extra > 1 ? ` X${line.extra}` : ''}</span>` : ''}</div></div><div class="ml-4">${escape(line.note)}</div></div><div class="line-actions">${button(icon('minus'), 'line-quantity', `data-line-id="${line.lineId}" data-delta="-1" aria-label="減少${escape(line.name)}份數"`)}<input type="number" data-action-field="line-quantity" data-line-id="${line.lineId}" data-testid="line-quantity" min="0" max="${Number.MAX_SAFE_INTEGER}" value="${line.quantity}" aria-label="${escape(line.name)}份數">${button(icon('plus'), 'line-quantity', `data-line-id="${line.lineId}" data-delta="1" aria-label="增加${escape(line.name)}份數"`)}${button(icon('edit'), 'edit', `aria-label="編輯${escape(line.name)}" data-line-id="${line.lineId}"`)}${button(icon('delete'), 'remove', `class="is-circle" aria-label="刪除${escape(line.name)}" data-line-id="${line.lineId}"`)}</div></div><div class="line-total">小計 <b>${money(line.subtotal)}</b></div></article>`).join('')}<div class="total-row"><b>小計</b><strong>${money(total())}</strong></div></div><div class="panel"><h3>內用</h3>桌號：${escape(state.table)}</div><div class="panel"><details open><summary>開立發票</summary><div class="invoice-options">${Object.entries(invoiceLabels).map(([value, label]) => `<label class="el-radio"><input type="radio" name="invoiceType" data-method="${value}" value="${({none:5,citizen:2,carrier:3,tax:4,donation:6})[value]}" data-testid="invoice-${value}" ${state.invoice.type === value ? 'checked' : ''}>${label}<span data-code-host="${value}"></span></label>`).join('')}</div><div id="invoice-code-field"></div><b>發票通知（請擇一填寫）</b><div class="two-col"><div class="field"><label for="phone">手機號碼</label><input type="tel" id="phone" name="phone" value="${escape(state.invoice.phone)}" placeholder="手機號碼" data-testid="invoice-phone" autocomplete="off"></div><div class="field"><label for="email">E-mail</label><input type="email" id="email" name="email" value="${escape(state.invoice.email)}" placeholder="E-mail" data-testid="invoice-email" autocomplete="off"></div></div><small class="muted">測試可填 0912345678 或 tester@example.test；請勿填寫真實個資。</small></details></div><div class="panel"><details><summary>訂單備註</summary><div class="field"><textarea id="order-note" name="orderNote" data-testid="order-note" aria-label="訂單備註">${escape(state.note)}</textarea></div></details></div><div class="panel"><h3>訂單說明</h3><p>時間若有更動，將撥打手機通知，請務必保留行動電話。</p><p class="muted">原站取消規則：付款後店家會立即接單，無法自行取消訂單，如需取消請聯絡店家。<br>此測試站不會接單、扣款、通知或開立發票。</p></div><div id="checkout-error" role="alert"></div></section><div class="sticky-bar"><span class="price">總金額 <b data-testid="order-total">${money(total())}</b></span>${button('送出訂單', 'submit', 'class="primary" data-testid="submit-order"')}</div>`
  renderInvoiceCode()
}

function renderInvoiceCode() {
  const placeholders = { citizen: '2碼英文字碼+14碼數字', carrier: '請輸入共8碼編號', tax: '請輸入統一編號', donation: '請輸入3~7碼數字' }
  const hints = { citizen: '請輸入自然人憑證右下角，2碼英文字碼+14碼數字之編號。', carrier: '請輸入「/」開頭，共8碼之手機條碼載具編號。', tax: '此處只檢查 8 碼格式，不查驗真實統編。', donation: '僅模擬捐贈碼格式，不連線查詢受贈機構。' }
  document.querySelectorAll('[data-code-host]').forEach(host => host.replaceChildren())
  const host = document.querySelector(`[data-code-host="${state.invoice.type}"]`)
  host.innerHTML = state.invoice.type === 'none' ? '' : `<div class="field"><span>${invoiceLabels[state.invoice.type]}編號</span><input id="invoice-code" aria-label="${invoiceLabels[state.invoice.type]}編號" name="invoiceCode" data-testid="invoice-code" value="${escape(state.invoice.code)}" placeholder="${placeholders[state.invoice.type]}" autocomplete="off"><small>${hints[state.invoice.type]}</small></div>`
}

function orderPath(order) { return `${basePath}/orders/${encodeURIComponent(order.orderId)}` }

function renderPayment(order) {
  if (['succeeded', 'uncertain'].includes(order.payment.status)) {
    renderReceipt(order)
    return
  }
  app.innerHTML = `<section class="receipt"><div class="panel"><h1>選擇付款方式</h1><p class="muted">以下是模擬付款頁；原站送單後的頁面尚未驗證。</p><dl><dt>訂單編號</dt><dd data-testid="order-id">${escape(order.orderId)}</dd><dt>付款金額</dt><dd class="price" data-testid="payment-amount">NT${money(order.total)}</dd></dl><div class="payment-grid actions"><button class="payment-choice" data-action="choose-payment" data-method="linepay" data-testid="payment-linepay" aria-pressed="false"><strong class="linepay">LINE Pay</strong><span>模擬行動支付</span></button><button class="payment-choice" data-action="choose-payment" data-method="card" data-testid="payment-card" aria-pressed="false"><strong>信用卡</strong><span>測試付款，不輸入卡號</span></button></div><div id="payment-flow"></div>${button('查看訂單', 'receipt', `data-order-id="${order.orderId}"`)}</div></section>`
}

function renderReceipt(order) {
  app.innerHTML = `<section class="receipt"><div class="receipt-heading"><div class="success-icon">${order.status === 'completed' ? '✓' : '○'}</div><h1>${order.status === 'completed' ? '測試訂單完成' : '測試訂單已建立'}</h1><p data-testid="payment-status">${paymentLabels[order.payment.status]}</p></div><div class="panel"><dl><dt>訂單編號</dt><dd data-testid="order-id">${escape(order.orderId)}</dd><dt>建立時間</dt><dd data-testid="order-time">${date(order.createdAt)}</dd><dt>桌號</dt><dd>${escape(order.table)}</dd><dt>訂單金額</dt><dd data-testid="receipt-total">NT${money(order.total)}</dd><dt>付款金額</dt><dd data-testid="paid-amount">NT${money(order.payment.amount)}</dd><dt>付款方式</dt><dd>${order.payment.method === 'linepay' ? 'LINE Pay' : order.payment.method === 'card' ? '信用卡' : '尚未選擇'}</dd><dt>付款時間</dt><dd>${order.payment.paidAt ? date(order.payment.paidAt) : '—'}</dd><dt>開立發票</dt><dd>${invoiceLabels[order.invoice.type]}（模擬，未開立）</dd></dl></div><div class="panel"><h3>餐點明細</h3>${order.items.map(item => `<div class="history-row"><div><b>${escape(item.name)}</b><p class="muted">${item.quantity} 份${item.extra ? ` · 每份加 ${item.extra} 顆水餃` : ''}${item.note ? ` · ${escape(item.note)}` : ''}</p></div><b>${money(item.subtotal)}</b></div>`).join('')}${order.note ? `<p>訂單備註：${escape(order.note)}</p>` : ''}</div>${order.payment.status === 'uncertain' ? '<p class="error">此模擬付款結果不明，鎖定重試以測試人工核對流程。請建立新測試單，不會自動重送。</p>' : ''}<div class="actions">${order.status === 'awaiting-payment' ? button('前往模擬付款', 'payment', `class="primary" data-order-id="${order.orderId}"`) : ''}${button('匯出訂單 JSON', 'export', `data-order-id="${order.orderId}" data-testid="export-order"`)}${button('查看訂單資料', 'json', `data-order-id="${order.orderId}"`)}${button('開始新訂單', 'new', 'data-testid="new-order"')}</div><p class="muted">本紀錄為測試資料，未送到店家、POS 或金流服務。</p></section>`
}

function renderHistory() {
  app.innerHTML = `<section class="history-screen"><div class="panel"><h1>測試點餐紀錄</h1>${state.orders.length ? state.orders.map(order => `<div class="history-row"><div><b>${escape(order.orderId)}</b><p class="muted">${date(order.createdAt)} · ${escape(order.table)}<br>${paymentLabels[order.payment.status]} · ${money(order.total)}</p></div>${button('查看', 'receipt', `data-order-id="${order.orderId}"`)}</div>`).join('') : '<p>尚無測試訂單。</p>'}<div class="actions">${button('繼續點餐', 'menu')}${button('匯出全部訂單', 'export-all')}</div></div></section>`
}

function tools() {
  showModal(`<div class="dialog-content"><h2>測試工具</h2><p class="muted">菜單版本：${revision}<br>桌號元件 ID 每次重新載入都會不同，現有 PB 執行器透過 aria-controls 找到對應清單。語意結構與商品 ID 保持固定；可變外觀模式另擾動 class 與 data-render-id。</p><div class="tools-grid">${button('執行現有 PB 執行器相容測試', 'contract-check')}${button('查看測試訂單紀錄', 'history')}${button('匯出全部訂單 JSON', 'export-all')}${button('套用可變外觀識別', 'drift')}${button('清除搜尋、返回全部菜單', 'menu')}${button('重設此瀏覽器全部測試資料…', 'reset-confirm')}</div><p class="muted">JSON 包含測試填寫的通知／發票欄位。只填假資料。此站提供既有執行器需要的菜單／購物車模擬讀取，不連接原站登入、金流或 POS。</p></div>`)
}

function download(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

document.addEventListener('input', async (event) => {
  const target = event.target
  if (target.id === 'menu-search') {
    query = target.value.trim()
    // Preserve the visible asynchronous search cycle used by PB browser tests.
    document.querySelector('.menu-search-meta').textContent = '搜尋中…'
    clearTimeout(searchTimer)
    searchTimer = setTimeout(renderProducts, 250)
  }
  else if (target.id === 'quantity' || target.id === 'extra')
    updateSelection()
  else if (['phone', 'email'].includes(target.id)) {
    state.invoice[target.id] = target.value.trim()
    await save()
  }
  else if (target.id === 'invoice-code') {
    state.invoice.code = target.value.trim()
    await save()
  }
  else if (target.id === 'order-note') {
    state.note = target.value
    await save()
  }
})

document.addEventListener('change', async (event) => {
  if (event.target.id === 'quantity' || event.target.id === 'extra')
    updateSelection()
  if (event.target.dataset.actionField === 'line-quantity') {
    const line = state.cart.find(line => line.lineId === event.target.dataset.lineId)
    try {
      setCartQuantity(state, line.lineId, Number(event.target.value))
      await save()
      renderCheckout()
    }
    catch (error) {
      event.target.value = line.quantity
      notify(error.message)
    }
  }
  if (event.target.name === 'invoiceType') {
    state.invoice.type = event.target.dataset.method
    state.invoice.code = ''
    await save()
    renderInvoiceCode()
  }
  if (event.target.id === 'table') {
    state.table = event.target.value
    await save()
  }
})

document.addEventListener('keydown', (event) => {
  const card = event.target.closest('.menu-card, .stepper [role="button"], [role="option"]')
  if (card && ['Enter', ' '].includes(event.key)) {
    event.preventDefault()
    card.click()
  }
  // Scanner Enter only finishes field input; it must never authorize submission.
  if (event.key === 'Enter' && event.target.matches('input:not([type="search"])'))
    event.preventDefault()
})

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]')
  if (!target)
    return
  event.preventDefault()
  const action = target.dataset.action
  const line = state.cart.find(line => line.lineId === target.dataset.lineId)
  const order = state.orders.find(order => order.orderId === target.dataset.orderId)
  try {
    if (action === 'contract-check') {
      closeModal()
      if (!location.pathname.endsWith('/menu') && !location.pathname.endsWith('/select-table'))
        go(`${basePath}/menu`)
      const report = await runCompatibilityCheck(message => notify(message))
      const output = JSON.stringify(report, null, 2)
      showModal(`<div class="dialog-content"><h2>${report.ok ? '相容測試通過' : '相容測試未完成'}</h2><pre data-testid="contract-result">${escape(output)}</pre><p class="muted">只測購物車操作，未送單或付款。重新整理可用另一組元件 ID 再測。</p></div>`)
    }
    else if (action === 'table-toggle') {
      const list = document.getElementById(target.getAttribute('aria-controls'))
      list.hidden = !list.hidden
      target.setAttribute('aria-expanded', String(!list.hidden))
    }
    else if (action === 'table-option') {
      selectedTable = target.dataset.table
      document.querySelector('.el-select__placeholder').textContent = selectedTable
      document.querySelectorAll('[role="option"]').forEach(option => option.setAttribute('aria-selected', String(option === target)))
      const control = document.querySelector('[role="combobox"]')
      control.setAttribute('aria-expanded', 'false')
      document.getElementById(control.getAttribute('aria-controls')).hidden = true
    }
    else if (action === 'start') {
      if (!tables.includes(selectedTable))
        return notify('請先選擇桌號。')
      state.table = selectedTable
      await save()
      go(`${basePath}/menu`)
    }
    else if (action === 'tables') go(`${basePath}/menu/select-table`)
    else if (action === 'menu') go(`${basePath}/menu`)
    else if (action === 'checkout') go(`${basePath}/orders/create`)
    else if (action === 'close') closeModal()
    else if (action === 'category') {
      category = target.dataset.category
      document.querySelectorAll('[data-action="category"]').forEach(tab => tab.setAttribute('aria-selected', String(tab === target)))
      document.getElementById(`pane-${category}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      closeModal()
    }
    else if (action === 'overview') {
      const visible = categories.filter(group => document.getElementById(`pane-${group.id}`))
      showModal(`<div class="dialog-content"><h2>菜單品類總覽</h2>${visible.map(group => button(`${group.name} ${products.filter(item => item.categoryId === group.id && `${item.name} ${item.description ?? ''}`.toLowerCase().includes(query.toLowerCase())).length}`, 'category', `data-category="${group.id}"`)).join('')}</div>`)
    }
    else if (action === 'product') openProduct(target.dataset.productId)
    else if (action === 'step') {
      const input = document.getElementById(target.dataset.field)
      input.value = Math.max(Number(input.min), Math.min(Number(input.max), Number(input.value) + Number(target.dataset.delta)))
      updateSelection()
    }
    else if (action === 'add') {
      const result = selection(target.dataset.productId, Number(document.querySelector('#quantity').value), Number(document.querySelector('#extra')?.value ?? 0), document.querySelector('#product-note').value)
      state.draftStarted = true
      if (state.orders.some(order => order.checkoutKey === state.checkoutKey))
        state.checkoutKey = crypto.randomUUID()
      if (line)
        Object.assign(line, result)
      else
        state.cart.push({ ...result, lineId: crypto.randomUUID(), vendorLineId: Math.max(0, ...state.cart.map(item => item.vendorLineId)) + 1 })
      await save()
      closeModal()
      location.pathname.endsWith('/orders/create') ? renderCheckout() : renderMenu()
      notify(line ? '已儲存修改' : '已加入購物車')
    }
    else if (action === 'edit' && line) openProduct(line.productId, line.lineId)
    else if (action === 'line-quantity' && line) {
      setCartQuantity(state, line.lineId, line.quantity + Number(target.dataset.delta))
      await save()
      renderCheckout()
    }
    else if (action === 'remove' || action === 'clear') {
      state.cart = action === 'clear' ? [] : state.cart.filter(item => item.lineId !== target.dataset.lineId)
      await save()
      renderCheckout()
    }
    else if (action === 'submit') {
      const error = invoiceError(state.invoice)
      if (error) {
        document.querySelector('#checkout-error').innerHTML = `<p class="error">${error}</p>`
        document.querySelector('#checkout-error').scrollIntoView({ block: 'center' })
        return
      }
      const receipt = submit(state, now())
      await save()
      window.dispatchEvent(new CustomEvent('pb-test:order-submitted', { detail: structuredClone(receipt) }))
      go(`${orderPath(receipt)}/payment`)
    }
    else if (action === 'choose-payment') {
      const current = state.orders.find(order => location.pathname === `${orderPath(order)}/payment`)
      document.querySelectorAll('.payment-choice').forEach(choice => choice.setAttribute('aria-pressed', String(choice === target)))
      document.querySelector('#payment-flow').innerHTML = `<div class="panel"><h3>${target.dataset.method === 'linepay' ? 'LINE Pay 模擬授權' : '信用卡模擬授權'}</h3><p>付款金額 <b class="price">${money(current.total)}</b></p><p class="muted">不用登入、掃碼或輸入真實卡號。選擇回應以驗證點餐流程。</p><div class="outcomes">${[['succeeded', '模擬付款成功'], ['failed', '模擬付款失敗'], ['cancelled', '取消付款'], ['uncertain', '模擬結果不明']].map(([outcome, label]) => button(label, 'pay', `data-method="${target.dataset.method}" data-outcome="${outcome}" data-order-id="${current.orderId}" data-testid="simulate-${outcome}" ${outcome === 'succeeded' ? 'class="primary"' : ''}`)).join('')}</div></div>`
    }
    else if (action === 'pay' && order) {
      pay(order, target.dataset.method, target.dataset.outcome, now())
      await save()
      window.dispatchEvent(new CustomEvent('pb-test:payment-updated', { detail: structuredClone(order) }))
      go(orderPath(order))
    }
    else if (action === 'payment' && order) go(`${orderPath(order)}/payment`)
    else if (action === 'receipt' && order) go(orderPath(order))
    else if (action === 'history') go('/test/orders')
    else if (action === 'export' && order) download(order, `${order.orderId}.json`)
    else if (action === 'export-all') download(state.orders, 'pb-test-orders.json')
    else if (action === 'json' && order)
      showModal(`<div class="dialog-content"><h2>訂單資料</h2><pre data-testid="order-json">${escape(JSON.stringify(order, null, 2))}</pre></div>`)
    else if (action === 'new') {
      state.checkoutKey = crypto.randomUUID()
      state.invoice = emptyInvoice()
      state.note = ''
      state.draftStarted = false
      await save()
      go(`${basePath}/menu/select-table`)
    }
    else if (action === 'drift') {
      closeModal()
      document.querySelectorAll('#app button, #app input, .menu-card').forEach(element => {
        element.classList.add(`render-${crypto.randomUUID().slice(0, 8)}`)
        element.dataset.renderId = crypto.randomUUID()
      })
      notify('已擾動外觀識別；固定 ID、name、data-testid 不變。')
    }
    else if (action === 'reset-confirm')
      showModal(`<div class="dialog-content"><h2>重設測試資料？</h2><p>會清除此瀏覽器的購物車、桌號、發票草稿與 ${state.orders.length} 筆模擬訂單。可先匯出保留。</p><div class="actions">${button('先匯出', 'export-all')}${button('確認重設', 'reset', 'class="primary"')}${button('取消', 'close')}</div></div>`)
    else if (action === 'reset') {
      state = fresh()
      // This explicit test-data reset also retires this simulator's unknown-write marker.
      localStorage.removeItem(`webnavior:pb:cart-pending:${basePath}/`)
      storageAvailable = true
      await save()
      document.querySelector('#storage-warning').hidden = storageAvailable
      go(`${basePath}/menu/select-table`)
    }
  }
  catch (error) {
    notify(error.message)
  }
})

document.querySelector('#open-tools').addEventListener('click', tools)
document.querySelector('#history').addEventListener('click', () => go('/test/orders'))
document.querySelector('.brand').addEventListener('click', (event) => { event.preventDefault(); go(`${basePath}/menu/select-table`) })
window.addEventListener('popstate', () => { closeModal(); render() })

/** Read-only automation bridge. Snapshots include only this tab's test state. */
Object.defineProperty(window, 'pbTest', { value: Object.freeze({
  version: revision,
  getState: () => structuredClone(state),
  getOrders: () => structuredClone(state.orders),
  getCatalog: () => structuredClone(products),
}), writable: false })

const initial = await fetch('/__lab/state').then(response => response.json())
sessionRevision = initial.revision
if (initial.state)
  state = initial.state
state.tables = tables
state.cart.forEach((line, index) => { line.vendorLineId ??= index + 1 })
if (!initial.state)
  await save()
const registry = document.createElement('script')
registry.type = 'application/json'
registry.textContent = `const Ziggy=${JSON.stringify(routeRegistry(location.origin))};`
document.head.append(registry)

if (location.pathname === '/')
  history.replaceState({}, '', `${basePath}/menu/select-table`)
render()
