import process from 'node:process'

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { errorMessageFrom } from '@moeru/std'
import { desktopServiceRequestSchema, desktopSurfaceActivity, desktopSurfaceNavigation, desktopSurfaceRequestSchema, invokeDesktopService, updateDesktopSurface } from '@proj-airi/stage-shared/kiosk-desktop'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { parse } from 'valibot'

import { isHostClipboardWrite, isHostMediaRequest, isHostPage, parsePageUrl } from './policy'
import { readPortableSettings } from './portableSettings'
import { ServiceSurface } from './surface'
import { TextConsoleWindow } from './textConsole'

async function start() {
  app.setName('Webnavior Kiosk')
  let portableSettings: Awaited<ReturnType<typeof readPortableSettings>> | undefined
  if (app.isPackaged) {
    try {
      portableSettings = await readPortableSettings(resolve(dirname(process.execPath), 'kiosk.settings.json'))
      // Keep existing Windows device identities and merchant sessions when replacing the app folder.
      if (process.platform === 'win32') {
        if (!process.env.LOCALAPPDATA)
          throw new Error('Windows LOCALAPPDATA is unavailable.')
        app.setPath('userData', resolve(process.env.LOCALAPPDATA, 'Webnavior', 'Kiosk-Pilot'))
      }
      if (portableSettings.diagnosticPort) {
        app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
        app.commandLine.appendSwitch('remote-debugging-port', String(portableSettings.diagnosticPort))
      }
    }
    catch (error) {
      dialog.showErrorBox('Cannot start Webnavior Kiosk', `Check kiosk.settings.json next to the executable.\n\n${errorMessageFrom(error) ?? 'Invalid portable settings.'}`)
      app.exit(1)
      throw error
    }
  }
  else if (process.env.KIOSK_DESKTOP_USER_DATA) {
    app.setPath('userData', process.env.KIOSK_DESKTOP_USER_DATA)
  }

  // The alpha runtime is allowed only for an explicit local pilot, never an implicit production upgrade.
  if (process.versions.node !== '24.22.1')
    throw new Error('This pilot requires the inspected Electron runtime embedding Node 24.22.1.')
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  await app.whenReady()
  const entry = parsePageUrl(portableSettings?.kioskUrl ?? process.env.KIOSK_DESKTOP_URL ?? 'http://localhost:5169/kiosk/')
  if (!entry.pathname.endsWith('/'))
    throw new Error('KIOSK_DESKTOP_URL must name the Kiosk base directory, ending with /.')
  const window = new BrowserWindow({
    width: 1080,
    height: 1920,
    minWidth: 800,
    minHeight: 600,
    kiosk: portableSettings ? !portableSettings.windowed : process.env.KIOSK_DESKTOP_WINDOWED !== '1',
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolve(import.meta.dirname, '../preload/index.cjs'),
      partition: 'persist:kiosk-host',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const textConsole = new TextConsoleWindow(window, entry)
  // Check and request callbacks share one policy. OS consent and the Kiosk's
  // device/profile controls still decide whether capture can actually start.
  const hostSession = window.webContents.session
  hostSession.setPermissionCheckHandler((contents, permission, origin, details) =>
    (contents === window.webContents && isHostMediaRequest(contents.getURL(), entry, permission, origin, details))
    || ((contents === window.webContents || textConsole.owns(contents)) && isHostClipboardWrite(contents!.getURL(), entry, permission, origin, details, textConsole.owns(contents))))
  hostSession.setPermissionRequestHandler((contents, permission, reply, details) =>
    reply((contents === window.webContents && isHostMediaRequest(contents.getURL(), entry, permission, undefined, details))
      || ((contents === window.webContents || textConsole.owns(contents)) && isHostClipboardWrite(contents.getURL(), entry, permission, undefined, details, textConsole.owns(contents)))))
  window.webContents.setZoomFactor(1)
  window.webContents.on('before-input-event', (event, input) => {
    // The renderer reports CSS pixels for native DIP placement; keep host zoom at one.
    if ((input.control || input.meta) && ['+', '=', '-', '0'].includes(input.key))
      event.preventDefault()
  })
  const transport = createContext(ipcMain, window, { onlySameWindow: true, messageEventName: 'airi-kiosk-desktop', pushEventName: 'airi-kiosk-desktop-push', errorEventName: 'airi-kiosk-desktop-error' })
  const surface = new ServiceSurface(window, activity => transport.context.emit(desktopSurfaceActivity, activity), await readFile(resolve(import.meta.dirname, '../service/pb.js'), 'utf8'), navigation => transport.context.emit(desktopSurfaceNavigation, navigation))
  defineInvokeHandler(transport.context, updateDesktopSurface, (request, options) => {
    const event = options?.raw?.ipcMainEvent
    // onlySameWindow filters replies, not inbound handler admission. Check the actual sender/frame.
    if (event?.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isHostPage(event.senderFrame.url, entry))
      throw new Error('Desktop controls belong only to the trusted Kiosk main frame.')
    return surface.update(parse(desktopSurfaceRequestSchema, request))
  })
  defineInvokeHandler(transport.context, invokeDesktopService, (request, options) => {
    const event = options?.raw?.ipcMainEvent
    if (event?.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isHostPage(event.senderFrame.url, entry))
      throw new Error('Native service controls belong only to the trusted Kiosk frame.')
    return surface.invoke(parse(desktopServiceRequestSchema, request))
  })
  window.webContents.on('will-navigate', (event) => {
    if (!isHostPage(event.url, entry))
      event.preventDefault()
  })
  window.webContents.on('will-redirect', (event) => {
    if (!isHostPage(event.url, entry))
      event.preventDefault()
  })
  window.webContents.on('did-start-navigation', (event) => {
    if (event.isMainFrame && !event.isSameDocument)
      surface.resetHost()
  })
  window.webContents.on('did-navigate', () => {
    // Old pagehide cleanup can arrive after navigation starts with the retiring
    // preload's larger counter. Commit is the boundary before the new UI mounts.
    surface.resetHost()
  })
  window.on('close', () => {
    hostSession.setPermissionCheckHandler(() => false)
    hostSession.setPermissionRequestHandler((_contents, _permission, reply) => reply(false))
    transport.dispose()
    textConsole.dispose()
    surface.dispose()
  })
  app.on('second-instance', () => {
    window.restore()
    window.focus()
  })
  await window.loadURL(entry.href)
  // Visual zoom belongs to the loaded main frame, not the transient initial about:blank frame.
  await window.webContents.setVisualZoomLevelLimits(1, 1)
}

start().catch((error) => {
  console.error(errorMessageFrom(error) ?? 'Kiosk desktop startup failed.')
  app.quit()
})

app.on('window-all-closed', () => app.quit())
