import type { SystemOneQuestion, SystemOneResponse } from '.'

import { array, literal, maxValue, minValue, number, object, parse, pipe, string } from 'valibot'

const probability = pipe(number(), minValue(0), maxValue(1))
const responseSchema = object({ answers: array(object({ name: string(), type: literal('choice'), choice: string(), confidence: probability, probabilities: array(object({ value: string(), probability })) })) })

/** Compiles only supported finite choices into the native OpenAI Decisions protocol. */
export function createDecisionsRequest(modelId: string, state: string, questions: Record<string, SystemOneQuestion>) {
  const entries = Object.entries(questions)
  if (!entries.length || entries.length > 400)
    throw new Error('Decisions requires 1–400 questions')
  return {
    model: modelId,
    input: state,
    questions: entries.map(([name, question]) => {
      if (question.type !== 'choice' || !question.criteria || !/^[\w-]{1,64}$/.test(name))
        throw new Error('Decisions supports named finite choice questions in this integration')
      const entries = Array.isArray(question.criteria) ? question.criteria.map(value => [value, value] as const) : Object.entries(question.criteria)
      if (entries.length < 2 || entries.length > 255 || new Set(entries.map(([id]) => id)).size !== entries.length)
        throw new Error('Decisions requires 2–255 unique choices; truncation is forbidden')
      return { name, type: 'choice' as const, instructions: question.instructions, choices: entries.map(([value, description]) => ({ value, description })) }
    }),
  }
}

/** Matches every named answer to its issued choices without inventing confidence. */
export function readDecisions(raw: unknown, request: ReturnType<typeof createDecisionsRequest>): SystemOneResponse {
  const result = parse(responseSchema, raw)
  if (result.answers.length !== request.questions.length || new Set(result.answers.map(answer => answer.name)).size !== result.answers.length)
    throw new Error('Decisions returned missing or duplicate answers')
  const answers = request.questions.map((question) => {
    const answer = result.answers.find(answer => answer.name === question.name)
    const allowed = question.choices.map(choice => choice.value)
    if (!answer || !allowed.includes(answer.choice) || answer.probabilities.length !== allowed.length || new Set(answer.probabilities.map(choice => choice.value)).size !== allowed.length || answer.probabilities.some(choice => !allowed.includes(choice.value)))
      throw new Error('Decisions returned an unissued choice or incomplete probabilities')
    return [question.name, { type: 'choice', choice: answer.choice, confidence: answer.confidence, probabilities: Object.fromEntries(answer.probabilities.map(choice => [choice.value, choice.probability])) }]
  })
  return { answers: Object.fromEntries(answers) }
}
