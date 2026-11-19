import type { InferOutput } from 'valibot'

import type { AdditionProposal, OrderSlot, QuestionSnapshot } from './browserQuestionWindow'

import { explicitServingQuantities, normalizeSlotNumbers } from '@proj-airi/stage-shared/ordering-slots'
import { parsePbDumplingOrder, parsePbDumplingServings, pbDumplingExtraName, pbProductName } from '@proj-airi/stage-shared/pb-menu-presentation'
import { productConfigurationSchema } from '@proj-airi/stage-shared/product-configuration'
import { resolveSelection } from '@proj-airi/stage-ui/services/pbProduct'
import { array, integer, looseObject, maxLength, maxValue, minLength, minValue, nullable, number, optional, parse, pipe, strictObject, string } from 'valibot'

import { cartSnapshotSchema } from '../../../server/src/services/domain/browser-ordering/contracts'

export const orderFactsSchema = looseObject({ cart: cartSnapshotSchema, products: array(looseObject({ ref: string(), name: string(), aliases: optional(array(string())), price: number(), configurations: array(productConfigurationSchema) })) })
const count = pipe(number(), integer(), minValue(1), maxValue(99))
const ref = pipe(string(), minLength(1), maxLength(200))
const lineSchema = strictObject({ productRef: ref, evidence: pipe(string(), minLength(1), maxLength(2000)), quantity: nullable(count), choices: pipe(array(strictObject({ ref, quantity: nullable(pipe(number(), integer(), minValue(1), maxValue(100))) })), maxLength(100)), askGroups: pipe(array(ref), maxLength(40)), note: pipe(string(), maxLength(200)) })
const inputSchema = strictObject({ lines: pipe(array(lineSchema), minLength(1), maxLength(10)) })
type Draft = InferOutput<typeof lineSchema> & { id: string }

/**
 * Owns unfinished dishes, not vendor effects. A manual cart/configuration/visitor
 * change discards the whole queue. Completed fields return proposals for the Host
 * to admit and execute, without requesting the same purchase consent again.
 */
