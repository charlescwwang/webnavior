import { describe, expect, it } from 'vitest'

import { scrollViewport } from '../../../order-menu/src/menuScroll'

describe('native viewport navigation', () => {
  it('moves one page, reports boundaries, and does not wait for a boundary scrollend', () => {
    const owner = document.createElement('div')
    owner.style.cssText = 'height:200px;overflow:auto;scroll-behavior:smooth'
    const content = document.createElement('div')
    content.style.height = '600px'
    owner.append(content)
    document.body.append(owner)
    try {
      expect(scrollViewport(owner, 'UP')).toEqual({ status: 'BOUNDARY', position: 0 })
      expect(scrollViewport(owner, 'DOWN')).toEqual({ status: 'MOVED', position: 200 })
      expect(scrollViewport(owner, 'DOWN')).toEqual({ status: 'MOVED', position: 400 })
      expect(scrollViewport(owner, 'DOWN')).toEqual({ status: 'BOUNDARY', position: 400 })
      expect(scrollViewport(owner, 'UP')).toEqual({ status: 'MOVED', position: 200 })
      expect(scrollViewport(null, 'DOWN')).toEqual({ status: 'UNAVAILABLE', position: 0 })
      owner.hidden = true
      expect(scrollViewport(owner, 'DOWN').status).toBe('UNAVAILABLE')
    }
    finally {
      owner.remove()
    }
  })
})
