import type { CatalogSnapshot } from '../../order-menu-server/src/domain/contracts'

import { describe, expect, it } from 'vitest'

import { createPosSimulator } from '../../order-menu-server/src/simulator'
import { filterIngredients } from './domain/composition'
import { menu } from './domain/order-machine'
import { createMenuToolRuntime } from './webmcp'

describe('composition-grounded menu filtering', () => {
  // Report: this chat, 2026-10-14 — category 「麵類」 silently returned no dishes.
  it.each(['menu_get', 'menu_recommend'] as const)('rejects an invented category instead of presenting an empty menu: %s', async (name) => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    let presentations = 0
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: () => presentations++ })
    await expect(runtime.invokeForAgent(name, { category: '麵類', display: true })).rejects.toThrow('UNKNOWN_CATEGORY')
    expect(presentations).toBe(0)
    expect(await runtime.invokeForAgent(name, { category: '麵食' })).toMatchObject({ items: [{ name: '紅燒牛肉麵' }] })
    const definition = runtime.toolDefinitions.find(tool => tool.name === name)!
    expect(definition.inputSchema.properties).toMatchObject({ category: { enum: ['便當', '麵食', '點心'] } })
    runtime.setMenu(catalog.items.filter(item => item.category === '點心'))
    expect(runtime.toolDefinitions.find(tool => tool.name === name)!.inputSchema.properties).toMatchObject({ category: { enum: ['點心'] } })
  })
  it('refuses Agent takeover while an admitted customer operation is still settling', async () => {
    let settle!: () => void
    const runtime = createMenuToolRuntime({ menu, onAction: () => new Promise<void>(resolve => settle = resolve), onCartChange: () => {}, onMenuSelection: () => {} })
    const snapshot = await runtime.invoke('kiosk_interaction_state') as { menuRevision: number }
    const manual = runtime.invokeManual('menu_select_item', { itemId: menu[0]!.id })
    await expect(runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'agent', expectedMenuRevision: snapshot.menuRevision, constraints: {} })).rejects.toThrow('MANUAL_CONTROL')
    settle()
    await manual
    await expect(runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'agent', expectedMenuRevision: snapshot.menuRevision, constraints: {} })).resolves.toEqual({ ok: true })
  })
  // Report: this chat, 2026-10-14 — manual edits race an active Agent task.
  it('keeps manual operations locked until the matching task ends', async () => {
    const ownership: boolean[] = []
    const runtime = createMenuToolRuntime({ menu, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onAgentControlChange: locked => ownership.push(locked) })
    const snapshot = await runtime.invoke('kiosk_interaction_state') as { menuRevision: number }
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'new', expectedMenuRevision: snapshot.menuRevision, constraints: {} })
    await expect(runtime.invokeManual('cart_set_line_quantity', { lineId: 'line', quantity: 2 })).rejects.toThrow('AGENT_CONTROL')
    await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'old' })
    expect(ownership).toEqual([true])
    await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'new' })
    expect(ownership).toEqual([true, false])
    await expect(runtime.invokeManual('cart_get')).resolves.toBeDefined()
  })
  it('does not infer shrimp absence from a broad seafood fact and only offers verified removals', () => {
    const broad = { ...menu[0]!, composition: { ingredients: ['seafood'], complete: true, source: 'merchant' as const, revision: '1', removals: [] } }
    expect(filterIngredients([broad], { excludeIngredients: ['shrimp'], includeIngredients: [] })).toMatchObject({ matches: [], unknown: [broad] })
    const specific = { ...menu[0]!, optionGroups: [{ id: 'seafood', label: '海鮮', required: false, values: [{ id: 'none', label: '不加蝦', priceDelta: 0 }] }], composition: { ingredients: ['shrimp', 'fish'], complete: true, source: 'merchant' as const, revision: '1', removals: [{ ingredients: ['shrimp'], groupId: 'seafood', valueId: 'none' }] } }
    expect(filterIngredients([specific], { excludeIngredients: ['seafood'], includeIngredients: [] })).toMatchObject({ matches: [], customizable: [] })
    expect(filterIngredients([specific], { excludeIngredients: ['shrimp'], includeIngredients: ['seafood'] })).toMatchObject({ matches: [], customizable: [{ requiredOptions: [{ groupId: 'seafood', valueId: 'none' }] }] })
  })
  it('distinguishes shrimp from fish while retaining seafood search and exclusion', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    expect(catalog.items.find(item => item.id === 'signature-shrimp-roll-bento')?.composition.ingredients).toContain('shrimp')
    expect(catalog.items.find(item => item.id === 'thai-sour-spicy-fish-bento')?.composition.ingredients).toContain('fish')
    expect(await runtime.invoke('menu_get', { includeIngredients: ['shrimp'] })).toMatchObject({ items: [{ id: 'signature-shrimp-roll-bento' }] })
    expect(await runtime.invoke('menu_get', { includeIngredients: ['fish'] })).toMatchObject({ items: [{ id: 'thai-sour-spicy-fish-bento' }] })
    expect(await runtime.invoke('menu_get', { includeIngredients: ['seafood'] })).toMatchObject({ items: [{ id: 'signature-shrimp-roll-bento' }, { id: 'thai-sour-spicy-fish-bento' }] })
    const excluded = await runtime.invoke('menu_get', { excludeIngredients: ['seafood'] }) as { items: CatalogSnapshot['items'] }
    expect(excluded.items).toHaveLength(5)
    expect(excluded.items.some(item => item.composition.ingredients.some(id => id === 'shrimp' || id === 'fish'))).toBe(false)
  })
  it('provides unavailable condition topics without treating a mention as an intent', async () => {
    const runtime = createMenuToolRuntime({ menu: [menu[0]!], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '低鈉又不要豬肉' })).toMatchObject({ unavailableConditionReferences: [{ id: 'sodium' }], ingredientReferences: [{ id: 'pork' }], constraints: { exclude: [], include: [] } })
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '看看糖醋排骨' })).toMatchObject({ unavailableConditionReferences: [{ id: 'sugar' }], constraints: { exclude: [], include: [] } })
    expect(await runtime.invoke('kiosk_fast_path_context', { transcript: '水餃' })).toMatchObject({ unavailableConditionReferences: [] })
  })
  it('keeps known task constraints at the Agent tool boundary and isolates cleanup by task ID', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const snapshot = await runtime.invoke('kiosk_interaction_state') as { menuRevision: number }
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'task-1', expectedMenuRevision: snapshot.menuRevision, constraints: { excludeIngredients: ['pork'] } })
    const filtered = await runtime.invokeForAgent('menu_get') as { items: CatalogSnapshot['items'] }
    expect(filtered.items.length).toBeGreaterThan(0)
    for (const item of filtered.items)
      expect(item.composition.ingredients).not.toContain('pork')
    await expect(runtime.invokeForAgent('menu_get', { includeIngredients: ['pork'] })).rejects.toThrow('Task constraint conflict')
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'task-2', expectedMenuRevision: snapshot.menuRevision, constraints: { excludeIngredients: ['pork'] } })
    await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'task-1' })
    expect(await runtime.invokeForAgent('menu_recommend')).toMatchObject({ appliedFilters: { excludeIngredients: ['pork'] } })
    await runtime.invoke('kiosk_agent_task', { action: 'END', taskId: 'task-2' })
    expect(await runtime.invokeForAgent('menu_get', { display: false })).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ id: 'dumplings' })]) })
  })
  it('rejects task conditions after a catalog change instead of quietly removing the filter', async () => {
    const runtime = createMenuToolRuntime({ menu: [menu[0]!], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const snapshot = await runtime.invoke('kiosk_interaction_state') as { menuRevision: number }
    await runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'task-1', expectedMenuRevision: snapshot.menuRevision, constraints: { excludeIngredients: ['pork'] } })
    runtime.setMenu([menu[0]!], 'next-catalog')
    await expect(runtime.invokeForAgent('menu_get')).rejects.toThrow('STALE_PLAN')
    await expect(runtime.invoke('kiosk_agent_task', { action: 'BEGIN', taskId: 'task-2', expectedMenuRevision: snapshot.menuRevision, constraints: { excludeIngredients: ['pork'] } })).rejects.toThrow('STALE_PLAN')
    await expect(runtime.invokeForAgent('kiosk_agent_task', { action: 'END', taskId: 'task-1' })).rejects.toThrow('unavailable to the Agent')
  })
  it('enforces dietary requirements even without pre-expanded ingredient exclusions', () => {
    const result = filterIngredients([
      { ...menu[0]!, composition: { ingredients: ['pork'], complete: true, source: 'merchant', revision: '1', removals: [] } },
    ], { excludeIngredients: [], includeIngredients: [], dietary: 'vegetarian' })
    expect(result.matches).toHaveLength(0)
    expect(result.unknown).toHaveLength(0)
  })
  it('keeps vegetarian requirements and returns no matches instead of all seven POS dishes', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const presentations: unknown[] = []
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {}, onRecommendationsChange: value => presentations.push(value) })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '有素食嗎？' })
    expect(context).toMatchObject({ ingredientReferences: [], dietaryReferences: [{ id: 'vegetarian' }] })
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', ingredientFilters: { excludeIngredients: ['pork', 'beef', 'chicken', 'seafood'], dietary: 'vegetarian' } })
    expect(result).toMatchObject({ items: [], availability: 'NONE' })
    expect(result).not.toHaveProperty('continuation')
    expect(presentations.at(-1)).toMatchObject({ itemIds: [] })
  })

  it('requires a positive POS vegetarian label and preserves it across alternative batches', async () => {
    const runtime = createMenuToolRuntime({ menu: [
      { ...menu[0]!, id: 'known', name: '蔬菜飯', composition: { ingredients: ['rice', 'vegetables'], complete: true, source: 'merchant', revision: '1', dietaryLabels: ['vegetarian'], removals: [] } },
      { ...menu[0]!, id: 'unlabelled', name: '成分未確認餐點', composition: { ingredients: ['rice'], complete: true, source: 'merchant', revision: '1', removals: [] } },
    ], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    expect(await runtime.invoke('menu_recommend', { dietary: 'vegetarian' })).toMatchObject({ items: [{ id: 'known' }], unknownCompositionItems: [{ id: 'unlabelled' }], appliedFilters: { dietary: 'vegetarian' } })
    expect(await runtime.invoke('menu_recommend', { more: true })).toMatchObject({ items: [], availability: 'UNKNOWN', appliedFilters: { dietary: 'vegetarian' } })
    await expect(runtime.invoke('menu_get', { dietary: 'made-up' })).rejects.toThrow('Unsupported')
  })

  it('distinguishes unknown composition from confirmed absence for search and recommendation', async () => {
    const runtime = createMenuToolRuntime({ menu: [{ ...menu[0]!, composition: { ingredients: [], complete: false, source: 'merchant', revision: 'unknown', removals: [] } }], onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    for (const name of ['menu_get', 'menu_recommend'] as const) {
      const result = await runtime.invoke(name, { excludeIngredients: ['pork'] })
      expect(result).toMatchObject({ items: [], availability: 'UNKNOWN', customerMessage: expect.stringContaining('無法確認') })
      expect(result).toMatchObject({ customerMessage: expect.not.stringContaining('目前沒有符合') })
    }
  })
  it('filters multiple real menu matches without treating a search as an ambiguous mutation target', async () => {
    const runtime = createMenuToolRuntime({
      menu: [
        { ...menu[0]!, id: 'pork-dumplings', name: '豬肉水餃', aliases: ['水餃'], composition: { ingredients: ['pork', 'wheat'], complete: true, source: 'simulation', revision: '1', removals: [] } },
        { ...menu[0]!, id: 'chicken-dumplings', name: '雞肉水餃', aliases: ['水餃'], composition: { ingredients: ['chicken', 'wheat'], complete: true, source: 'simulation', revision: '1', removals: [] } },
      ],
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '找不要豬肉的水餃' })
    expect(await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', ingredientFilters: { excludeIngredients: ['pork'] } })).toMatchObject({ items: [{ id: 'chicken-dumplings' }] })
  })
  it('retains the exact ingredient constraints in the one-use recommendation continuation', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我不要豬肉的' })
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', ingredientFilters: { excludeIngredients: ['pork'] } }) as { continuation: { candidates: Array<{ id: string }> } }
    const continued = await runtime.invoke('kiosk_fast_path_continue', { candidateId: result.continuation.candidates[0]!.id })
    expect(continued).toMatchObject({ appliedFilters: { excludeIngredients: ['pork'] }, items: [{ id: 'spicy-chicken-bento' }, { id: 'thai-sour-spicy-fish-bento' }, { id: 'beef-noodle-soup' }] })
  })
  it('runs the seven-dish POS scenario through bounded slots and rejects stale or invented conditions', async () => {
    const catalog = await (await createPosSimulator().app.request('/v1/catalog')).json() as CatalogSnapshot
    const runtime = createMenuToolRuntime({ menu: catalog.items, onAction: () => {}, onCartChange: () => {}, onMenuSelection: () => {} })
    const context = await runtime.invoke('kiosk_fast_path_context', { transcript: '我不要豬肉的便當' })
    expect(context).toMatchObject({ ingredientReferences: [{ id: 'pork', label: '豬肉' }] })
    const result = await runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:search-menu', ingredientFilters: { excludeIngredients: ['pork'] } })
    expect(result).toMatchObject({ items: [{ id: 'spicy-chicken-bento' }, { id: 'thai-sour-spicy-fish-bento' }], decisionTrace: { operationPlan: { input: { category: '便當', excludeIngredients: ['pork'] } } } })
    expect(result).toMatchObject({ customerMessage: '排除豬肉：我找到：椒麻雞便當、泰式酸辣魚便當。' })
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我不要豬肉的' })
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:recommend', ingredientFilters: { excludeIngredients: ['egg'] } })).rejects.toThrow('unoffered')
    await runtime.invoke('kiosk_fast_path_context', { transcript: '我不要豬肉的' })
    runtime.setMenu(catalog.items.map(item => ({ ...item, composition: { ...item.composition, ingredients: [...item.composition.ingredients, ...(item.id === 'spicy-chicken-bento' ? ['pork'] : [])] } })), 'changed-recipe')
    await expect(runtime.invoke('kiosk_fast_path_execute', { candidateId: 'intent:recommend', ingredientFilters: { excludeIngredients: ['pork'] } })).rejects.toThrow('STALE_PLAN')
  })
  it('keeps customization separate from matches and does not add or edit food while searching', async () => {
    const runtime = createMenuToolRuntime({
      menu: [{ ...menu[0]!, id: 'egg-rice', name: '蛋飯', optionGroups: [{ id: 'egg', label: '蛋', required: false, values: [{ id: 'none', label: '不加蛋', priceDelta: 0 }] }], composition: { ingredients: ['rice', 'egg'], complete: true, source: 'simulation', revision: '1', removals: [{ ingredients: ['egg'], groupId: 'egg', valueId: 'none' }] } }],
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    expect(await runtime.invoke('menu_get', { excludeIngredients: ['egg'] })).toMatchObject({ items: [], customizable: [{ item: { id: 'egg-rice' }, requiredOptions: [{ groupId: 'egg', valueId: 'none' }] }] })
    expect(await runtime.invoke('cart_get')).toMatchObject({ cart: { itemCount: 0 } })
    expect(await runtime.invoke('menu_get', { excludeIngredients: ['egg'], includeIngredients: ['egg'] })).toMatchObject({ items: [], customizable: [] })
    await expect(runtime.invoke('menu_get', { excludeIngredients: ['made-up'] })).rejects.toThrow('Unsupported')
  })
  it('never interprets an incomplete or missing composition as ingredient absence', async () => {
    const runtime = createMenuToolRuntime({
      menu: [{ ...menu[0]!, id: 'unknown', composition: { ingredients: ['rice'], complete: false, source: 'merchant', revision: '1', removals: [] } }],
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    expect(await runtime.invoke('menu_get', { excludeIngredients: ['pork'] })).toMatchObject({ items: [], unknownCompositionItems: [{ id: 'unknown' }] })
  })
  it('uses the same intersection for recommendations and never loosens an empty result', async () => {
    const runtime = createMenuToolRuntime({
      menu: [
        { ...menu[0]!, id: 'chicken', composition: { ingredients: ['chicken', 'egg'], complete: true, source: 'simulation', revision: '1', removals: [] } },
        { ...menu[0]!, id: 'fish', composition: { ingredients: ['seafood'], complete: true, source: 'simulation', revision: '1', removals: [] } },
      ],
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    expect(await runtime.invoke('menu_recommend', { excludeIngredients: ['pork', 'egg'], limit: 3 })).toMatchObject({ items: [{ id: 'fish' }] })
    expect(await runtime.invoke('menu_recommend', { includeIngredients: ['chicken'], excludeIngredients: ['egg'] })).toMatchObject({ items: [] })
  })
  it('filters actual ingredients, without requiring absent-ingredient tags', async () => {
    const runtime = createMenuToolRuntime({
      menu: [
        { ...menu[0]!, id: 'chicken', name: '雞肉便當', composition: { ingredients: ['chicken', 'rice', 'vegetables'], complete: true, source: 'simulation', revision: '1', removals: [] } },
        { ...menu[0]!, id: 'pork', name: '豬肉便當', composition: { ingredients: ['pork', 'rice'], complete: true, source: 'simulation', revision: '1', removals: [] } },
      ],
      onAction: () => {},
      onCartChange: () => {},
      onMenuSelection: () => {},
    })
    const result = await runtime.invoke('menu_get', { excludeIngredients: ['pork'] })
    expect(result).toMatchObject({ items: [{ id: 'chicken' }], appliedFilters: { excludeIngredients: ['pork'] } })
  })
})
