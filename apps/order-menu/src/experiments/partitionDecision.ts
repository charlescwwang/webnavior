import type { SystemOneQuestion } from '../../../server/src/services/domain/kiosk-system-one'

import { decideInteraction } from '../../../server/src/services/domain/kiosk-interaction-decision'

type Input = Parameters<typeof decideInteraction>[0]

/** Test-only semantic partitions. These are not tools or new production intents. */
export const partitions = {
  READ: '向店員／本機查餐點、分類、售價、瀏覽或請推薦；不要求新增或修改訂單。只說想吃某分類、沒指定數量，是瀏覽。',
  CHANGE: '向店員／本機明確要求一個獨立的狀態變更：新增餐點、修改數量／選項、移除、用餐方式或結帳。新增的數量與條件是同一需求；替換餐點不等於只新增。',
  ANSWER: '依目前有效問題或畫面回答省略值、確認、拒絕或指代，沒有提出另外的獨立需求。正在回答不等於同意；只能承接問題明示的效果。',
  ASSISTANCE: '有效點餐服務需要解釋、未提供的資料、核對漏單、替換餐點、多個獨立要求，或現有有限操作不能完整處理。保留整句，不擅自只做一部分。',
  BACKGROUND: '對同伴說話或非點餐服务閒聊，包括提到餐點但沒有向本機提出需求，以及對已完成資訊回答單純附和。',
  UNFINISHED: '向本機點餐但話語本身明顯中斷、尚未說完。缺數量、唯一品項或選項不是話語中斷；完整的偏好、查詢或漏單回報不是此項。',
  UNCERTAIN: '不能可靠區分上述語意，或省略回答沒有可確認的有效問題／reference；不猜服務需求，不授權操作。',
} as const

const readIds = new Set(['intent:search-menu', 'intent:recommend', 'intent:recommend-more', 'intent:show-recommendations', 'intent:view-cart', 'intent:select-item', 'intent:return-menu', 'intent:scroll-menu:up', 'intent:scroll-menu:down'])
const leafAbstention = {
  NEEDS_ASSISTANT: '整句服務需求不能由列出的單一效果完整處理，或指定reference無法確認；交接整句，不補猜商品或操作。',
  UNCERTAIN: '無法可靠選擇本句的具體效果，不能因某個候選合法就選它。',
}

/**
 * Replaces only the ordinary route question with a partition then a finite leaf.
 * The production decision still owns condition/question checks; the real Menu
 * resolver/compiler/guard still owns targets, slots and execution. No reviewer,
 * generated plan or phrase-specific dispatch rule is added.
 */
export async function decidePartitioned(input: Input) {
  const emissions: Array<{ partition?: string, confidence?: number, leaf?: string, leafConfidence?: number }> = []
  const decision = await decideInteraction({
    ...input,
    invoke: async (state, questions) => {
      // Special configuration/clarification/confirmation protocols are unchanged.
      // Never regroup a one-use payment confirmation as ordinary ordering.
      if (!questions.route || input.decisionState?.phase !== 'ordering' || input.review)
        return await input.invoke(state, questions)
      const groupQuestion: SystemOneQuestion = {
        type: 'choice',
        instructions: '只看最後一句顧客語音，角色對話、真實references與有效問題只解釋語境，不強制先回答舊問題。先選整句的服務效果種類；不能因缺資料就當成沒說完。反悔後以最後明確需求為準。你不解析target、數量或工具，也不授權訂購。多個獨立要求、漏單核對與替換必須保留整句交接。只選提供的種類。',
        criteria: partitions,
      }
      const raw = (await input.invoke(state, { partition: groupQuestion })).answers?.partition
      const group = raw && typeof raw === 'object' ? raw as { choice?: unknown, confidence?: unknown } : undefined
      const choice = typeof group?.choice === 'string' ? group.choice : undefined
      const confidence = typeof group?.confidence === 'number' ? group.confidence : undefined
      const emission = { partition: choice, confidence } as typeof emissions[number]
      emissions.push(emission)
      // One frozen threshold for all groups; no post-result calibration. Missing
      // confidence/unknown choices become invalid-route abstention, not a claim
      // that the provider was unreachable or that the user was background.
      if (!choice || !Object.hasOwn(partitions, choice) || confidence === undefined || !Number.isFinite(confidence) || confidence < 0.6 || confidence > 1 || choice === 'UNCERTAIN')
        return { answers: { route: { choice: 'UNCERTAIN', confidence } } }
      if (choice === 'BACKGROUND' || choice === 'UNFINISHED' || choice === 'ASSISTANCE') {
        const route = choice === 'BACKGROUND' ? 'IGNORE' : choice === 'UNFINISHED' ? 'INCOMPLETE' : 'NEEDS_ASSISTANT'
        return { answers: { route: { choice: route, confidence } } }
      }
      const questionIds = new Set(input.decisionState?.waitingFor?.choices.map(answer => answer.id) ?? [])
      const available = Object.entries(questions.route.criteria ?? {}).filter(([id]) => {
        if (choice === 'ANSWER')
          return questionIds.has(id)
        if (choice === 'READ')
          return readIds.has(id)
        // CHANGE never borrows invitation/defer choices or read actions. The
        // action set is application-issued; an absent intent is not invented.
        return input.candidates.some(candidate => candidate.id === id) && !readIds.has(id) && id !== 'intent:defer-question'
      })
      if (!available.length)
        return { answers: { route: { choice: 'NEEDS_ASSISTANT', confidence } } }
      const leafQuestion: SystemOneQuestion = {
        type: 'choice',
        instructions: '判斷最後一句的具體效果。上一步只選範圍，不是操作授權；你可以拒絕錯誤範圍。只選本次提供的合法候選，不猜商品或參數。整句不能完整表示或需要核對時選NEEDS_ASSISTANT；無法確定選UNCERTAIN。',
        criteria: { ...Object.fromEntries(available), ...leafAbstention },
      }
      const leafRaw = (await input.invoke(state, { effect: leafQuestion })).answers?.effect
      const leaf = leafRaw && typeof leafRaw === 'object' ? leafRaw as { choice?: unknown, confidence?: unknown } : undefined
      emission.leaf = typeof leaf?.choice === 'string' ? leaf.choice : undefined
      emission.leafConfidence = typeof leaf?.confidence === 'number' ? leaf.confidence : undefined
      if (!emission.leaf || !Object.hasOwn(leafQuestion.criteria!, emission.leaf)
        || emission.leafConfidence === undefined || !Number.isFinite(emission.leafConfidence) || emission.leafConfidence < 0.6 || emission.leafConfidence > 1) {
        return { answers: { route: { choice: 'UNCERTAIN', confidence: emission.leafConfidence } } }
      }
      // This minimum is a conservative dispatch heuristic, NOT a calibrated
      // joint probability. The raw scores remain separately recorded.
      return { answers: { route: { choice: emission.leaf, confidence: Math.min(confidence, emission.leafConfidence) } } }
    },
  })
  return { decision, emissions }
}
