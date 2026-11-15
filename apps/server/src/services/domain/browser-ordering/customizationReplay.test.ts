import { readFile } from 'node:fs/promises'

import { orderingTools } from '@proj-airi/stage-shared/ordering-tools'
import { pbProductName } from '@proj-airi/stage-shared/pb-menu-presentation'
import { describe, expect, it } from 'vitest'

const mainUrl = process.env.PB_CUSTOMIZATION_MAIN_URL
const jevUrl = process.env.PB_CUSTOMIZATION_JEV_URL
const name = '周氏水餃(最低8顆)'
const cart = [
  { name, quantity: 1, configuration: '每份10顆', options: [{ name: '水餃', quantity: 2 }], note: '不要蔥' },
  { name, quantity: 2, configuration: '每份10顆', options: [{ name: '水餃', quantity: 2 }], note: '不要蔥' },
]
const cases = [
  { id: 'base', text: '我要周氏水餃一份', tool: 'add_items_to_cart' },
  { id: 'pieces', text: '我要周氏水餃每份十顆，兩份', tool: 'add_items_to_cart' },
  { id: 'copy', text: '再一份一樣的水餃', tool: 'add_items_to_cart' },
  { id: 'quantity', text: '水餃總共只要兩份，其他都一樣', tool: 'set_cart_item_quantity' },
  { id: 'customize', text: '其中一份水餃改成十二顆，其他都照舊', tool: 'replace_item_in_cart' },
  { id: 'replace', text: '其中兩份水餃換成炸雞腿便當，不要帶原本的備註', tool: 'replace_item_in_cart' },
] as const

// Fixed synthetic states only: no database, customer recordings or credentials.
describe.skipIf(!mainUrl)('live PB customization tool selection', () => {
  it.each(cases)('$id', async (test) => {
    const skills = await Promise.all(['order', 'cart'].map(skill => readFile(new URL(`./skills/${skill}/SKILL.md`, import.meta.url), 'utf8')))
    const response = await fetch(new URL('chat/completions', `${mainUrl!.replace(/\/+$/, '')}/`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ model: process.env.PB_CUSTOMIZATION_MAIN_MODEL ?? 'qwen36', temperature: 0, max_tokens: 800, chat_template_kwargs: { enable_thinking: false }, messages: [
        { role: 'system', content: `你是點餐助手，依當前原句選一個正確操作工具。已提供最新資料，不需額外讀取。${skills.join('\n')}\n正式商品名稱：${name}、炸雞腿便當。水餃基本8顆64元，加量水餃每顆8元，群組加量，每份最多加100顆。雞腿便當130元、無加料。購物車：${JSON.stringify(test.id === 'base' || test.id === 'pieces' ? [] : cart)}` },
        { role: 'user', content: test.text },
      ], tools: ['add_items_to_cart', 'set_cart_item_quantity', 'replace_item_in_cart', 'ask_customer_question'].map(key => ({ type: 'function', function: { name: key, description: orderingTools[key as keyof typeof orderingTools].description, parameters: orderingTools[key as keyof typeof orderingTools].parameters } })), tool_choice: 'required' }),
    })
    expect(response.ok).toBe(true)
    const result = await response.json() as { choices: { message: { tool_calls?: { function: { name: string, arguments: string } }[] } }[] }
    const call = result.choices[0].message.tool_calls?.[0]?.function
    console.info(JSON.stringify({ case: test.id, model: 'main', call }))
    expect(call?.name).toBe(test.tool)
    const input = JSON.parse(call!.arguments)
    if (test.id === 'base' || test.id === 'pieces') {
      expect(pbProductName(input.items[0].name)).toBe(pbProductName(name))
      expect(input.items[0].quantity).toBe(test.id === 'base' ? 1 : 2)
      expect(input.items[0].piecesPerServing ?? 8).toBe(test.id === 'base' ? 8 : 10)
    }
    if (test.id === 'copy') {
      expect(input.items[0].quantity).toBe(1)
      expect(input.items[0].copyFrom?.name).toBe(name)
    }
    if (test.id === 'quantity')
      expect(input.quantity).toBe(2)
    if (test.id === 'customize') {
      expect(input.replaceQuantity).toBe(1)
      expect(input.replacement.piecesPerServing).toBe(12)
      expect(input.replacement.note ?? '不要蔥').toBe('不要蔥')
      expect(input.replacement.options ?? []).toEqual([])
    }
    if (test.id === 'replace') {
      expect(input.replaceQuantity).toBe(2)
      expect(input.replacement.name).toBe('炸雞腿便當')
      expect(input.replacement.note ?? '').toBe('')
    }
  }, 65_000)
})

describe.skipIf(!jevUrl)('live PB dumpling Jev candidate', () => {
  it.each(['我要水餃十顆兩份', '水餃兩份每份十二顆'])('selects the compiled purchase for %s', async (text) => {
    const response = await fetch(new URL('v1/systemone', `${jevUrl!.replace(/\/+$/, '')}/`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: JSON.stringify({ phase: 'ordering', customerUtterance: text }), questions: { route: { type: 'choice', instructions: '判斷顧客現在的完整需求，選擇對應選項。', criteria: { add: '顧客現在要買水餃，完整指定餐點份數與每份顆數。', information: '只問資料或價格，沒有購買。', main: '有其他需求或無法確定。' } } } }), signal: AbortSignal.timeout(30_000) })
    expect(response.ok).toBe(true)
    const result = await response.json() as { answers: { route: { choice: string, confidence: number } } }
    console.info(JSON.stringify({ text, jev: result.answers.route }))
    expect(result.answers.route.choice).toBe('add')
    expect(result.answers.route.confidence).toBeGreaterThanOrEqual(0.6)
  }, 35_000)
})

// Fixed synthetic replay of the reported alias; no merchant or customer data.
