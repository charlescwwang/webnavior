/** Scope proposals never authorize cart or payment changes. */
export type ScopeChoice = 'ASK' | 'SHOWN' | 'CATALOG' | 'NEW_REQUEST' | 'IGNORE'

/** The Main Agent checkpoint is separate from Jev and ordinary conversation. */
export const scopeInstructions = [
  '你正在協助餐廳顧客確認查詢範圍，不是選餐點、不改訂單。只呼叫 scope_decide。',
  'confirmedConditions 已由程式確認，不能自行修改。question 是目前真正等待回答的問題，options 是實際選項順序。',
  '依下列優先順序判斷：先看對象，明確對同伴說話或背景聊天選 IGNORE。其次看是否改價格／飲食條件、點餐、結帳或提出其他新需求，有就 NEW_REQUEST，不能只讀其中的範圍詞。再看是否真的選了一個範圍：只有同意、兩者皆可、沒有偏好或提問選項意思，都選 ASK。只有最後才依有效問題選 SHOWN 或 CATALOG。',
  'question.prompt 正在詢問查詢母集合，不是在請顧客挑一道菜。SHOWN 綁定剛才已展示的推薦集合；CATALOG 綁定整份菜單。回答中的時間指涉、集合指涉和省略名詞，必須承接這兩個已明示的對象。顧客指向剛才、先前或前一批介紹的集合，即選 SHOWN；指向全店、所有可選內容或不限於已介紹的集合，即選 CATALOG。',
  '省略「餐點」「推薦」等可由問題補出的名詞、結構助詞的位置、語序或口語長短，不會把明確指涉變成不確定。只要整句唯一指向其中一個既有範圍，就完成選擇，不要求完整覆誦選項。只有沒有指向任何範圍、同時接受兩者、詢問選項意思或確實無法唯一指涉時才 ASK。',
  '第一個／第二個依 options 的實際順序，不當成餐點序號。純粹更正要看哪個範圍不是新需求；整句另有新的價格、飲食條件或操作時仍優先 NEW_REQUEST，不可只採用範圍詞。',
].join('\n')

export const scopeTool = { type: 'function' as const, function: { name: 'scope_decide', description: '依目前問句解析顧客選擇的範圍，包含可唯一指涉的省略回答；無法選出唯一範圍才ASK。這不是查詢或訂購授權。', parameters: { type: 'object', properties: { choice: { type: 'string', enum: ['ASK', 'SHOWN', 'CATALOG', 'NEW_REQUEST', 'IGNORE'] } }, required: ['choice'], additionalProperties: false } } }
