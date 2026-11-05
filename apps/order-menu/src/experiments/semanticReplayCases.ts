export type Setup = 'empty' | 'fulfillment' | 'checkout' | 'party' | 'invitation'
export interface SemanticReplayCase {
  id: string
  transcript: string
  setup: Setup
  expected: string
  partition: 'development' | 'holdout'
}

// Written before running either variant. Holdout wording must not be used to
// tune the proposal after its results are visible.
export const semanticReplayCases: SemanticReplayCase[] = [
  { id: 'query-alone', transcript: '有牛肉麵嗎？', setup: 'empty', expected: 'intent:search-menu', partition: 'development' },
  { id: 'query-after-adds', transcript: '有牛肉麵嗎？', setup: 'fulfillment', expected: 'intent:search-menu', partition: 'development' },
  { id: 'query-at-checkout', transcript: '有牛肉麵嗎？', setup: 'checkout', expected: 'intent:search-menu', partition: 'development' },
  { id: 'add-name', transcript: '我想吃牛肉麵', setup: 'fulfillment', expected: 'intent:add-item', partition: 'development' },
  { id: 'add-alias', transcript: '排骨便當來一份', setup: 'empty', expected: 'intent:add-item', partition: 'development' },
  { id: 'category-alone', transcript: '我想吃麵', setup: 'fulfillment', expected: 'intent:search-menu', partition: 'development' },
  { id: 'category-quantity', transcript: '我想吃麵，一碗', setup: 'fulfillment', expected: 'intent:add-item', partition: 'development' },
  { id: 'add-interruption', transcript: '再加一份水餃', setup: 'checkout', expected: 'intent:add-item', partition: 'development' },
  { id: 'modify', transcript: '水餃改兩份', setup: 'fulfillment', expected: 'intent:set-quantity', partition: 'development' },
  { id: 'remove', transcript: '水餃不要了', setup: 'fulfillment', expected: 'intent:remove-item', partition: 'development' },
  { id: 'view-item', transcript: '看牛肉麵', setup: 'fulfillment', expected: 'intent:select-item', partition: 'development' },
  { id: 'fulfillment-answer', transcript: '內用', setup: 'fulfillment', expected: 'intent:set-fulfillment:dine-in', partition: 'development' },
  { id: 'delayed-party-answer', transcript: '一位', setup: 'party', expected: 'intent:set-party-size', partition: 'development' },
  { id: 'checkout-consent', transcript: '好', setup: 'checkout', expected: 'intent:start-checkout', partition: 'development' },
  { id: 'checkout-refusal', transcript: '先不要', setup: 'checkout', expected: 'intent:defer-question', partition: 'development' },
  { id: 'invitation-consent', transcript: '好啊', setup: 'invitation', expected: 'intent:recommend', partition: 'development' },
  { id: 'invitation-refusal', transcript: '不用', setup: 'invitation', expected: 'IGNORE', partition: 'development' },
  { id: 'recommend', transcript: '推薦幾樣餐點', setup: 'empty', expected: 'intent:recommend', partition: 'development' },
  { id: 'query-price', transcript: '牛肉麵多少錢？', setup: 'fulfillment', expected: 'intent:search-menu', partition: 'holdout' },
  { id: 'query-portion', transcript: '水餃一份有幾顆？', setup: 'checkout', expected: 'intent:search-menu', partition: 'holdout' },
  { id: 'add-colloquial', transcript: '來碗牛肉麵', setup: 'checkout', expected: 'intent:add-item', partition: 'holdout' },
  { id: 'category-other', transcript: '突然想吃便當', setup: 'fulfillment', expected: 'intent:search-menu', partition: 'holdout' },
  { id: 'background', transcript: '小林，我們去旁邊聊', setup: 'checkout', expected: 'IGNORE', partition: 'holdout' },
  { id: 'unfinished', transcript: '我要一份……', setup: 'empty', expected: 'INCOMPLETE', partition: 'holdout' },
  { id: 'greeting-add', transcript: '你好，水餃來一份', setup: 'checkout', expected: 'intent:add-item', partition: 'holdout' },
  { id: 'cart', transcript: '看一下我點了什麼', setup: 'fulfillment', expected: 'intent:view-cart', partition: 'holdout' },
]
