import type { BrowserConversation } from '@proj-airi/stage-shared/browser-conversation'
import type { ServiceTool } from '@proj-airi/stage-shared/interactive-service'
import type { OrderingSite } from '@proj-airi/stage-shared/ordering-sites'

import type { FastPathSource } from './kiosk-fast-path'

import { errorMessageFrom } from '@moeru/std'
import { browserQuestionChoice } from '@proj-airi/stage-shared/browser-conversation'
import { labelCatalog } from '@proj-airi/stage-shared/ordering-sites'
import { normalizeSlotNumbers, quantityFromTranscript } from '@proj-airi/stage-shared/ordering-slots'
import { orderingNextActions } from '@proj-airi/stage-shared/ordering-tools'
import { pbSubmissionDispatchSchema } from '@proj-airi/stage-shared/pb-checkout'
import { parsePbDumplingServings } from '@proj-airi/stage-shared/pb-menu-presentation'
import { productConfigurationSchema } from '@proj-airi/stage-shared/product-configuration'
import { productFragment, productMentions } from '@proj-airi/stage-shared/product-discovery'
import { browserRecommendationLimit } from '@proj-airi/stage-shared/product-presentation'
import { resolveTableName } from '@proj-airi/stage-shared/table-names'
import { resolveSelection } from '@proj-airi/stage-ui/services/pbProduct'
import { array, literal, looseObject, number, optional, safeParse, string } from 'valibot'

import { createMenuReplyWindow } from './questionPresentation'

const factsSchema = looseObject({
  page: optional(string()),
  productDialog: optional(array(looseObject({ name: string() })), []),
  cart: looseObject({ version: string(), lines: optional(array(looseObject({ ref: string(), name: string(), quantity: number(), productRef: optional(string()), configuration: optional(string()), unitPrice: optional(number()) })), []) }),
  products: array(looseObject({ ref: string(), name: string(), price: number(), kind: string(), priceType: number(), configurations: array(productConfigurationSchema) })),
})

/**
 * PB supplies fresh references; Jev selects only a semantic intent. This adapter
 * compiles narrow literal slots and sends the actual operation through the same
 * Host cart/session/effect validator as Main. Uncovered speech remains intact.
 */
