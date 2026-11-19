import type { PresentedQuestion } from '../../../server/src/services/domain/kiosk-interaction-decision/contracts'

import { normalizeSlotNumbers } from '@proj-airi/stage-shared/ordering-slots'
import { resolveTableName } from '@proj-airi/stage-shared/table-names'
import { array, literal, object, optional, safeParse, string } from 'valibot'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'

const entrySchema = object({ page: literal('table'), tableChoices: array(string()), selectedTable: optional(string()) })
const messages = orderingMessages['zh-Hant'].tableConfirmation

/** Missing separators suggest current split tables only; an exact table always wins. */
export function approximateTables(transcript: string, choices: readonly string[]): string[] {
  const text = normalizeSlotNumbers(transcript).toUpperCase().replaceAll(/[\s，,。！!]/g, '')
  // Whole table requests only: negation, corrections, food and multiple codes
  // must retain their full meaning instead of becoming a guessed selection.
  const code = text.match(/^(?:請幫我|幫我|我要坐|我要|我想要|我的桌號是|桌號是|我在|我們在|請選|選擇|選)?([A-Z]+\d+)(?:號桌|桌|號)?(?:(?:請|幫我|我要)?開始(?:點餐)?吧?)?$/)?.[1]
  // Even duplicate exact spellings must stay in the explicit-table flow; they
  // are ambiguity to resolve, not evidence that only a split table exists.
  if (!code || choices.some(choice => resolveTableName(code, [choice])))
    return []
  return choices.filter((name) => {
    const split = normalizeSlotNumbers(name).toUpperCase().replaceAll(/[\s()（）]/g, '').replaceAll(/[‐‑–—－之]/g, '-').match(/^([A-Z]+)(\d+(?:-\d+)+)(?:桌|號桌|號|吧檯|BAR|TABLE)?$/)
    return split && `${split[1]}${split[2].split('-').map(segment => Number(segment)).join('')}` === code
  })
}

/** Owns a one-use spoken table confirmation, isolated by visitor, document and live selector state. */
export function createTableSelection(io: { owner: () => string | undefined, documentId: () => string | undefined }, now = Date.now) {
  let ticket: { owner: string, documentId: string, state: string, request: string, names: string[], question: PresentedQuestion } | undefined

  function current(raw: unknown) {
    const entry = safeParse(entrySchema, raw)
    // A manual table change, list refresh, navigation or new reception revokes
    // consent. A short "yes" cannot silently attach to a newer selector state.
    if (!ticket || !entry.success || ticket.owner !== io.owner() || ticket.documentId !== io.documentId()
      || ticket.question.expiresAt <= now() || ticket.state !== JSON.stringify(entry.output)) {
      ticket = undefined
      return
    }
    return ticket
  }

  function choice(transcript: string, pending: NonNullable<typeof ticket>) {
    const text = transcript.trim().replace(/[。！!，,\s]+$/, '')
    if (/^(?:[對是好]|好的|沒錯|正確|確認|就是這桌|就是那桌|就是那一桌|是這桌)$/.test(text)
      && pending.question.choices.some(choice => choice.id === 'yes')) {
      return 'yes'
    }
    if (/^(?:不是|不對|不要|不是這桌|不是那桌|取消|先不要)$/.test(text))
      return 'no'
    const name = resolveTableName(text, pending.names)
    if (name)
      return pending.names.length === 1 ? 'yes' : `table:${pending.names.indexOf(name)}`
    const ordinal = normalizeSlotNumbers(text).match(/^第([1-9]\d?)個$/)?.[1]
    if (ordinal && pending.names.length > 1 && Number(ordinal) <= pending.names.length)
      return `table:${Number(ordinal) - 1}`
  }

  return {
    reset: () => { ticket = undefined },
    hasPending: () => Boolean(ticket && ticket.owner === io.owner() && ticket.documentId === io.documentId() && ticket.question.expiresAt > now()),
    pending: (raw: unknown) => current(raw)?.question,
    canAnswer(raw: unknown, transcript: string) {
      const pending = current(raw)
      return Boolean(pending && choice(transcript, pending))
    },
    /** Issues a question, never a native table action or Start instruction. */
    offer(raw: unknown, transcript: string) {
      const entry = safeParse(entrySchema, raw)
      const owner = io.owner()
      const documentId = io.documentId()
      if (!entry.success || !owner || !documentId)
        return
      const names = approximateTables(transcript, entry.output.tableChoices)
      // PresentedQuestion has a bounded choice list; an oversized collision is
      // left to the original explicit-table flow, never silently truncated.
      if (!names.length || names.length > 19)
        return
      const pending = current(raw)
      if (pending?.request === transcript)
        return pending.question
      const question = names.length === 1 ? messages.single.replace('{table}', names[0]) : messages.multiple.replace('{tables}', names.join('、'))
      if (question.length > 500)
        return
      const choices = names.length === 1
        ? [{ id: 'yes', description: messages.select.replace('{table}', names[0]) }]
        : names.map((name, index) => ({ id: `table:${index}`, description: messages.select.replace('{table}', name) }))
      ticket = { owner, documentId, state: JSON.stringify(entry.output), request: transcript, names, question: { questionId: crypto.randomUUID(), purpose: 'browser-table-confirmation', question, expiresAt: now() + 120000, choices: [...choices, { id: 'no', description: messages.decline }] } }
      return ticket.question
    },
    /** Consumes only an issued answer ID or a complete literal answer to that same live question. */
    answer(raw: unknown, transcript: string, selected?: { questionId: string, choiceId: string }) {
      const pending = current(raw)
      if (!pending)
        return
      let id: string | undefined
      if (selected) {
        if (selected.questionId === pending.question.questionId)
          id = selected.choiceId
      }
      else {
        id = choice(transcript, pending)
      }
      if (!id || !pending.question.choices.some(choice => choice.id === id))
        return
      ticket = undefined
      if (id === 'no')
        return { declined: true as const }
      const index = id === 'yes' ? 0 : Number(id.slice('table:'.length))
      return { name: pending.names[index] }
    },
  }
}
