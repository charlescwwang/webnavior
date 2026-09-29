import { describe, expect, it } from 'vitest'
import { effectScope } from 'vue'

import { useKioskConversationProgress } from './useKioskConversationProgress'

describe('useKioskConversationProgress', () => {
  it('only renders verified work for the active conversation turn', () => {
    const scope = effectScope()
    const progress = scope.run(() => useKioskConversationProgress())
    if (!progress)
      throw new Error('Expected progress state to initialize.')

    progress.start(2, '正在理解您的需求…')
    expect(progress.progress.value).toMatchObject({ phase: 'understanding', message: '正在理解您的需求…', turnId: 2 })

    progress.selectTool(2, 'menu_recommend')
    expect(progress.progress.value).toMatchObject({ phase: 'finding-menu', message: '幫您找找適合的餐點。' })
    progress.extendWait(2)
    expect(progress.progress.value).toMatchObject({ phase: 'finding-menu', message: '我還在確認目前菜單。' })

    progress.start(3)
    progress.finish(2)
    expect(progress.progress.value).toMatchObject({ phase: 'understanding', turnId: 3 })

    progress.selectTool(3, 'cart_add_item', '正在將餐點加入購物車…')
    expect(progress.progress.value).toMatchObject({ phase: 'applying-action', message: '正在將餐點加入購物車…' })

    progress.finish(3)
    expect(progress.progress.value).toBeUndefined()
    scope.stop()
  })
})
