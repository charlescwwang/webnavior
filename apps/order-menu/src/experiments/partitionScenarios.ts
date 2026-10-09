/** Frozen synthetic challenge, not customer logs or a training set. */
export interface Scenario {
  id: string
  family: string
  text: string
  setup: 'empty' | 'cart' | 'party' | 'pickup' | 'information'
  expected: string
  itemId?: string
  quantity?: number
  partySize?: number
  needsAll?: boolean
}

/** Gold is assessment-only and must never enter provider input. */
export const scenarios: Scenario[] = [
  { id: 'p01', family: 'category', text: '我現在想吃麵類', setup: 'empty', expected: 'intent:search-menu' },
  { id: 'p02', family: 'category', text: '想找個便當吃', setup: 'cart', expected: 'intent:search-menu' },
  { id: 'p03', family: 'category', text: '先看看你們的麵好了', setup: 'party', expected: 'intent:search-menu' },
  { id: 'p04', family: 'category', text: '飲料有哪些可以挑', setup: 'pickup', expected: 'intent:search-menu' },
  { id: 'p05', family: 'availability', text: '店員，你們還有牛肉麵嗎', setup: 'cart', expected: 'intent:search-menu' },
  { id: 'p06', family: 'availability', text: '水餃有在賣吧', setup: 'party', expected: 'intent:search-menu' },
  { id: 'p07', family: 'availability', text: '能不能看看紅茶', setup: 'empty', expected: 'intent:search-menu' },
  { id: 'p08', family: 'availability', text: '排骨便當還有供應嗎', setup: 'pickup', expected: 'intent:search-menu' },
  { id: 'p09', family: 'add', text: '店員，水餃幫我拿一份', setup: 'empty', expected: 'intent:add-item', itemId: 'dumplings', quantity: 1 },
  { id: 'p10', family: 'add', text: '我要吃牛肉麵，兩碗', setup: 'cart', expected: 'intent:add-item', itemId: 'noodle', quantity: 2 },
  { id: 'p11', family: 'add', text: '排骨便當訂一份，謝謝', setup: 'party', expected: 'intent:add-item', itemId: 'bento', quantity: 1 },
  { id: 'p12', family: 'add', text: '紅茶兩杯都幫我加上', setup: 'pickup', expected: 'intent:add-item', itemId: 'tea', quantity: 2 },
  { id: 'p13', family: 'repair', text: '店員，剛才要的牛肉麵怎麼沒出現在訂單裡', setup: 'cart', expected: 'NEEDS_ASSISTANT' },
  { id: 'p14', family: 'repair', text: '我原本還要水餃，現在清單沒有它，幫我確認一下', setup: 'cart', expected: 'NEEDS_ASSISTANT' },
  { id: 'p15', family: 'repair', text: '先別問幾位，請確認牛肉麵是不是漏了', setup: 'party', expected: 'NEEDS_ASSISTANT' },
  { id: 'p16', family: 'repair', text: '店員，我剛說兩份，畫面只有一份，請核對', setup: 'pickup', expected: 'NEEDS_ASSISTANT' },
  { id: 'p17', family: 'fulfillment', text: '改成內用吧', setup: 'pickup', expected: 'intent:set-fulfillment:dine-in' },
  { id: 'p18', family: 'fulfillment', text: '我改外帶，不在這裡吃了', setup: 'party', expected: 'intent:set-fulfillment:takeout' },
  { id: 'p19', family: 'fulfillment', text: '還是留在店裡吃好了', setup: 'pickup', expected: 'intent:set-fulfillment:dine-in' },
  { id: 'p20', family: 'fulfillment', text: '這筆要自取', setup: 'cart', expected: 'intent:set-fulfillment:takeout' },
  { id: 'p21', family: 'party', text: '一位用餐', setup: 'party', expected: 'intent:set-party-size', partySize: 1 },
  { id: 'p22', family: 'party', text: '兩位喔', setup: 'party', expected: 'intent:set-party-size', partySize: 2 },
  { id: 'p23', family: 'party', text: '就三位', setup: 'party', expected: 'intent:set-party-size', partySize: 3 },
  { id: 'p24', family: 'party', text: '總共一個人而已', setup: 'party', expected: 'intent:set-party-size', partySize: 1 },
  { id: 'p25', family: 'checkout', text: '好啊', setup: 'pickup', expected: 'intent:start-checkout' },
  { id: 'p26', family: 'checkout', text: '可以，進結帳', setup: 'pickup', expected: 'intent:start-checkout' },
  { id: 'p27', family: 'checkout', text: '暫時不要結帳', setup: 'pickup', expected: 'intent:defer-question' },
  { id: 'p28', family: 'checkout', text: '先不用，我還在看', setup: 'pickup', expected: 'intent:defer-question' },
  { id: 'p29', family: 'compound', text: '牛肉麵兩碗，水餃再一份', setup: 'empty', expected: 'NEEDS_ASSISTANT', needsAll: true },
  { id: 'p30', family: 'compound', text: '來兩份排骨便當，再給我一杯紅茶', setup: 'cart', expected: 'NEEDS_ASSISTANT', needsAll: true },
  { id: 'p31', family: 'compound', text: '排骨便當撤掉，換牛肉麵一碗', setup: 'cart', expected: 'NEEDS_ASSISTANT', needsAll: true },
  { id: 'p32', family: 'compound', text: '要一份乾炒意麵、一份水餃，乾炒意麵不要香菜', setup: 'empty', expected: 'NEEDS_ASSISTANT', needsAll: true },
  { id: 'p33', family: 'facts', text: '水餃一份售價是多少', setup: 'cart', expected: 'intent:search-menu' },
  { id: 'p34', family: 'facts', text: '排骨便當裡頭是不是有花生，請店員確認', setup: 'empty', expected: 'NEEDS_ASSISTANT' },
  { id: 'p35', family: 'facts', text: '牛肉麵可以不加香菜嗎', setup: 'pickup', expected: 'NEEDS_ASSISTANT' },
  { id: 'p36', family: 'facts', text: '店員，菜單有全素可以吃的嗎', setup: 'empty', expected: 'NEEDS_ASSISTANT' },
  { id: 'p37', family: 'background', text: '阿宏，我覺得牛肉麵比便當好吃，你覺得呢', setup: 'cart', expected: 'IGNORE' },
  { id: 'p38', family: 'background', text: '同事，那個軟體怎麼又變慢了', setup: 'empty', expected: 'IGNORE' },
  { id: 'p39', family: 'background', text: '小林，你那份報告還沒改好嗎', setup: 'party', expected: 'IGNORE' },
  { id: 'p40', family: 'background', text: '哦，了解了，謝謝', setup: 'information', expected: 'IGNORE' },
  { id: 'p41', family: 'unfinished', text: '店員，我要一份……', setup: 'empty', expected: 'INCOMPLETE' },
  { id: 'p42', family: 'unfinished', text: '幫我加那個，呃……', setup: 'cart', expected: 'INCOMPLETE' },
  { id: 'p43', family: 'unfinished', text: '我原本要改成……等我想一下', setup: 'party', expected: 'INCOMPLETE' },
  { id: 'p44', family: 'unfinished', text: '那我要訂……', setup: 'empty', expected: 'INCOMPLETE' },
]
