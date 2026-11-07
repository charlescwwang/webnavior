// PROTOTYPE: validates native website hosting, not the Kiosk Agent integration.
const process = require('node:process')

const { app, BrowserWindow, WebContentsView } = require('electron')

const loginUrl = 'https://app.esgpb.com/order/login?store_hash=PRBMqkW&flow_type=pick_up'

// Pin this experiment to the inspected security release before any remote content loads.
if (process.versions.node !== '24.22.1')
  throw new Error('This prototype requires an Electron runtime embedding Node 24.22.1.')

// The launcher supplies a disposable profile, separate from AIRI and personal browsers.
if (!process.env.ESGPB_PROTOTYPE_PROFILE)
  throw new Error('Launch with node apps/stage-kiosk/scripts/runEsgpbElectronPrototype.mjs')
app.setPath('userData', process.env.ESGPB_PROTOTYPE_PROFILE)

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    title: 'ESGPB Electron PROTOTYPE',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  const website = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: 'persist:esgpb-prototype',
    },
  })
  window.contentView.addChildView(website)
  const resize = () => {
    const [width, height] = window.getContentSize()
    website.setBounds({ x: 300, y: 0, width: Math.max(1, width - 300), height })
  }
  window.on('resize', resize)
  resize()
  // Native child contents have their own lifecycle; closing the shell owns cleanup.
  window.on('closed', () => website.webContents.close())
  website.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  website.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== 'https://app.esgpb.com')
      event.preventDefault()
  })
  website.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
    <html lang="zh-Hant"><meta charset="utf-8"><title>ESGPB Electron PROTOTYPE</title>
    <body style="font:17px system-ui;margin:24px;width:250px;line-height:1.8;background:#f3f4f6">
    <h2>Electron 點餐驗證</h2><p>PROTOTYPE</p>
    <p>右側是獨立網站容器，直接連線 ESGPB。</p>
    <p>驗證：帳密登入、重載登入狀態、讀取菜單、操作購物車。</p>
    <p>尚未接入 Kiosk 語音或 LLM。不送出訂單。</p>
    </body></html>`)}`)
  await website.webContents.loadURL(loginUrl)
})

app.on('window-all-closed', () => app.quit())