export function createBrowserOrderDrafts() {
  let state: { binding: QuestionSnapshot, lines: Draft[] } | undefined

  function current(binding: QuestionSnapshot) {
    if (state && (state.binding.owner !== binding.owner || state.binding.documentId !== binding.documentId || state.binding.cartVersion !== binding.cartVersion || !state.binding.products.every(product => binding.products.some(fresh => JSON.stringify(fresh) === JSON.stringify(product)))))
      state = undefined
    return state
  }

  return {
    reset() { state = undefined },
    collect(raw: unknown, binding: QuestionSnapshot, input: unknown, source: string, provided?: { productRef: string, quantity?: number, answer?: string }) {
      const facts = parse(orderFactsSchema, raw)
      const proposal = parse(inputSchema, input)
      const lines = proposal.lines.map((line): Draft => {
        const product = facts.products.find(product => product.ref === line.productRef)
        const configuration = product?.configurations.length === 1 ? product.configurations[0] : undefined
        const answerEvidence = provided?.productRef === line.productRef && provided.answer?.includes(line.evidence)
        if (!product || !configuration || (!source.includes(line.evidence) && !answerEvidence))
          throw new Error('請保留顧客原句片段，並使用最新商品與規格。')
        const spokenName = pbProductName(product.name)
        // Removing PB's minimum notice gives this product its customer-facing
        // name, not a guessed fragment. A colliding current name stays ambiguous.
        const spokenMatch = spokenName !== product.name && source.includes(spokenName)
          && facts.products.filter(candidate => pbProductName(candidate.name) === spokenName).length === 1
        if (!source.replaceAll(/\s/g, '').includes(product.name.replaceAll(/\s/g, '')) && !spokenMatch && provided?.productRef !== product.ref)
          throw new Error('這道餐點尚未由顧客選定，請先確認品名。')
        if (line.note && !source.includes(line.note))
          throw new Error('備註必須來自顧客原句。')
        const quantities = explicitServingQuantities(line.evidence, { productName: product.name })
        const label = [product.name, pbProductName(product.name), ...(product.aliases ?? [])].find(label => line.evidence.includes(label)) ?? ''
        const dumplings = parsePbDumplingServings(line.evidence, product.name, label)
        let quantity: number | null = null
        if (dumplings) {
          // This product's explicit total-piece convention is one serving when
          // no serving count is spoken; other products never inherit that rule.
          quantity = dumplings.quantity
        }
        else if (provided?.productRef === product.ref && provided.quantity !== undefined && proposal.lines.filter(candidate => candidate.productRef === product.ref).length === 1) {
          // A current, bound quantity answer supplements the original request.
          quantity = provided.quantity
        }
        else if (line.quantity !== null && quantities.includes(line.quantity)) {
          quantity = line.quantity
        }
        const known = configuration.groups.flatMap(group => group.choices)
        if (new Set(line.choices.map(choice => choice.ref)).size !== line.choices.length || line.choices.some(choice => !known.some(option => option.ref === choice.ref)) || line.askGroups.some(ref => !configuration.groups.some(group => group.ref === ref)))
          throw new Error('選項必須使用目前商品的真實群組與選項參照。')
        // Single-dish fields may cite different spans of the same utterance.
        // Split configurations must retain their own span to avoid sharing extras.
        const optionSource = proposal.lines.length === 1 ? source : line.evidence
        const productAt = optionSource.indexOf(product.name)
        const beforeProduct = normalizeSlotNumbers(optionSource.slice(0, productAt)).trim()
        const afterProduct = normalizeSlotNumbers(optionSource.slice(productAt + product.name.length)).trim()
        const includesMealName = productAt >= 0 && (/\d+份$/.test(beforeProduct) || /^\d+份/.test(afterProduct) || /^(?:我要|我想要|要|請給我)?$/.test(beforeProduct))
        const optionEvidence = normalizeSlotNumbers(includesMealName ? optionSource.replace(product.name, '') : optionSource)
        const optionCounts = [...optionEvidence.matchAll(/(\d+)\s*[顆個杯碗]/g)].map(match => Number(match[1]))
        const unansweredGroups = new Set(line.askGroups)
        let choices: Draft['choices']
        if (dumplings) {
          const extras = known.filter(option => option.name === pbDumplingExtraName)
          if (extras.length !== 1 || dumplings.extra > extras[0].maximum)
            throw new Error('網站水餃加量選項或上限已變更，請先確認。')
          const extra = extras[0]
          if (line.choices.some(choice => choice.ref !== extra.ref || (choice.quantity !== null && choice.quantity !== dumplings.extra)))
            throw new Error('每份水餃顆數與指定加量不一致，請重新確認。')
          // Total pieces already include the base eight; the merchant option
          // stores only per-serving extras, never total pieces or multiplied servings.
          choices = dumplings.extra ? [{ ref: extra.ref, quantity: dumplings.extra }] : []
          unansweredGroups.delete(configuration.groups.find(group => group.choices.some(option => option.ref === extra.ref))!.ref)
        }
        else {
          choices = line.choices.flatMap((choice) => {
            const option = known.find(option => option.ref === choice.ref)!
            if (choice.quantity !== null && choice.quantity > option.maximum)
              throw new Error(`「${option.name}」數量超過上限。`)
            const group = configuration.groups.find(group => group.choices.some(candidate => candidate.ref === choice.ref))!
            if (!optionEvidence.includes(normalizeSlotNumbers(option.name))) {
              unansweredGroups.add(group.ref)
              return [] // A model-picked choice without customer evidence remains a group question.
            }
            const explicitSingle = group.maximum === 1
            return [{ ...choice, quantity: choice.quantity !== null && (optionCounts.includes(choice.quantity) || explicitSingle) ? choice.quantity : null }]
          })
        }
        // Choosing an option resolves its group even when its count is pending.
        // A model may mention both; do not ask the same group again afterward.
        const askGroups = [...unansweredGroups].filter(ref => !configuration.groups.find(group => group.ref === ref)!.choices.some(option => choices.some(choice => choice.ref === option.ref)))
        return { ...line, quantity, choices, askGroups, id: crypto.randomUUID() }
      })
      // Commit only after validating every line; a bad later item cannot erase
      // a valid existing queue or leave the first proposed item half-installed.
      const refs = new Set(lines.map(line => line.productRef))
      state = { binding: structuredClone({ ...binding, products: binding.products.filter(product => refs.has(product.productRef)) }), lines }
    },
    projection(binding: QuestionSnapshot) {
      return current(binding)?.lines.map(line => ({ id: line.id, productRef: line.productRef, quantity: line.quantity ?? undefined, choices: structuredClone(line.choices), note: line.note }))
    },
    next(raw: unknown, binding: QuestionSnapshot): { slot: OrderSlot } | { proposals: AdditionProposal[] } | undefined {
      const order = current(binding)
      if (!order)
        return
      const facts = parse(orderFactsSchema, raw)
      const proposals: AdditionProposal[] = []
      for (const line of order.lines) {
        const product = facts.products.find(product => product.ref === line.productRef)!
        const configuration = product.configurations[0]
        const slot = { draftId: line.id, productRef: product.ref, name: product.name }
        // The native add-on is stored as extra pieces, but customers order totals.
        // Bind this wording only to the verified eight-piece product and option.
        const pieceGroup = configuration.groups.find(group => group.choices.length === 1 && group.choices[0].name === pbDumplingExtraName)
        if (product.name === '周氏水餃(最低8顆)' && pieceGroup
          && (line.quantity === null || line.askGroups.includes(pieceGroup.ref) || line.choices.some(choice => choice.ref === pieceGroup.choices[0].ref && choice.quantity === null))) {
          const maximum = 8 + Math.min(pieceGroup.maximum, pieceGroup.choices[0].maximum)
          return { slot: { ...slot, kind: 'dumpling-pieces', groupRef: pieceGroup.ref, maximum, question: `周氏水餃${line.quantity === null ? '每份至少8顆，您要幾顆、幾份？例如10顆2份。' : `已選${line.quantity}份，每份要幾顆？例如10顆；正常是8顆。`}`, choices: [] } }
        }
        if (line.quantity === null)
          return { slot: { ...slot, kind: 'quantity', maximum: 99, question: `請問「${pbProductName(product.name)}」要幾份？`, choices: [] } }
        for (const choice of line.choices) {
          if (choice.quantity !== null)
            continue
          const group = configuration.groups.find(group => group.choices.some(option => option.ref === choice.ref))!
          const option = group.choices.find(option => option.ref === choice.ref)!
          const used = line.choices.filter(other => other.ref !== choice.ref && group.choices.some(option => option.ref === other.ref)).reduce((sum, choice) => sum + (choice.quantity ?? 0), 0)
          const maximum = Math.min(option.maximum, group.maximum - used)
          if (maximum < 1)
            throw new Error(`「${group.name}」已超過可選數量，請重新確認。`)
          return { slot: { ...slot, kind: 'choice-quantity', groupRef: group.ref, choiceRef: choice.ref, maximum, question: `「${pbProductName(product.name)}」每份要加幾個「${option.name}」？${option.unitPrice ? `每個 ${option.unitPrice} 元，` : ''}最多 ${maximum} 個。`, choices: group.required ? [] : [{ id: 'none', description: `這份餐點不加「${option.name}」。` }] } }
        }
        for (const group of configuration.groups) {
          const used = line.choices.filter(choice => group.choices.some(option => option.ref === choice.ref)).reduce((sum, choice) => sum + (choice.quantity ?? 0), 0)
          if (used > group.maximum)
            throw new Error(`「${group.name}」超過可選數量。`)
          if ((!group.required || used === group.maximum) && !line.askGroups.includes(group.ref))
            continue
          const available = group.choices.filter(option => (line.choices.find(choice => choice.ref === option.ref)?.quantity ?? 0) < option.maximum)
          const remaining = group.maximum - used
          return { slot: { ...slot, kind: 'group', groupRef: group.ref, maximum: remaining, question: `「${pbProductName(product.name)}」的「${group.name}」要選${available.map(choice => choice.name).join('、')}，哪一項？${group.required ? `還需選 ${remaining} 個。` : '也可以說不加。'}`, choices: [...available.map(choice => ({ id: `option:${choice.ref}`, description: `${choice.name}${choice.unitPrice ? `，每個加 ${choice.unitPrice} 元` : ''}` })), ...(!group.required ? [{ id: 'none', description: `不選「${group.name}」的額外選項。` }] : [])] } }
        }
        const selection = { version: configuration.version, variantRef: configuration.variantRef, choices: line.choices.map(choice => ({ ref: choice.ref, quantity: choice.quantity! })) }
        const selected = resolveSelection(configuration, selection, line.note)
        const options = selected.choices.map(choice => ({ name: configuration.groups.flatMap(group => group.choices).find(option => option.ref === choice.ref)!.name, quantity: choice.quantity }))
        const optionSummary = options.map(option => `${option.name} 每份 ${option.quantity} 個`).join('、')
        proposals.push({ productRef: product.ref, productName: product.name, quantity: line.quantity, unitPrice: selected.unitPrice, note: line.note, optionSummary, options, selection })
      }
      return { proposals }
    },
    fill(raw: unknown, binding: QuestionSnapshot, slot: OrderSlot, value: number | string) {
      const line = current(binding)?.lines.find(line => line.id === slot.draftId && line.productRef === slot.productRef)
      if (!line)
        return false
      if (slot.kind === 'dumpling-pieces') {
        if (typeof value !== 'string')
          return false
        const basic = /^(?:正常|基本|原本)[。！!，,\s]*$/.test(value.trim())
        const parsed = parsePbDumplingOrder(basic ? '8顆' : value, slot.name, '')
        if (!parsed || parsed.some(serving => serving.piecesPerServing > slot.maximum))
          return false
        const product = parse(orderFactsSchema, raw).products.find(product => product.ref === line.productRef)!
        const group = product.configurations[0].groups.find(group => group.ref === slot.groupRef)!
        const extra = group.choices[0]
        const completed = parsed.map(serving => ({
          ...line,
          id: crypto.randomUUID(),
          // A piece-only answer preserves previously stated servings. Split
          // answers own separate counts, rather than multiplying every clause.
          quantity: parsed.length === 1 && !normalizeSlotNumbers(value).includes('份') ? line.quantity ?? serving.quantity : serving.quantity,
          choices: [...line.choices.filter(choice => choice.ref !== extra.ref), ...(serving.extra ? [{ ref: extra.ref, quantity: serving.extra }] : [])],
          askGroups: line.askGroups.filter(ref => ref !== group.ref),
        }))
        const order = current(binding)!
        order.lines.splice(order.lines.indexOf(line), 1, ...completed)
        return true
      }
      if (slot.kind === 'quantity') {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > slot.maximum)
          return false
        line.quantity = value
        return true
      }
      const product = parse(orderFactsSchema, raw).products.find(product => product.ref === line.productRef)!
      const group = product.configurations[0].groups.find(group => group.ref === slot.groupRef)!
      if (value === 'none' && !group.required) {
        line.askGroups = line.askGroups.filter(ref => ref !== group.ref)
        if (slot.choiceRef)
          line.choices = line.choices.filter(choice => choice.ref !== slot.choiceRef)
        return true
      }
      if (slot.kind === 'choice-quantity') {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > slot.maximum)
          return false
        line.choices.find(choice => choice.ref === slot.choiceRef)!.quantity = value
        return true
      }
      const option = group.choices.find(choice => value === `option:${choice.ref}`)
      if (!option)
        return false
      const previous = line.choices.find(choice => choice.ref === option.ref)
      const remaining = Math.min(option.maximum - (previous?.quantity ?? 0), slot.maximum)
      if (remaining < 1)
        return false
      line.askGroups = line.askGroups.filter(ref => ref !== group.ref)
      if (previous)
        previous.quantity = (previous.quantity ?? 0) + 1
      else
        line.choices.push({ ref: option.ref, quantity: remaining === 1 ? 1 : null })
      return true
    },
  }
}

/** Closed slot answers update a draft only; a later complete confirmation authorizes writes. */
export function orderSlotCount(text: string, slot: OrderSlot) {
  if (slot.kind === 'group' || slot.kind === 'dumpling-pieces')
    return
  const spoken = text.trim().startsWith(slot.name) ? text.trim().slice(slot.name.length) : text.trim()
  const normalized = normalizeSlotNumbers(spoken.replace(/^(?:另一個|另一份)/, '')).replaceAll(/\s/g, '')
  const pattern = slot.kind === 'quantity'
    ? /^(?:另一個|另一份|這個|這份)?也?(?:我要|請給我|要|來|給我)?([1-9]\d?)[份個碗杯]?(?:就好|謝謝)?[。！!，,]*$/
    : /^(?:每份|1份)?(?:加|要|再加|加上)?([1-9]\d?|100)[顆個份]?(?:就好|謝謝)?[。！!，,]*$/
  const matched = normalized.match(pattern)
  const quantity = matched ? Number(matched[1]) : undefined
  return quantity && quantity <= slot.maximum ? quantity : undefined
}
