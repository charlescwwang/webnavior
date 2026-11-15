import type { OrderingToolName } from '@proj-airi/stage-shared/ordering-tools'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { readFile, writeFile } from 'node:fs/promises'

import pg from 'pg'

import { errorMessageFrom } from '@moeru/std'
import { orderingTools } from '@proj-airi/stage-shared/ordering-tools'
import { array, nullable, number, object, optional, parse, string, unknown } from 'valibot'

import { buildResponsesRequest, translateResponsesResponse } from '../services/domain/llm-router/responses'
import { createEnvelopeCrypto } from '../utils/envelope-crypto'

// Fixed synthetic tool loop only. No browser, merchant HTTP, or configuration writes.
if (process.env.PB_CART_GOAL_REPLAY !== '1')
  throw new Error('Set PB_CART_GOAL_REPLAY=1 for the bounded synthetic experiment')
const config = JSON.parse(await readFile(new URL('../../../../pb-test.local/server.json', import.meta.url), 'utf8'))
const url = new URL(config.DATABASE_URL)
if (url.hostname !== '127.0.0.1' || url.port !== '15434' || url.pathname !== '/webnavior_pb_test')
  throw new Error('Only the isolated PB configuration is allowed')
const db = new pg.Client({ connectionString: url.href })
await db.connect()
let profile
const profileId = process.env.PB_CART_GOAL_PROFILE_ID
try {
  profile = profileId
    ? (await db.query(`SELECT * FROM webnavior_ai_provider_profiles WHERE id=$1 AND capability='chat' AND verified_at IS NOT NULL`, [profileId])).rows[0]
    : (await db.query(`SELECT p.* FROM webnavior_ai_provider_profiles p JOIN webnavior_ai_capability_selections s ON s.provider_profile_id=p.id WHERE s.capability='chat'`)).rows[0]
}
finally { await db.end() }
if (!profile || (!profileId && profile.model_id !== 'qwen36') || !['openai-compatible', 'openai-responses'].includes(profile.kind))
  throw new Error('Use the original qwen36 selection or explicitly name a verified chat profile')
const secret = profile.api_key_ciphertext ? createEnvelopeCrypto({ masterKey: Buffer.from(config.LLM_ROUTER_MASTER_KEY, 'base64') }).decryptKey(profile.api_key_ciphertext, { keyEntryId: 'default', modelName: `webnavior-ai:provider-profile:${profile.id}` }) : undefined
const chicken = '炸雞腿便當'
const pork = '炸排骨便當'
const cases = [
  { id: 'final-totals', text: `我要${pork}3份。${chicken}只要1份。`, pork: 3 },
  { id: 'explicit-operations', text: `${chicken}改成1份，另外新增${pork}3份。`, pork: 3 },
  { id: 'equal-exchange', text: `${chicken}其中2份換成${pork}。`, pork: 2 },
]
const allVariants = ['current', 'without-replace', 'clear-replace', 'goal-first', 'quantity-boundaries', 'skill-boundaries', 'combined-boundaries', 'preserve-boundaries', 'preserve-prefix'] as const
const variants = allVariants.filter(name => !process.env.PB_CART_GOAL_VARIANTS || process.env.PB_CART_GOAL_VARIANTS.split(',').includes(name))
if (!variants.length)
  throw new Error('No reviewed experimental variant selected')
const reportPath = process.env.PB_CART_GOAL_REPORT ?? '/tmp/pb-cart-goal-replay.json'
if (!/^\/tmp\/pb-cart-goal-[\w-]+\.json$/.test(reportPath))
  throw new Error('The report must use the private experiment namespace in /tmp')
const repeats = Number(process.env.PB_CART_GOAL_REPEATS ?? 3)
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5)
  throw new Error('Repetitions must be between 1 and 5')
const maxTokens = Number(process.env.PB_CART_GOAL_MAX_TOKENS ?? 1024)
if (!Number.isInteger(maxTokens) || maxTokens < 1024 || maxTokens > 4096)
  throw new Error('Output budget must be between 1024 and 4096 tokens, including native reasoning')
const reasoningEffort = process.env.PB_CART_GOAL_REASONING_EFFORT
if (reasoningEffort !== undefined && (profile.kind !== 'openai-responses' || reasoningEffort !== 'none'))
  throw new Error('This benchmark only supports an explicit native reasoning effort of none')
