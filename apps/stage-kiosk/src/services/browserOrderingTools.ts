import type { OrderingToolName } from '@proj-airi/stage-shared/ordering-tools'
import type { createInteractiveServiceClient } from '@proj-airi/stage-ui/services/interactiveServiceClient'
import type { Tool } from '@xsai/shared-chat'

import { errorMessageFrom } from '@moeru/std'
import { customerQuestionTypeSchema, customerReplySchema, orderingNextActions, orderingTools } from '@proj-airi/stage-shared/ordering-tools'
import { pbInvoiceMethodSchema } from '@proj-airi/stage-shared/pb-checkout'
import { pbDumplingExtraCount, pbDumplingExtraName, pbProductName } from '@proj-airi/stage-shared/pb-menu-presentation'
import { resolveTableName } from '@proj-airi/stage-shared/table-names'
import { resolveSelection } from '@proj-airi/stage-ui/services/pbProduct'
import { rawTool } from '@xsai/tool'
import { array, integer, looseObject, maxLength, maxValue, minLength, minValue, number, optional, parse, picklist, pipe, safeParse, strictObject, string, ValiError } from 'valibot'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'
import { cartLineLabelSchema } from '../../../server/src/services/domain/browser-ordering/contracts'
import { askBrowserCustomerQuestion, browserRecommendationCriteria, cancelBrowserItemSelection, executeBrowserCartTool, executeBrowserCheckout, executeBrowserConfirmedAddition, executeBrowserQuantityQuestion, executeBrowserReply, filterBrowserRecommendations, readBrowserOrderingFacts, refreshMissingDishMenu, reviewCartAfterAdditions } from './browserCartTask'
import { orderFactsSchema } from './browserOrderDrafts'
import { recommendationCriteriaSchema } from './recommendationSession'

const text = pipe(string(), minLength(1), maxLength(200))
const quantity = pipe(number(), integer(), minValue(1), maxValue(99))
const optionSchema = strictObject({ group: text, name: text, quantity: pipe(number(), integer(), minValue(0), maxValue(100)) })
const mealFields = { name: text, variant: optional(text), options: optional(pipe(array(optionSchema), maxLength(100))), note: optional(pipe(string(), maxLength(200))), piecesPerServing: optional(pipe(number(), integer(), minValue(8), maxValue(108))) }
const orderingFactsSchema = looseObject({ ...orderFactsSchema.entries, cart: looseObject({ version: string(), lines: array(looseObject({ ...cartLineLabelSchema.entries, ref: string(), productRef: optional(string()), configuration: optional(string()), unitPrice: optional(number()) })) }) })
const targetSchema = strictObject({ name: text, configuration: optional(pipe(string(), maxLength(2000))), note: optional(pipe(string(), maxLength(200))) })
const mealSchema = strictObject({ ...mealFields, quantity, copyFrom: optional(targetSchema) })
const clientError = (message: string) => ({ ok: false, source: 'browser', status: 'rejected', effect: 'none', customerMessage: message })

// Only messages constructed at this domain boundary are customer-facing.
// Transport, schema and unexpected runtime exceptions remain diagnostic receipts.
class CustomerInputError extends Error {}

function clientFailure(error: unknown) {
  return {
    ...clientError(error instanceof CustomerInputError ? error.message : orderingMessages['zh-Hant'].toolInputRejected),
    explanation: errorMessageFrom(error),
    ...(error instanceof ValiError ? { code: 'INVALID_BROWSER_DATA' } : {}),
  }
}

