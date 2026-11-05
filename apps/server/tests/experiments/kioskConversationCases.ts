/** Synthetic multi-turn acceptance cases. Expected outcomes never enter model input. */
export interface ConversationCase {
  id: string
  group: 'development' | 'reserved'
  steps: Array<{ text: string, outcome: 'idle' | 'clarify' | 'catalog' | 'payment' | 'hearing' | 'acknowledge' | 'cart' | 'empty-query', count?: number, retry?: boolean, faultBeforeDecision?: boolean }>
}

export const conversationCases: ConversationCase[] = [
  { id: 'D01', group: 'development', steps: [{ text: '阿明，你昨天看什麼電影？', outcome: 'idle' }, { text: '我要水餃一份', outcome: 'cart', count: 1 }, { text: '我的水餃總共要兩份', outcome: 'cart', count: 2 }] },
  { id: 'D02', group: 'development', steps: [{ text: '小陳，先把你的外套拿走。', outcome: 'idle' }, { text: '我要看全部的菜單', outcome: 'catalog' }, { text: '先不要加任何餐點，請問能用什麼付款？', outcome: 'payment' }] },
  { id: 'D03', group: 'development', steps: [{ text: '我想請你幫忙，那個，我還沒說清楚。', outcome: 'clarify' }, { text: '我現在說清楚：我要水餃一份。', outcome: 'cart', count: 1 }, { text: '再幫我把水餃總數改成兩份。', outcome: 'cart', count: 2 }] },
  { id: 'D04', group: 'development', steps: [{ text: '幫我那個，那個，先不要變更。', outcome: 'clarify' }, { text: '我要問的是目前提供哪些付款方式，不要開始付款。', outcome: 'payment' }, { text: '請顯示全部菜單。', outcome: 'catalog' }] },
  { id: 'D05', group: 'development', steps: [{ text: '有水果嗎？', outcome: 'empty-query' }, { text: '現在換個問題：你們提供哪些付款方式？', outcome: 'payment' }, { text: '我要水餃一份。', outcome: 'cart', count: 1 }] },
  { id: 'D06', group: 'development', steps: [{ text: '顯示全部菜單', outcome: 'catalog' }, { text: '這台機器有收到我現在說的話嗎？', outcome: 'hearing' }, { text: '我要水餃一份', outcome: 'cart', count: 1 }] },
  { id: 'D07', group: 'development', steps: [{ text: '我剛才已略過，不需要再填手機。', outcome: 'acknowledge' }, { text: '請問目前有哪些付款方式？', outcome: 'payment' }, { text: '我要看全部菜單', outcome: 'catalog' }] },
  { id: 'D08', group: 'development', steps: [{ text: '請說明目前可用的付款方式。', outcome: 'payment' }, { text: '謝謝，我先看看。', outcome: 'idle' }, { text: '我要水餃一份', outcome: 'cart', count: 1 }] },
  { id: 'D09', group: 'development', steps: [{ text: '有水果嗎？', outcome: 'empty-query' }, { text: '我想問，那個，我還沒說清楚。', outcome: 'clarify', faultBeforeDecision: true }, { text: '我想問，那個，我還沒說清楚。', outcome: 'clarify', retry: true }, { text: '我現在要問付款方式。', outcome: 'payment' }] },
  { id: 'D10', group: 'development', steps: [{ text: '顯示全部菜單', outcome: 'catalog' }, { text: '你有收到我現在說的話嗎？', outcome: 'hearing', faultBeforeDecision: true }, { text: '你有收到我現在說的話嗎？', outcome: 'hearing', retry: true }, { text: '我要水餃一份。', outcome: 'cart', count: 1 }] },
  { id: 'D11', group: 'development', steps: [{ text: '我要水餃一份。', outcome: 'cart', count: 1 }, { text: '先不要結帳，只告訴我能用什麼付款。', outcome: 'payment', count: 1 }, { text: '水餃改成總共兩份。', outcome: 'cart', count: 2 }] },
  { id: 'D12', group: 'development', steps: [{ text: '請顯示全部菜單。', outcome: 'catalog' }, { text: '我先不點餐，只確認你有收到我的話嗎？', outcome: 'hearing' }, { text: '現在我要水餃一份。', outcome: 'cart', count: 1 }] },
  { id: 'H01', group: 'reserved', steps: [{ text: '阿芳，你的雨傘放在椅子上。', outcome: 'idle' }, { text: '給我一份水餃', outcome: 'cart', count: 1 }, { text: '總數改為兩份水餃', outcome: 'cart', count: 2 }] },
  { id: 'H02', group: 'reserved', steps: [{ text: '點餐機，請幫我，我還不知道怎麼說那個。', outcome: 'clarify' }, { text: '我想知道可以怎麼付款，先不付錢。', outcome: 'payment' }, { text: '幫我加一份水餃。', outcome: 'cart', count: 1 }] },
  { id: 'H03', group: 'reserved', steps: [{ text: '你們有賣蘋果嗎？', outcome: 'empty-query' }, { text: '先不談餐點，請問支援哪些付款方法？', outcome: 'payment' }, { text: '現在秀出完整菜單給我。', outcome: 'catalog' }] },
  { id: 'H04', group: 'reserved', steps: [{ text: '我想看所有餐點。', outcome: 'catalog' }, { text: '我正在測試聲音，這句話有收到嗎？', outcome: 'hearing' }, { text: '給我水餃一份。', outcome: 'cart', count: 1 }] },
  { id: 'H05', group: 'reserved', steps: [{ text: '電話我已經選擇略過了，不要再問。', outcome: 'acknowledge' }, { text: '能用哪些方式付費？只是問問。', outcome: 'payment' }, { text: '列出整份菜單。', outcome: 'catalog' }] },
  { id: 'H06', group: 'reserved', steps: [{ text: '有香蕉可以點嗎？', outcome: 'empty-query' }, { text: '機器請幫忙，我的意思，我還沒講清楚。', outcome: 'clarify', faultBeforeDecision: true }, { text: '機器請幫忙，我的意思，我還沒講清楚。', outcome: 'clarify', retry: true }, { text: '我只要問你支援的付款方式。', outcome: 'payment' }] },
  { id: 'H07', group: 'reserved', steps: [{ text: '我想看你們全部的餐點。', outcome: 'catalog' }, { text: '現在測試語音，這裡有接收到我的話嗎？', outcome: 'hearing', faultBeforeDecision: true }, { text: '現在測試語音，這裡有接收到我的話嗎？', outcome: 'hearing', retry: true }, { text: '我現在決定要一份水餃。', outcome: 'cart', count: 1 }] },
  { id: 'H08', group: 'reserved', steps: [{ text: '一份水餃幫我加入訂單。', outcome: 'cart', count: 1 }, { text: '不要動訂單，我只想確認這句話有收到嗎？', outcome: 'hearing', count: 1 }, { text: '我的水餃最後總共需要兩份。', outcome: 'cart', count: 2 }] },
]