const names: OrderingToolName[] = ['list_menu_items', 'get_menu_item_details', 'search_menu_items', 'point_to_menu_items', 'open_menu_item_details', 'add_items_to_cart', 'ask_customer_question', 'cancel_item_selection', 'list_cart_items', 'open_cart', 'set_cart_item_quantity', 'remove_items_from_cart', 'replace_item_in_cart', 'return_to_menu', 'reply_to_customer']
const currentSkills = (await Promise.all(['common', 'order'].map(name => readFile(new URL(`../services/domain/browser-ordering/skills/${name}/SKILL.md`, import.meta.url), 'utf8')))).join('\n')
const report: { model: string, kind: string, connectionKind: string, maxTokens: number, reasoningEffort?: string, repeats: number, runs: Record<string, unknown>[] } = { model: profile.model_id, kind: 'synthetic-model-tool-loop-not-live-ui', connectionKind: profile.kind, maxTokens, ...(reasoningEffort ? { reasoningEffort } : {}), repeats, runs: [] }
function target(value: unknown): string {
  if (!value || typeof value !== 'object' || !('name' in value) || typeof value.name !== 'string' || ![chicken, pork].includes(value.name))
    throw new Error('Unknown synthetic cart target')
  return value.name
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 99)
    throw new Error('Invalid meal count')
  return value
}
try {
  for (let repetition = 0; repetition < repeats; repetition++) {
    for (const test of cases) {
      for (const variant of variants) {
        let cart: Record<string, number> = { [chicken]: 3, [pork]: 0 }
        const tools = names.filter(name => variant !== 'without-replace' || name !== 'replace_item_in_cart').map((name) => {
          const tool = structuredClone(orderingTools[name])
          let description: string = tool.description
          if (variant === 'clear-replace' && name === 'replace_item_in_cart') {
            const replacement = structuredClone(orderingTools.replace_item_in_cart)
            replacement.parameters.properties.replaceQuantity.description = '這一步從原餐拿掉且加入新餐的相同份數，不能當成新餐最後總份數。'
            return { type: 'function', function: { name, description: '將原餐的指定份數逐份換成新餐。換出幾份就換入幾份，不設定新餐最後總份數。顧客分別指定各餐最後份數時，需核對每一步結果；可搭配新增或設定份數完成，不假設訂單總份數必須不變。', parameters: replacement.parameters } }
          }
          if (variant === 'quantity-boundaries' || variant === 'combined-boundaries') {
            if (name === 'add_items_to_cart')
              description = '新增顧客要求額外購買的餐點，quantity是這次額外加入的份數。已存在的餐點說「只要幾份」「總共幾份」「改成幾份」是在指定最後總份數，使用set_cart_item_quantity，不在此新增。新餐點尚未在購物車時，按要求加入。'
            if (name === 'set_cart_item_quantity')
              description = '把購物車指定餐點設定為最後總份數，quantity填顧客希望最後保有的數量。「只要一份」「只留一份」「總共一份」「改成一份」都設為1，不是在現有數量之外再加1份；額外增加幾份使用add_items_to_cart。'
          }
          if (variant === 'preserve-boundaries') {
            if (name === 'add_items_to_cart')
              description += ' 已在購物車的餐點說「只要幾份」「總共幾份」「改成幾份」，是指定最後總份數，使用set_cart_item_quantity，不在此新增；同句另點新餐時，分別完成兩項需求。'
            if (name === 'set_cart_item_quantity')
              description += ' 「只要一份」也填1，表示最後保留一份，不是在目前份數之外再加一份。'
          }
          if (variant === 'preserve-prefix') {
            if (name === 'add_items_to_cart')
              description = `新增顧客要求額外購買的餐點，quantity是這次額外加入的份數。已存在的餐點說「只要幾份」「總共幾份」「改成幾份」是在指定最後總份數，使用set_cart_item_quantity，不在此新增。新餐點尚未在購物車時，按要求加入。${description}`
            if (name === 'set_cart_item_quantity')
              description = `把購物車指定餐點設定為最後總份數，quantity填顧客希望最後保有的數量。「只要一份」「只留一份」「總共一份」「改成一份」都設為1，不是在現有數量之外再加1份；額外增加幾份使用add_items_to_cart。${description}`
          }
          return { type: 'function', function: { name, description, parameters: tool.parameters } }
        })
        const state = () => ({ cart: Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([name, quantity]) => ({ name, quantity, unitPrice: 130 })), total: Object.values(cart).reduce((a, b) => a + b * 130, 0) })
        const skills = variant === 'skill-boundaries' || variant === 'combined-boundaries' || variant === 'preserve-boundaries' || variant === 'preserve-prefix' ? currentSkills.replace('資料完整且顧客明確要求購買時直接使用 add_items_to_cart', '資料完整且顧客明確要求新增餐點時直接使用 add_items_to_cart').replace('顧客明確購買且餐名、份數、必選配置完整，使用 add_items_to_cart。', '顧客明確新增餐點且餐名、份數、必選配置完整，使用 add_items_to_cart。既有餐點說只要、總共、改成幾份，是指定最後總份數，使用set_cart_item_quantity；同句新增另一道餐點時，分別完成兩項需求，不把既有餐點的最後總份數當成追加。') : currentSkills
        const messages: Record<string, unknown>[] = [
          { role: 'system', content: `你是點餐助手Navi。${skills}\n固定合成測試：完整菜單只有${chicken}、${pork}，每份130元，沒有客製選項，名稱唯一。最新狀態${JSON.stringify(state())}。資料完整，可直接操作。${variant === 'goal-first' ? '先確認每道餐點最後應有的總份數，再決定操作。各餐最後份數分別獨立，訂單總份數可以增加或減少。每一步後對照原句，全部完成才結束。' : ''}` },
          { role: 'user', content: test.text },
        ]
        const trace: unknown[] = []
        let error: string | undefined
        let finish = ''
        const started = performance.now()
        for (let round = 0; round < 5; round++) {
          const native = profile.kind === 'openai-responses'
          const request = { model: profile.model_id, temperature: 0, max_tokens: maxTokens, stream: false, chat_template_kwargs: { enable_thinking: profile.enable_thinking }, ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}), messages, tools, tool_choice: 'auto' }
          const raw = await fetch(`${profile.base_url.replace(/\/$/, '')}/${native ? 'responses' : 'chat/completions'}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret.toString()}` } : {}) }, signal: AbortSignal.timeout(60_000), body: JSON.stringify(native ? buildResponsesRequest(request, profile.model_id) : request) })
          const response = native ? await translateResponsesResponse(raw, false) : raw
          if (!response.ok) {
            error = `Provider HTTP ${response.status}`
            break
          }
          const body = parse(object({ usage: optional(object({ prompt_tokens: optional(number()), completion_tokens: optional(number()), completion_tokens_details: optional(object({ reasoning_tokens: optional(number()) })) })), choices: array(object({ finish_reason: optional(string()), message: object({ content: optional(nullable(string())), responses_output: optional(array(unknown())), tool_calls: optional(array(object({ id: string(), type: optional(string()), function: object({ name: string(), arguments: string() }) }))) }) })) }), await response.json())
          if (['length', 'content_filter'].includes(body.choices[0]?.finish_reason ?? '')) {
            error = `Incomplete model response: ${body.choices[0]!.finish_reason}`
            break
          }
          const message = body.choices?.[0]?.message
          if (!message) {
            error = 'Missing model response'
            break
          }
          const calls = message.tool_calls ?? []
          trace.push({ round, calls, content: message.content, usage: body.usage })
          // A requested setting alone is insufficient evidence for a non-reasoning comparison.
          if (reasoningEffort === 'none' && body.usage?.completion_tokens_details?.reasoning_tokens !== 0) {
            error = 'Provider did not confirm zero reasoning tokens'
            break
          }
          messages.push({ role: 'assistant', content: message.content ?? '', ...(calls.length ? { tool_calls: calls } : {}), ...(message.responses_output ? { responses_output: message.responses_output } : {}) })
          if (!calls.length) {
            finish = 'model-stopped'
            break
          }
          for (const call of calls) {
            let result: Record<string, unknown>
            try {
              if (!tools.some(tool => tool.function.name === call.function.name))
                throw new Error('Tool was not offered')
              const args = JSON.parse(call.function.arguments)
              const next = { ...cart }
              if (call.function.name === 'add_items_to_cart') {
                for (const item of args.items) {
                  if (item.options?.length || item.piecesPerServing || item.note || item.copyFrom)
                    throw new Error('Unsupported configuration')
                  next[target(item)] += count(item.quantity)
                }
              }
              else if (call.function.name === 'set_cart_item_quantity') {
                next[target(args.target)] = count(args.quantity)
              }
              else if (call.function.name === 'remove_items_from_cart') {
                for (const item of args.targets) next[target(item)] = 0
              }
              else if (call.function.name === 'replace_item_in_cart') {
                const from = target(args.target)
                const to = target(args.replacement)
                const quantity = count(args.replaceQuantity)
                if ('quantity' in args.replacement || quantity > next[from] || args.replacement.options?.length || args.replacement.note)
                  throw new Error('Invalid equal-count replacement')
                next[from] -= quantity
                next[to] += quantity
              }
              cart = next
              const write = ['add_items_to_cart', 'set_cart_item_quantity', 'remove_items_from_cart', 'replace_item_in_cart'].includes(call.function.name)
              result = { outcome: write ? 'action_completed' : 'information_ready', completionScope: 'tool-call', originalRequest: test.text, ...state(), products: [chicken, pork].map(name => ({ name, unitPrice: 130, options: [] })) }
              if (['reply_to_customer', 'ask_customer_question'].includes(call.function.name))
                finish = 'model-replied-or-asked'
            }
            catch (caught) {
              error = errorMessageFrom(caught) ?? 'Invalid tool operation'
              result = { outcome: 'proposal_needs_correction', effect: 'none', error }
            }
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
          }
          if (finish)
            break
        }
        const passed = !error && cart[chicken] === 1 && cart[pork] === test.pork
        const run = { repetition, case: test.id, text: test.text, variant, passed, cart, expected: { [chicken]: 1, [pork]: test.pork }, error, finish, durationMs: Math.round(performance.now() - started), trace }
        report.runs.push(run)
        await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 })
        console.info(JSON.stringify({ repetition, case: test.id, variant, passed, cart, error, durationMs: run.durationMs }))
      }
    }
  }
}
finally { secret?.fill(0) }