/** Compiles customer-facing names and quantities into the existing verified PB executor. */
export function createBrowserOrderingTools(client: Pick<ReturnType<typeof createInteractiveServiceClient>, 'tools' | 'execute'>): Tool[] {
  const tool = (name: string) => {
    const found = client.tools.value.find(tool => tool.name === name)
    if (!found)
      throw new Error(`目前未提供此操作：${name}`)
    return found
  }
  const call = (name: string, input: Record<string, unknown>) => executeBrowserCartTool(client, tool(name), input)
  const read = async () => parse(orderingFactsSchema, await readBrowserOrderingFacts(client))
  type Facts = Awaited<ReturnType<typeof read>>
  // One label policy for reads, presentation and writes. Callers still require
  // a unique match before selecting a product; a shared alias cannot pick one.
  const matchingProducts = (products: Facts['products'], name: string) => products.filter(product => pbProductName(product.name) === pbProductName(name) || product.aliases?.includes(name))
  function resolveMeal(facts: Facts, meal: ReturnType<typeof parse<typeof mealSchema>>, inherited?: Facts['cart']['lines'][number]) {
    const products = matchingProducts(facts.products, meal.name)
    if (products.length !== 1)
      throw new CustomerInputError(`無法確定「${meal.name}」是哪道餐點，請先確認名稱。`)
    const product = products[0]
    const configurations = product.configurations.filter(configuration => !meal.variant || configuration.name === meal.variant)
    if (configurations.length !== 1)
      throw new CustomerInputError(`請先確認「${meal.name}」要哪種規格。`)
    const configuration = configurations[0]
    const source = meal.copyFrom ? targetRows(facts, meal.copyFrom)[0] : inherited
    if (source && (source.productRef !== product.ref || source.options === undefined || configuration.variantRef))
      throw new CustomerInputError('尚無法核對原餐的完整配置，請先確認規格與加料。')
    const choices = (source?.options ?? []).map((choice) => {
      const options = configuration.groups.flatMap(group => group.choices).filter(option => option.name === choice.name)
      if (options.length !== 1)
        throw new CustomerInputError(`尚無法唯一對應原餐的「${choice.name}」選項。`)
      return { ref: options[0].ref, quantity: choice.quantity }
    })
    const requested = meal.options ?? []
    if (new Set(requested.map(choice => JSON.stringify([choice.group, choice.name]))).size !== requested.length)
      throw new CustomerInputError('同一加料不能重複指定，請確認每份加量。')
    for (const choice of requested) {
      const groups = configuration.groups.filter(group => group.name === choice.group)
      const options = groups.length === 1 ? groups[0].choices.filter(option => option.name === choice.name) : []
      if (options.length !== 1)
        throw new CustomerInputError(`無法確定「${choice.group}／${choice.name}」的選項，請重新確認。`)
      const index = choices.findIndex(candidate => candidate.ref === options[0].ref)
      if (index >= 0)
        choices.splice(index, 1)
      if (choice.quantity)
        choices.push({ ref: options[0].ref, quantity: choice.quantity })
    }
    if (meal.piecesPerServing !== undefined) {
      const extra = pbDumplingExtraCount(product.name, meal.piecesPerServing)
      // The group heading is merchant-authored presentation. Bind the extra to
      // the unique observed dumpling choice, never a group title or guessed ID.
      const options = configuration.groups.flatMap(group => group.choices.filter(choice => choice.name === pbDumplingExtraName))
      if (options.length !== 1)
        throw new CustomerInputError('網站水餃加量選項已變更，請先確認。')
      const option = options[0]
      if (requested.some(choice => choice.name === pbDumplingExtraName && choice.quantity !== extra))
        throw new CustomerInputError('每份顆數與指定加量不一致，請重新確認。')
      const index = choices.findIndex(choice => choice.ref === option.ref)
      if (index >= 0)
        choices.splice(index, 1)
      if (extra)
        choices.push({ ref: option.ref, quantity: extra })
    }
    const selection = { version: configuration.version, variantRef: configuration.variantRef, choices }
    const note = meal.note ?? source?.note ?? ''
    const resolved = resolveSelection(configuration, selection, note)
    return { version: facts.cart.version, productRef: product.ref, quantity: meal.quantity, note, unitPrice: resolved.unitPrice, selection, ...(meal.copyFrom && source ? { copySourceRef: source.ref } : {}) }
  }
  function targetRows(facts: Facts, target: ReturnType<typeof parse<typeof targetSchema>>) {
    const products = matchingProducts(facts.products, target.name)
    const canonicalName = products.length === 1 ? products[0].name : target.name
    const rows = facts.cart.lines.filter(line => pbProductName(line.name) === pbProductName(canonicalName) && (target.configuration === undefined || (line.description ?? '') === target.configuration) && (target.note === undefined || line.note === target.note))
    if (!rows.length)
      throw new CustomerInputError(`購物車裡沒有找到「${target.name}」。`)
    const first = rows[0]
    if (rows.some(line => line.productRef !== first.productRef || line.configuration !== first.configuration || line.note !== first.note || line.unitPrice !== first.unitPrice))
      throw new CustomerInputError(`購物車有不同配置的「${target.name}」，請先確認要修改哪一項。`)
    return rows
  }
  function resolveTarget(facts: Facts, target: ReturnType<typeof parse<typeof targetSchema>>) {
    const rows = targetRows(facts, target)
    const first = rows[0]
    return { version: facts.cart.version, lineRef: first.ref, ...(rows.length > 1 ? { lineRefs: rows.map(row => row.ref) } : {}) }
  }
  function batchResult(results: unknown[]) {
    const last = parse(looseObject({}), results.at(-1))
    const receipts = results.map(result => parse(looseObject({ status: optional(string()), effectMessage: optional(string()), customerMessage: optional(string()) }), result))
    const completed = receipts.filter(receipt => receipt.status === 'verified')
    const failures = receipts.filter(receipt => receipt.status !== 'verified')
    if (!failures.some(receipt => receipt.reason === 'product-unavailable') && !completed.length)
      return { ...last, results }
    const messages = completed.map(receipt => receipt.effectMessage ?? receipt.customerMessage).filter(Boolean)
    const failureMessages = failures.map(receipt => receipt.customerMessage).filter(Boolean)
    // A later success must not turn a skipped item into a verified whole order.
    const outcome = failures.at(-1)
    return { ...last, ...outcome, ...(outcome && completed.length ? { effect: 'partial', partial: true } : {}), effectMessage: messages.join(' '), customerMessage: [...messages, ...failureMessages].join(' '), results }
  }
  async function executeOperation(name: OrderingToolName, input: unknown) {
    try {
      if (name === 'select_table' || name === 'start_ordering_at_table') {
        const { tableName } = name === 'select_table'
          ? parse(strictObject({ tableName: text }), input)
          : parse(strictObject({ tableName: optional(text) }), input)
        const raw = await readBrowserOrderingFacts(client)
        // Host has only offered a possible table. Preserve that question even
        // when Main repeats the compressed ASR code as its proposed tableName.
        if (raw && typeof raw === 'object' && 'pendingCustomerChoice' in raw && raw.pendingCustomerChoice)
          return raw
        // Menu/cart snapshots have no tableChoices. Return to the real table
        // page before resolving a new name; never parse them as table entries.
        const page = safeParse(looseObject({ page: string() }), raw)
        if (page.success && ['menu', 'cart', 'checkout'].includes(page.output.page))
          return call('browser_return_table', {})
        const entry = parse(looseObject({ tableChoices: array(string()), selectedTable: optional(string()) }), raw)
        const selected = resolveTableName(tableName ?? entry.selectedTable ?? '', entry.tableChoices)
        if (!selected)
          return clientError('請問您要選哪一桌？')
        return call(name === 'select_table' ? 'browser_table_select' : 'browser_start_ordering', { name: selected })
      }
      if (name === 'list_menu_items') {
        const { criteria } = parse(strictObject({ criteria: optional(recommendationCriteriaSchema) }), input)
        const facts = await read()
        const currentCriteria = browserRecommendationCriteria(criteria, facts.products)
        if (!currentCriteria.ok) {
          if (currentCriteria.reason === 'exclusion') {
            return { ...clientError(orderingMessages['zh-Hant'].recovery.lookup), code: 'INVALID_TOOL_ARGUMENTS', dataOnly: true, explanation: '顧客本句沒有拒絕餐點或忌口的語意依據，尚未更新推薦條件。excludedTerms 只代表不要的品項；「我要炸的」是正向需求，不能填 excludedTerms=[炸]。請移除錯誤排除，依原話搜尋炸、挑出炸雞腿便當及炸排骨便當，再以 information 呈現符合的菜單；不要列出不相關的全菜單，也不把前一次烤的查無當本次問題。' }
          }
          return {
            ...clientError(orderingMessages['zh-Hant'].recovery.lookup),
            code: 'INVALID_TOOL_ARGUMENTS',
            dataOnly: true,
            availableCategories: currentCriteria.categories,
            // This is candidate evidence from the current full catalog, not a
            // claim that a substring or invented category matches every product.
            products: facts.products.map(product => ({ name: product.name, price: product.price, aliases: product.aliases, ...(typeof product.category === 'string' ? { category: product.category } : {}), ...(typeof product.description === 'string' ? { description: product.description } : {}) })),
            explanation: 'criteria.category 必須使用 availableCategories 中的完整分類名稱；沒有相符分類不代表沒有餐點。products 是本輪完整菜單候選，優先依顧客語意、已知品名／分類／內容挑選真正符合的品項，再用 point_to_menu_items purpose=information 介紹並框選。問湯品不能只因名稱含湯就納入湯餃或含湯套餐；資料不足才查 get_menu_item_details。必要時 search_menu_items 可補找候選，關鍵字相符不是餐類已核實。此輪只讀取菜單，未操作網站或改變推薦條件／購物車，請繼續完成原查詢。',
          }
        }
        return { ok: true, source: 'browser', dataOnly: true, products: filterBrowserRecommendations(facts.products), recommendationCriteria: currentCriteria.criteria }
      }
      if (name === 'list_cart_items') {
        parse(strictObject({}), input)
        const facts = await read()
        return { ok: true, source: 'browser', dataOnly: true, cart: facts.cart }
      }
      if (name === 'continue_checkout') {
        parse(strictObject({}), input)
        return executeBrowserCheckout(client, 'continue')
      }
      if (name === 'choose_invoice_method')
        return executeBrowserCheckout(client, 'invoice', parse(strictObject({ method: pbInvoiceMethodSchema }), input))
      if (name === 'set_invoice_notification_phone')
        return executeBrowserCheckout(client, 'phone', parse(strictObject({ phone: text }), input))
      if (name === 'get_menu_item_details') {
        const names = parse(strictObject({ names: pipe(array(text), minLength(1), maxLength(10)) }), input)
        const facts = await read()
        const canonicalNames = names.names.map((name) => {
          const matches = matchingProducts(facts.products, name)
          return matches.length === 1 ? matches[0].name : name
        })
        return client.execute(tool('browser_product_get'), { names: canonicalNames })
      }
      if (name === 'search_menu_items')
        return call('browser_search', parse(strictObject({ query: pipe(string(), maxLength(200)) }), input))
      if (name === 'open_menu_item_details') {
        const requested = parse(strictObject({ name: text }), input)
        const matches = matchingProducts((await read()).products, requested.name)
        if (matches.length !== 1)
          return clientError('請先確認要查看哪道餐點。')
        return call('browser_open_product', { name: matches[0].name })
      }
      if (name === 'point_to_menu_items') {
        const { names, purpose } = parse(strictObject({ names: pipe(array(text), minLength(1), maxLength(10)), purpose: picklist(['recommendation', 'other-recommendations', 'information']) }), input)
        const facts = await read()
        const eligible = purpose !== 'information' ? filterBrowserRecommendations(facts.products) : facts.products
        const refs = names.map((name) => {
          const found = matchingProducts(eligible, name)
          if (found.length !== 1 && matchingProducts(facts.products, name).length === 1)
            return undefined
          if (found.length !== 1)
            throw new CustomerInputError(`無法確定要介紹的餐點「${name}」。`)
          return found[0].ref
        })
        if (refs.includes(undefined))
          return { ...clientError(orderingMessages['zh-Hant'].recovery.lookup), code: 'INVALID_TOOL_ARGUMENTS', dataOnly: true, explanation: '指定餐點確實存在，只是不符合目前保留的推薦條件，不能說找不到或無法確定。顧客明確指定餐點或要求查某類時，改用 point_to_menu_items purpose=information 介紹實際符合的餐點；這不會清除其他忌口／預算，也不加入購物車。需要購買且未說份數時接續 ask_customer_question questionType=quantity。' }
        return call('browser_present', { productRefs: refs, mode: purpose })
      }
      if (name === 'add_items_to_cart') {
        const { items } = parse(strictObject({ items: pipe(array(mealSchema), minLength(1), maxLength(10)) }), input)
        const results: unknown[] = []
        let refreshedMenu = false
        let verifiedVersion: string | undefined
        // Validate every requested configuration before the first mutation.
        const initial = await read()
        for (const item of items) {
          if (matchingProducts(initial.products, item.name).length)
            resolveMeal(initial, item)
        }
        for (const item of items) {
          let result: unknown
          try {
            let current = await read()
            if (!refreshedMenu && !matchingProducts(current.products, item.name).length) {
              await refreshMissingDishMenu(client, current.cart.version, item.name)
              refreshedMenu = true
              current = await read()
            }
            if (!matchingProducts(current.products, item.name).length) {
              results.push({ ...clientError(`目前菜單未列出「${item.name}」，這道沒有加入。`), reason: 'product-unavailable' })
              continue
            }
            result = await call('browser_cart_add', resolveMeal(current, item))
            // Resolving an old question returns its sealed proposal as data.
            // This explicit add operation completes it without another model round.
            if (result && typeof result === 'object' && 'confirmedAddition' in result)
              return batchResult([...results, await executeBrowserConfirmedAddition(client)])
          }
          catch (error) {
            // Earlier verified writes remain real even if a later read fails.
            return batchResult([...results, clientFailure(error)])
          }
          results.push(result)
          const receipt = parse(looseObject({ status: optional(string()) }), result)
          if (receipt.status === 'verified') {
            const cart = safeParse(looseObject({ version: string() }), receipt.cart)
            verifiedVersion = cart.success ? cart.output.version : undefined
          }
          if (receipt.reason === 'product-unavailable' && !refreshedMenu) {
            try {
              const current = await read()
              await refreshMissingDishMenu(client, current.cart.version, item.name)
              refreshedMenu = true
            }
            catch (error) {
              return batchResult([...results, clientFailure(error)])
            }
          }
          if (receipt.status !== 'verified' && receipt.reason !== 'product-unavailable')
            return batchResult(results)
        }
        const added = batchResult(results)
        const verified = safeParse(looseObject({ effectMessage: string(), customerMessage: string() }), added)
        if (!verified.success || !verifiedVersion)
          return added
        const { effectMessage, customerMessage } = verified.output
        try {
          const reviewed = await reviewCartAfterAdditions(client, items.map(item => ({ ...matchingProducts(initial.products, item.name)[0], ...item })), verifiedVersion)
          if (!reviewed)
            return added
          const receipt = parse(looseObject({ customerMessage: optional(string()) }), reviewed)
          return { ...added, ...receipt, effect: receipt.ok === false || verified.output.partial ? 'partial' : 'applied', effectMessage, customerMessage: [customerMessage, receipt.customerMessage].filter(Boolean).join(' ') }
        }
        catch {
          return { ...added, ok: false, status: 'rejected', effect: 'partial', customerMessage: `${customerMessage} 購物車畫面暫時無法核對，已加入的餐點會保留。` }
        }
      }
      if (name === 'set_cart_item_quantity') {
        const parsed = safeParse(strictObject({ target: targetSchema, quantity }), input)
        // This boundary has not read or changed the website. Zero means a
        // different operation, not an admissible total or an unknown write.
        if (!parsed.success)
          return { ...clientError('餐點尚未變更，請再說一次要調整哪道餐點的份數。'), code: 'INVALID_TOOL_ARGUMENTS', dataOnly: true, explanation: '這次未讀取或修改網站。quantity 必須是 1 到 99 的整數，表示調整後的總份數；整道餐點全部不要請使用 remove_items_from_cart。請依顧客完整需求重新選擇操作及參數。' }
        const { target, quantity: count } = parsed.output
        const facts = await read()
        const rows = targetRows(facts, target)
        const total = rows.reduce((sum, row) => sum + row.quantity, 0)
        // Reapplying the existing serving count proves no requested change.
        // Let Main repair a pieces/options request instead of issuing a false
        // "adjusted" receipt for a write that leaves the cart unchanged.
        if (total === count)
          return { ok: true, source: 'browser', status: 'proposal_rejected', effect: 'none', dataOnly: true, customerMessage: `目前「${target.name}」已是 ${count} 份，份數未變更。`, explanation: '這次未派送購物車寫入，不能宣稱已調整或已完成原需求。若顧客要改每份顆數、加料或備註，使用 replace_item_in_cart 保留原份數並修改配置；水餃每份顆數使用 replacement.piecesPerServing。請依完整原需求修正工具，不能把顆數當份數。' }
        return call('browser_cart_quantity', { ...resolveTarget(facts, target), quantity: count })
      }
      if (name === 'remove_items_from_cart') {
        const { targets } = parse(strictObject({ targets: pipe(array(targetSchema), minLength(1), maxLength(10)) }), input)
        const initial = await read()
        for (const target of targets)
          resolveTarget(initial, target)
        const results: unknown[] = []
        for (const target of targets) {
          let result: unknown
          try {
            result = await call('browser_cart_remove', resolveTarget(await read(), target))
          }
          catch (error) {
            return batchResult([...results, clientFailure(error)])
          }
          results.push(result)
          if (parse(looseObject({ status: optional(string()) }), result).status !== 'verified')
            return batchResult(results)
        }
        return batchResult(results)
      }
      if (name === 'replace_item_in_cart') {
        const parsed = safeParse(strictObject({ target: targetSchema, replaceQuantity: quantity, replacement: strictObject(mealFields) }), input)
        if (!parsed.success) {
          // Argument validation precedes every website read/write. Keep this
          // distinguishable from an uncertain dispatched operation so Main can
          // repair its call without claiming that the cart needs recovery.
          return { ...clientError('餐點尚未變更，請再說一次要將哪道餐點的幾份換成哪道餐點。'), code: 'INVALID_TOOL_ARGUMENTS', dataOnly: true, explanation: '這次未讀取或修改網站。replaceQuantity 是原餐換出的份數，也是新餐加入的份數；replacement 只填新餐名稱與設定，不含 quantity。請依顧客完整需求重新選擇操作及參數，不直接重複剛才的呼叫。' }
        }
        const { target, replaceQuantity, replacement } = parsed.output
        const facts = await read()
        const original = resolveTarget(facts, target)
        const row = facts.cart.lines.find(line => line.ref === original.lineRef)!
        const total = targetRows(facts, target).reduce((sum, line) => sum + line.quantity, 0)
        if (replaceQuantity > total)
          return clientError('要更換的份數超過購物車現有份數，請重新確認。')
        return call('browser_cart_replace', { ...resolveMeal(facts, { ...replacement, quantity: replaceQuantity }, pbProductName(replacement.name) === pbProductName(row.name) ? row : undefined), ...original, retainQuantity: total - replaceQuantity })
      }
      if (name === 'cancel_item_selection') {
        parse(strictObject({}), input)
        return cancelBrowserItemSelection(client)
      }
      if (name === 'return_to_table') {
        parse(strictObject({}), input)
        return call('browser_return_table', {})
      }
      if (name === 'return_to_menu' || name === 'open_cart') {
        parse(strictObject({}), input)
        return call(name === 'return_to_menu' ? 'browser_return_menu' : 'browser_cart_review', {})
      }
      if (name === 'ask_customer_question') {
        const requested = safeParse(strictObject({ questionType: customerQuestionTypeSchema, name: optional(text), query: optional(pipe(string(), maxLength(200))) }), input)
        // Reject before even reading PB: only this boundary proves that a bounded
        // model correction cannot replay a website or cart operation.
        if (!requested.success) {
          return {
            ...clientError(orderingMessages['zh-Hant'].toolInputRejected),
            code: 'INVALID_TOOL_ARGUMENTS',
            dataOnly: true,
            explanation: `ask_customer_question 只接受 questionType=${customerQuestionTypeSchema.options.join('、')}，不能填入 replyType。活動、買一送一或優惠券說明使用 reply_to_customer，參數為 {"replyType":"promotion-policy"}；不承諾未核實的活動。尚未讀取或操作網站，請依顧客原句修正工具。`,
          }
        }
        const question = requested.output
        if (question.name && ['quantity', 'option', 'purchase-recommendation'].includes(question.questionType)) {
          const facts = await read()
          const products = matchingProducts(facts.products, question.name)
          if (products.length !== 1)
            return clientError('請先確認要點哪道餐點。')
          question.name = products[0].name
          if (question.questionType === 'option' && products[0].configurations.length === 1 && !products[0].configurations[0].groups.length) {
            return { ...clientError(orderingMessages['zh-Hant'].toolInputRejected), code: 'INVALID_TOOL_ARGUMENTS', dataOnly: true, explanation: '這道餐沒有網站選項。顧客明確要求的去料或做法以原意填入該餐 note；缺份數時只問 quantity，承接原需求。資料齊全才用 add_items_to_cart，不承諾店家一定能配合。若只是詢問選項，依餐點資料回答。' }
          }
          if (question.questionType === 'quantity')
            return executeBrowserQuantityQuestion(client, { productRef: products[0].ref })
        }
        if (question.questionType === 'item')
          return call('browser_clarify_product', { query: question.query ?? question.name ?? '' })
        if (question.questionType === 'table') {
          const raw = await readBrowserOrderingFacts(client)
          const page = safeParse(looseObject({ page: string() }), raw)
          if (page.success && ['menu', 'cart', 'checkout'].includes(page.output.page))
            return call('browser_return_table', {})
          const entry = parse(looseObject({ tableChoices: array(string()), selectedTable: optional(string()), customerMessage: string() }), raw)
          // Preserve the fresh table read's unavailable-table explanation. A
          // generic question must not replace an A9 rejection with an A1 offer.
          const message = entry.customerMessage
          return { ok: true, source: 'browser', status: 'clarification', effect: 'none', customerMessage: message, tableChoices: entry.tableChoices, selectedTable: entry.selectedTable, pendingCustomerChoice: { questionId: 'pb-table-selection', purpose: 'browser-table-selection', question: message, choices: [...entry.tableChoices.map((description, index) => ({ id: `table-${index}`, description })), ...(entry.selectedTable ? [{ id: 'start', description: `使用目前選擇${entry.selectedTable}開始點餐` }] : [])], expiresAt: Date.now() + 30000 } }
        }
        // This helper reads facts and builds a question; it cannot dispatch a
        // cart write. Await so unavailable names/groups reach the repairable
        // proposal response below instead of escaping as a tool transport error.
        return await askBrowserCustomerQuestion(client, question)
      }
      if (name === 'reply_to_customer') {
        const requested = safeParse(strictObject({ replyType: customerReplySchema }), input)
        // This rejection precedes every website read or write. The existing
        // bounded proposal repair can correct the call without replaying an effect.
        if (!requested.success) {
          return {
            ...clientError(orderingMessages['zh-Hant'].replyInputRejected),
            code: 'INVALID_TOOL_ARGUMENTS',
            dataOnly: true,
            explanation: 'reply_to_customer 只接受 replyType；請使用工具結構列出的值，不要加入 parameters 包裝。依照使用者原句修正這次提案。尚未讀取或操作網站。',
          }
        }
        return executeBrowserReply(client, requested.output.replyType)
      }
      const unhandled: never = name
      throw new Error(`尚未提供此操作：${unhandled}`)
    }
    catch (error) {
      // Do not label unknown readback/runtime failures as safe argument repair:
      // unlike pre-dispatch validation, they cannot authorize replaying an effect.
      return clientFailure(error)
    }
  }
  return (Object.keys(orderingTools) as OrderingToolName[]).map(name => rawTool({
    name,
    description: orderingTools[name].description,
    parameters: orderingTools[name].parameters,
    execute: async (input) => {
      // No-argument capabilities have fixed Host-owned actions. Model wrappers
      // cannot supply a target or alter them; forward {} instead of rejecting
      // harmless metadata before the native ownership/action checks.
      const argumentsForAction = Object.keys(orderingTools[name].parameters.properties).length ? input : {}
      const result = await executeOperation(name, argumentsForAction)
      if (!result || typeof result !== 'object')
        return result
      return { ...result, nextActions: orderingNextActions(name, result) }
    },
  }))
}