export function createBrowserFastPathSource(io: {
  tools: readonly ServiceTool[]
  read: (tool: ServiceTool, input: Record<string, unknown>) => Promise<unknown>
  execute: (tool: ServiceTool, input: Record<string, unknown>) => Promise<unknown>
  hasPendingQuestion: () => boolean
  pendingQuestion: (facts: unknown) => BrowserConversation['waitingFor']
  releaseService?: (facts: unknown, questionId: string) => void
  canAnswerLocally?: (facts: unknown, transcript: string) => boolean
  recommendationPool?: (products: { ref: string, name: string, configurations: { unitPrice: number }[] }[]) => string[]
  shownRecommendations?: () => string[]
  previousRecommendations?: (refs: readonly string[]) => string[] | undefined
  catalogLabels?: () => OrderingSite['catalogLabels']
}): FastPathSource {
  let issued: { read: Record<string, unknown>, add?: Record<string, unknown>, transcript: string, plainMenu: boolean, productRefs: string[], plans: Record<string, { name: string, input: Record<string, unknown> }>, answerIds?: string[] } | undefined
  const tool = (name: string) => {
    const found = io.tools.find(tool => tool.name === name)
    if (!found && ['browser_ask_quantity', 'browser_answer_question', 'browser_add_items'].includes(name))
      return { name, description: 'Host-owned question operation.', inputSchema: { type: 'object' }, origin: io.tools[0]?.origin ?? '' }
    if (!found)
      throw new Error(`PB capability unavailable: ${name}`)
    return found
  }
  const execute = async (name: string, args: Record<string, unknown>) => {
    const raw = await io.execute(tool(name), args)
    const result = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const mayChangeCart = ['browser_cart_add', 'browser_cart_quantity', 'browser_cart_remove', 'browser_cart_replace', 'browser_add_items', 'browser_answer_question'].includes(name)
    const hasResult = result.status === 'verified' || result.status === 'preserved' || result.status === 'clarification' || result.dataOnly === true || result.pendingCustomerChoice || result.selectedProduct || result.needsAssistant || result.status === 'unknown' || result.effect === 'unknown' || result.effect === 'partial' || result.effect === 'none'
    if (mayChangeCart && !hasResult && !safeParse(pbSubmissionDispatchSchema, result).success)
      return { ...result, ok: false, status: 'unknown', effect: 'unknown', decisionTrace: { operationPlan: { toolName: name, input: args } } }
    return { ...result, nextActions: orderingNextActions(name === 'browser_add_items' ? 'add_items_to_cart' : name, result), ...(result.selectedProduct || result.status === 'proposal_rejected' || (result.status === 'clarification' && !('pendingCustomerChoice' in result)) ? { needsAssistant: true } : {}), decisionTrace: { operationPlan: { toolName: name, input: args } } }
  }
  return {
    async context(input) {
      issued = undefined
      const transcript = typeof input.transcript === 'string' ? input.transcript : ''
      const candidates = [{ id: 'intent:search-menu', description: '讀取目前 PB 菜單與實際售價，不改購物車；需要條件篩選、比較或其他操作則交接 Main。' }]
      // Admission must still run, but Main must append this utterance before
      // the bound answer resolver runs.
      // Reading through that resolver here could consume consent early, or
      // return a question receipt with no cart and mislabel it as a Jev failure.
      let raw: unknown
      try {
        raw = await io.read(tool('browser_cart_get'), { includeCatalog: true })
      }
      catch (error) {
        return { contextError: errorMessageFrom(error) ?? 'PB context read failed.' }
      }
      if (raw && typeof raw === 'object' && 'customerBoundary' in raw && raw.customerBoundary === 'review-required') {
        // Private prior-customer cart data is intentionally absent. Keep only
        // service admission available; Main retains the existing handoff gate.
        return { phase: 'ordering', requiresPlanner: true, customerBoundary: 'review-required', candidates }
      }
      if (raw && typeof raw === 'object' && 'ok' in raw && raw.ok === false)
        return { contextError: 'customerMessage' in raw && typeof raw.customerMessage === 'string' ? raw.customerMessage : 'PB context read was rejected.' }
      if (raw && typeof raw === 'object' && 'page' in raw && raw.page === 'table') {
        const table = safeParse(looseObject({ page: literal('table'), tableChoices: array(string()), selectedTable: optional(string()) }), raw)
        if (!table.success || !table.output.tableChoices.length)
          return { contextError: '目前無法取得可選桌號，請確認畫面。' }
        const choices = table.output.tableChoices.map((name, index) => ({ id: `table-${index}`, description: name }))
        if (table.output.selectedTable && table.output.tableChoices.includes(table.output.selectedTable))
          choices.push({ id: 'start', description: `使用目前選擇${table.output.selectedTable}開始點餐` })
        // Visible table facts cannot manufacture an unasked question. Exact
        // spoken codes can narrow a target, without restricting other wording.
        const spoken = normalizeSlotNumbers(transcript).match(/[a-z]+\s*\d+(?:\s*桌)?/i)?.[0]
        const selected = spoken ? resolveTableName(spoken, table.output.tableChoices) : resolveTableName(transcript.replaceAll(/[，,。！!]/g, ''), table.output.tableChoices) ?? (/開始/.test(transcript) ? table.output.selectedTable : undefined)
        const selectionText = transcript.replaceAll(/[\s，,。！!]/g, '').replace(/開始點餐吧?$/, '').replace(/^(?:請幫我|幫我|我要|我想要|請)?(?:選擇|選|我的桌號是|桌號是)?/, '')
        // A table code inside a larger food request is not whole-utterance
        // coverage. Preserve that request for Main instead of dropping the food.
        const entryOnly = resolveTableName(selectionText, table.output.tableChoices) === selected || /^(?:請|幫我|我要)?開始點餐[吧。！!\s]*$/.test(transcript)
        const requested = entryOnly && spoken && selected && choices.find(choice => choice.description === selected)
        // Literal table codes narrow the target list, not the intent. When
        // no table token is available, Jev can still understand pickup or Start.
        const offered = requested ? [requested] : choices
        const plans = Object.fromEntries(offered.map(choice => [choice.id, { name: choice.id === 'start' || (requested && /開始/.test(transcript)) ? 'browser_start_ordering' : 'browser_table_select', input: { name: choice.id === 'start' ? table.output.selectedTable! : choice.description } }]))
        issued = { transcript, read: {}, plainMenu: false, productRefs: [], plans, answerIds: offered.map(choice => choice.id) }
        return { phase: 'selecting_table', tableSelectionRequired: true, tableSelection: { choices: table.output.tableChoices, selectedTable: table.output.selectedTable }, candidates: offered.map(choice => ({ ...choice, description: plans[choice.id].name === 'browser_start_ordering' ? `使用${plans[choice.id].input.name}開始點餐` : `選擇${choice.description}，留在選桌頁，尚未開始點餐` })) }
      }

      const waitingFor = io.pendingQuestion(raw)
      const localAnswer = waitingFor && io.canAnswerLocally?.(raw, transcript)
      // A current search exposes recovery for every utterance. Jev decides
      // whether the customer means this action; no phrase list admits it.
      const activeSearch = raw && typeof raw === 'object' && 'search' in raw && typeof raw.search === 'string' ? raw.search : ''
      if (waitingFor) {
        if (localAnswer) {
          const literal = browserQuestionChoice(transcript, waitingFor)
          const id = literal ?? 'answer:current'
          const choice = { id, description: literal ? waitingFor.choices.find(choice => choice.id === literal)!.description : `回答目前問題「${waitingFor.question}」：${transcript}` }
          const name = literal === 'cancel' ? 'browser_close_product' : 'browser_answer_question'
          issued = { transcript, read: {}, plainMenu: false, productRefs: [], plans: { [id]: { name, input: {} } }, answerIds: [id] }
          return { phase: 'ordering', waitingFor: { ...waitingFor, choices: [choice] }, candidates: [choice] }
        }
        // The live question outranks its underlying search. Offer every issued
        // answer to Jev; unfamiliar wording must not erase confirmation context.
        const offered = [...waitingFor.choices]
        if (activeSearch && io.tools.some(tool => tool.name === 'browser_return_menu'))
          offered.push({ id: 'intent:return-menu', description: '放棄目前搜尋與尚未加入的選餐，回到完整菜單；保留購物車。' })
        const plans = Object.fromEntries(offered.map(choice => [choice.id, { name: choice.id === 'intent:return-menu' ? 'browser_return_menu' : choice.id === 'cancel' ? 'browser_close_product' : 'browser_answer_question', input: {} }]))
        if (waitingFor.purpose === 'browser-service-question') {
          const facts = safeParse(factsSchema, raw)
          if (facts.success && io.tools.some(tool => tool.name === 'browser_product_get')) {
            // A checkout offer must not hide read-only questions about the
            // actual cart. Jev still chooses the meaning; no phrase list does.
            const refs = new Set(facts.output.cart.lines.map(line => line.productRef))
            for (const product of facts.output.products.filter(product => refs.has(product.ref))) {
              const id = `information:${product.ref}`
              offered.push({ id, description: `查詢並回答${product.name}的單份內容、基本顆數、單價或選項；不是回答「${waitingFor.question}」，不修改購物車、不結帳或購買。` })
              plans[id] = { name: 'service-item-information', input: { questionId: waitingFor.questionId, names: [product.name] } }
            }
          }
          offered.push({ id: 'intent:new-request', description: `提出其他需求或查詢，不是在回答「${waitingFor.question}」；例如詢問每份內容、顆數、價格或修改餐點。保留購物車，不同意結帳或購買。` })
          plans['intent:new-request'] = { name: 'service-new-request', input: { questionId: waitingFor.questionId } }
        }
        issued = { transcript, read: {}, plainMenu: false, productRefs: [], plans, answerIds: offered.map(choice => choice.id) }
        return { phase: 'ordering', waitingFor, candidates: offered }
      }
      if (activeSearch && io.tools.some(tool => tool.name === 'browser_return_menu')) {
        issued = { transcript, read: {}, plainMenu: false, productRefs: [], plans: { 'intent:return-menu': { name: 'browser_return_menu', input: {} } } }
        return { phase: 'ordering', menuSearch: { query: activeSearch.slice(0, 200) }, interactionState: { matchingCartLines: 0, screen: 'menu', pendingAction: `目前搜尋「${activeSearch}」。取消搜尋會清除關鍵字與未加入的選餐，保留購物車；刪除餐點、取消整單或新的餐點要求需要另外處理。` }, candidates: [{ id: 'intent:return-menu', description: '放棄目前搜尋，回到完整菜單；保留購物車。' }] }
      }
      const parsed = safeParse(factsSchema, raw)
      if (!parsed.success)
        return { contextError: parsed.issues[0].message }
      const facts = parsed.output
      // Dialog visibility comes from the current website receipt, not the
      // transcript or an old question. Viewing a dish does not mean ordering it.
      const selectedItemName = facts.productDialog.length === 1 ? facts.productDialog[0].name : undefined
      const catalog = labelCatalog(facts.products, io.catalogLabels?.())
      const mentions = productMentions(catalog, transcript)
      const matched = mentions.map(mention => mention.product)
      // Fragments are weaker discovery evidence, not aliases or purchase slots.
      // Keep the decision context consistent with the displayed candidate: a
      // chicken-fragment batch cannot simultaneously report zero menu matches.
      const discovery = mentions.length
        ? mentions.map(mention => ({ ...mention, source: mention.label === mention.product.name ? 'name' : 'alias' }))
        : catalog.flatMap((product) => {
            const label = productFragment(product, catalog, transcript)
            return label ? [{ product, label, source: 'fragment' }] : []
          })
      const screen = selectedItemName ? 'item_configuration' : facts.page === 'cart' ? 'cart_review' : facts.page === 'menu' ? 'menu' : undefined
      const focusedName = selectedItemName ?? (matched.length === 1 ? matched[0].name : undefined)
      const focusedProducts = selectedItemName ? catalog.filter(product => product.name === selectedItemName) : matched
      const focusedProduct = focusedProducts.length === 1 ? focusedProducts[0] : undefined
      // Page role and target ambiguity are observed facts, not an intent gate.
      // Preserve them for both providers without forbidding cart edits on menu.
      const interactionState = screen ? { screen, matchingCartLines: facts.cart.lines.filter(line => focusedProduct && line.productRef !== undefined ? line.productRef === focusedProduct.ref : line.name === focusedName).length, ...(selectedItemName ? { selectedItemName, pendingAction: `目前開啟「${selectedItemName}」餐點視窗。可關閉視窗返回菜單；這不代表顧客已同意加入購物車，也不表示要刪除購物車裡的餐點。` } : {}) } : undefined
      const categories = [...new Set(catalog.map(product => product.category).filter(Boolean))].filter(label => transcript.includes(label)).map(label => ({ label, matchedText: label, itemCount: catalog.filter(product => product.category === label).length }))
      const references = discovery.slice(0, 5).map(({ product }) => ({ label: product.name, refId: product.ref }))
      const read = matched.length === 1 ? { names: [matched[0].name] } : { includeDescriptions: true, purpose: 'information' }
      // These closed forms define compiler coverage, not language intent.
      // Every uncovered request keeps its entire text for Main after Jev's
      // service/background admission; a catalog lookup cannot authorize edits.
      const plainMenu = /^(?:請問|請|我想知道|幫我看)?(?:目前|今天|現在)?(?:有什麼|有哪些|有甚麼|菜單|看菜單|餐點有哪些|有哪些餐點|有什麼餐點|有什麼可以吃|有哪些可以點)(?:餐點|品項|可以點|可以吃)?[？?。\s]*$/.test(transcript)
      issued = { read, transcript, plainMenu, productRefs: facts.products.map(product => product.ref), plans: {} }
      if (matched.length === 1) {
        const product = matched[0]
        issued.plans['intent:read-item'] = { name: 'browser_product_get', input: { names: [product.name] } }
        candidates.push({ id: 'intent:read-item', description: `查詢${product.name}在網站提供的內容、說明與單份價格；不加入購物車。不包含份數合計、客製計算、比較或其他操作。` })
        if (io.tools.some(tool => tool.name === 'browser_open_product')) {
          issued.plans['intent:select-item'] = { name: 'browser_open_product', input: { name: product.name } }
          candidates.push({ id: 'intent:select-item', description: `打開${product.name}的餐點視窗給顧客查看，不加入購物車。` })
        }
      }
      // A closed literal slot form is compilation coverage, not intent. Jev
      // must select purchase before this one-use compiled plan can be admitted.
      if (matched.length === 1 && !io.hasPendingQuestion()) {
        const product = matched[0]
        const matchedLabel = mentions[0].label
        const remainder = transcript.replace(matchedLabel, '').replace(/[\s，。！!、]/g, '')
        const amount = quantityFromTranscript(remainder)
        const covered = /^(?:[請要加來]|幫我|請幫我|我要|我想要|給我|請給我|再來|再加|[再多])?(?:要|加)?(?:[1-9]|1\d|20|[一二兩三四五六七八九十]{1,3})份(?:謝謝)?$/.test(remainder)
        const configuration = product.configurations.length === 1 ? product.configurations[0] : undefined
        if (covered && amount && product.kind === 'product' && product.priceType === 1 && configuration && !configuration.variantRef && !configuration.groups.some(group => group.required)) {
          issued.add = { version: facts.cart.version, productRef: product.ref, quantity: amount, unitPrice: configuration.unitPrice, note: '', selection: { version: configuration.version, variantRef: configuration.variantRef, choices: [] } }
          candidates.push({ id: 'intent:add-item', description: `新增${product.name}${amount}份，每份${configuration.unitPrice}元，使用目前基本配置；保留原本的購物車，不含加購、備註或其他需求。` })
        }
        const dumplings = parsePbDumplingServings(transcript, product.name, matchedLabel)
        const extras = configuration?.groups.filter(group => group.name === '加量').flatMap(group => group.choices.filter(choice => choice.name === '水餃')) ?? []
        if (dumplings && configuration && !configuration.variantRef && extras.length === 1 && product.kind === 'product' && product.priceType === 1) {
          const selection = { version: configuration.version, variantRef: '', choices: dumplings.extra ? [{ ref: extras[0].ref, quantity: dumplings.extra }] : [] }
          try {
            const resolved = resolveSelection(configuration, selection, '')
            issued.add = { version: facts.cart.version, productRef: product.ref, quantity: dumplings.quantity, unitPrice: resolved.unitPrice, note: '', selection }
            candidates.push({ id: 'intent:add-item', description: `新增周氏水餃${dumplings.quantity}份，每份${dumplings.piecesPerServing}顆；基本8顆，加量每份${dumplings.extra}顆，沒有其他修改。` })
          }
          catch { /* A changed mandatory option/limit is not finite coverage. */ }
        }
      }
      if (io.tools.some(tool => tool.name === 'browser_cart_review')) {
        issued.plans['intent:view-cart'] = { name: 'browser_cart_review', input: {} }
        candidates.push({ id: 'intent:view-cart', description: '查看購物車裡的餐點與網站總額，不修改或送出訂單。' })
      }
      if (io.tools.some(tool => tool.name === 'browser_return_menu')) {
        issued.plans['intent:return-menu'] = { name: 'browser_return_menu', input: {} }
        candidates.push({ id: 'intent:return-menu', description: selectedItemName ? `關閉目前「${selectedItemName}」餐點視窗並返回完整菜單，清除搜尋，保留購物車裡的餐點。` : '回到完整菜單，清除搜尋或結束目前推薦，保留購物車。' })
      }
      const replay = (io.shownRecommendations?.().length ?? 0) > 0
      if (replay) {
        const refs = io.shownRecommendations?.().filter(ref => issued!.productRefs.includes(ref)) ?? []
        if (refs.length) {
          issued.plans['intent:show-recommendations'] = { name: 'browser_present', input: { productRefs: refs, mode: 'information' } }
          candidates.push({ id: 'intent:show-recommendations', description: '重新顯示剛才已成功介紹的同一批餐點，不加入購物車。' })
        }
      }
      const recommendation = io.tools.some(tool => tool.name === 'browser_present')
      if (recommendation) {
        const eligible = io.recommendationPool?.(facts.products) ?? issued.productRefs
        // Literal mentions/fragments constrain display targets, never purchase
        // intent or aliases. Jev still chooses the effect. A candidate must not
        // promise named dishes and then execute an unrelated random batch.
        const requestedRefs = discovery.map(({ product }) => product.ref)
        const categoryRefs = catalog.filter(product => categories.some(category => category.label === product.category)).map(product => product.ref)
        let normal = eligible
        if (requestedRefs.length)
          normal = requestedRefs.length <= browserRecommendationLimit && requestedRefs.every(ref => eligible.includes(ref)) ? requestedRefs : []
        else if (categoryRefs.length)
          normal = eligible.filter(ref => categoryRefs.includes(ref))
        // Jev chooses whether the customer wants a new batch or other dishes.
        // Merely having recommendation history cannot narrow a fresh request.
        const batches = [{ id: 'intent:recommend', mode: 'recommendation', refs: normal, description: '介紹以下餐點供顧客選擇，可包含之前介紹過的符合餐點；要求換其他推薦時使用另一選項。' }]
        if (replay) {
          const available = io.previousRecommendations?.(normal)
          if (available?.length)
            batches.push({ id: 'intent:recommend-other', mode: 'other-recommendations', refs: available, description: '顧客要求換其他推薦：排除上一批已介紹的餐點，從符合目前條件的其他餐點隨機挑選最多三道；不是搜尋某個餐名或餐類。' })
        }
        for (const batch of batches) {
          const pool = [...batch.refs]
          const refs: string[] = []
          if (batch.id === 'intent:recommend' && requestedRefs.length) {
            refs.push(...pool)
          }
          else {
            while (pool.length && refs.length < browserRecommendationLimit)
              refs.push(...pool.splice(Math.floor(Math.random() * pool.length), 1))
          }
          if (refs.length) {
            issued.plans[batch.id] = { name: 'browser_present', input: { productRefs: refs, mode: batch.mode } }
            const names = refs.map(ref => facts.products.find(product => product.ref === ref)!.name)
            candidates.push({ id: batch.id, description: `${batch.description} 本次實際餐點：${names.join('、')}。詢問想點哪一道；只有一道時詢問是否來一份。尚未加入購物車，不宣稱人氣排行。` })
          }
        }
      }
      let compiled = (replay && !!issued.plans['intent:show-recommendations']) || (recommendation && !!issued.plans['intent:recommend']) || plainMenu || !!issued.add || /^(?:我點了什麼|看購物車|購物車|總共多少|總金額多少|我要加點|回去看菜單|回到菜單|返回菜單|回主菜單|繼續點餐)[。！!？?\s]*$/.test(transcript)
      if (matched.length === 1 && !io.hasPendingQuestion()) {
        const product = matched[0]
        // Native refs identify the actual product even when cart labels differ.
        // Label-only observations still require one uniquely matching row.
        const rows = facts.cart.lines.filter(line => line.productRef === undefined ? line.name === product.name : line.productRef === product.ref)
        if (rows.length === 1) {
          const row = rows[0]
          // Remove the already-resolved catalog label before normalizing slots:
          // 三杯雞 is a product name, while 兩份 is the numeric argument.
          const modification = normalizeSlotNumbers(transcript.replace(mentions[0].label, '')).replaceAll(/[\s，,。！!？?]/g, '')
          const counts = [...modification.matchAll(/([1-9]\d?)份/g)].map(match => Number(match[1]))
          if (counts.length === 1 && /^(?:[請把將]|請幫我|幫我)?(?:改成|改為|只留|只要|總共|少|減少|減掉|減)[1-9]\d?份$/.test(modification)) {
            const final = /少|減/.test(modification) ? row.quantity - counts[0] : counts[0]
            if (final > 0 && io.tools.some(tool => tool.name === 'browser_cart_quantity')) {
              issued.plans['intent:set-quantity'] = { name: 'browser_cart_quantity', input: { version: facts.cart.version, lineRef: row.ref, quantity: final } }
              candidates.push({ id: 'intent:set-quantity', description: `將購物車裡的${product.name}從${row.quantity}份改為總共${final}份，保留其他餐點與原配置。` })
              compiled = true
            }
          }
          if (/^(?:[請把將]|幫我)?(?:全部不要|刪掉|刪除|整項不要)了?$/.test(modification) && io.tools.some(tool => tool.name === 'browser_cart_remove')) {
            issued.plans['intent:remove-item'] = { name: 'browser_cart_remove', input: { version: facts.cart.version, lineRef: row.ref } }
            candidates.push({ id: 'intent:remove-item', description: `刪除購物車裡${product.name}的全部${row.quantity}份，保留其他餐點。` })
            compiled = true
          }
        }
        const remainder = transcript.replace(mentions[0].label, '').replaceAll(/[\s，,。！!？?]/g, '')
        if (/^(?:我要|我想要|給我|請給我|要|來)?$/.test(remainder)) {
          issued.plans['intent:ask-quantity'] = { name: 'browser_ask_quantity', input: { productRef: product.ref } }
          candidates.push({ id: 'intent:ask-quantity', description: `顧客要點${product.name}但尚未提供份數，先詢問份數；本次不加入購物車。` })
          compiled = true
        }
      }
      const clauses = transcript.split(/[，,、和]|還要|以及|加上/).map(clause => clause.trim()).filter(Boolean)
      if (clauses.length > 1 && clauses.length <= 3 && !io.hasPendingQuestion()) {
        const additions = clauses.map((clause) => {
          const matches = productMentions(catalog, clause)
          if (matches.length !== 1)
            return undefined
          const { product, label } = matches[0]
          const remainder = normalizeSlotNumbers(clause.replace(label, '')).replaceAll(/[\s。！!]/g, '')
          const count = remainder.match(/^(?:請幫我|請給我|幫我|給我|我要|我想要|再加|再來|[多加要來])?([1-9]\d?)份(?:謝謝)?$/)?.[1]
          const config = product.configurations.length === 1 ? product.configurations[0] : undefined
          if (!count || !config || config.variantRef || config.groups.some(group => group.required) || product.kind !== 'product' || product.priceType !== 1)
            return undefined
          return { version: facts.cart.version, productRef: product.ref, quantity: Number(count), unitPrice: config.unitPrice, note: '', selection: { version: config.version, variantRef: config.variantRef, choices: [] } }
        })
        if (additions.every(addition => addition !== undefined) && new Set(additions.map(addition => addition!.productRef)).size === additions.length) {
          issued.plans['intent:add-items'] = { name: 'browser_add_items', input: { items: additions.map(addition => ({ name: catalog.find(product => product.ref === addition!.productRef)!.name, quantity: addition!.quantity })) } }
          candidates.push({ id: 'intent:add-items', description: `依序新增顧客完整指定的全部餐點：${additions.map(addition => `${catalog.find(product => product.ref === addition!.productRef)!.name}${addition!.quantity}份`).join('、')}；不含其他修改或資訊需求。` })
          compiled = true
        }
      }
      return { phase: 'ordering', ...(interactionState ? { interactionState } : {}), ...(!compiled && !candidates.some(candidate => candidate.id !== 'intent:search-menu') ? { requiresPlanner: true } : {}), candidates, references, productResolution: { status: discovery.length > 5 ? 'overflow' : matched.length === 1 ? 'exact' : discovery.length ? 'possible' : 'none', count: discovery.length, references }, catalogEvidence: { products: discovery.slice(0, 5).map(({ product, label, source }) => ({ label: product.name, matchedText: label, source })), categories } }
    },
    async execute(input) {
      const current = issued
      issued = undefined // A selected candidate is one-use, even on rejection.
      if (!current)
        return { ok: false, effect: 'none', customerMessage: '菜單候選已失效，請重新確認。' }
      const plan = typeof input.candidateId === 'string' ? current.plans[input.candidateId] : undefined
      if (plan) {
        if (plan.name === 'service-new-request' || plan.name === 'service-item-information') {
          const raw = await io.read(tool('browser_cart_get'), { includeCatalog: true })
          io.releaseService?.(raw, String(plan.input.questionId))
          if (plan.name === 'service-new-request')
            return { ok: true, source: 'browser', dataOnly: true, needsAssistant: true }
          const result = await execute('browser_product_get', { names: plan.input.names })
          const summary = createMenuReplyWindow()
          summary.record('get_menu_item_details', result)
          return summary.hasReceipts() ? { ...result, customerMessage: summary.reply(), dataOnly: false } : { ...result, needsAssistant: true }
        }
        const result = await execute(plan.name, plan.input)
        if (input.candidateId === 'intent:read-item' || input.candidateId === 'intent:select-item') {
          const summary = createMenuReplyWindow()
          summary.record(input.candidateId === 'intent:read-item' ? 'get_menu_item_details' : 'open_menu_item_details', result)
          if (summary.hasReceipts())
            return { ...result, customerMessage: summary.reply(), dataOnly: false }
          return { ...result, needsAssistant: true }
        }
        return result
      }
      if (input.candidateId === 'intent:add-item' && current.add)
        return execute('browser_cart_add', current.add)
      if (input.candidateId !== 'intent:search-menu')
        return { ok: false, effect: 'none', customerMessage: '目前無法直接執行這項需求。' }
      // Read evidence can inform Main, but a partial lookup cannot pretend to
      // have answered a compound request, an option question or a comparison.
      const result = await execute('names' in current.read ? 'browser_product_get' : 'browser_observe', current.read)
      if (!current.plainMenu)
        return { ...(result && typeof result === 'object' ? result : {}), needsAssistant: true }
      if (result && typeof result === 'object' && 'ok' in result && result.ok === true)
        return execute('browser_present', { productRefs: current.productRefs.slice(0, 10), mode: 'information' })
      return result
    },
  }
}
