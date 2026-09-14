import { describe, expect, it } from 'vitest'

import { describeWebnaviorKioskToolActivity, parseWebnaviorKioskActivityManifest, webnaviorKioskActivityManifestUrl } from './webnaviorKioskActivity'

describe('webnavior kiosk activity manifest', () => {
  it('uses an approved tool label and falls back when a new tool has no entry', () => {
    const manifest = parseWebnaviorKioskActivityManifest({
      tools: {
        cart_add_item: {
          running: '正在將餐點加入清單…',
          success: '餐點已加入清單。',
        },
      },
      version: 1,
    })

    expect(describeWebnaviorKioskToolActivity(manifest, 'cart_add_item', 'executing')).toBe('正在將餐點加入清單…')
    expect(describeWebnaviorKioskToolActivity(manifest, 'new_menu_tool', 'executing')).toBe('正在處理餐點資料…')
  })

  it('discards malformed entries without rejecting valid tools in the same manifest', () => {
    const manifest = parseWebnaviorKioskActivityManifest({
      tools: {
        cart_add_item: { running: '正在將餐點加入清單…' },
        broken: { success: '缺少 running 文案' },
      },
      version: 1,
    })

    expect(manifest?.tools).toEqual({ cart_add_item: { running: '正在將餐點加入清單…' } })
  })

  it('only resolves the manifest on the approved service origin', () => {
    expect(webnaviorKioskActivityManifestUrl('https://menu.example/order?preview=1'))
      .toBe('https://menu.example/.well-known/webnavior-kiosk-activity.json')
  })
})
