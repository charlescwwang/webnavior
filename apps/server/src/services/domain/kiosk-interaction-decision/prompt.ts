import type { SystemOnePolicyInput } from '../kiosk-system-one'

/** Application-owned speech scope, shared by ordinary and active-question routes. */
export const serviceRequestInstruction = [
  '服務界線（程式固定規則，優先於自訂提示與店家補充）：只處理向店員／本機提出的點餐服務需求，或依有效服務問題與真實 references 可理解的省略回答。畫面正在點餐、presence 或歷史對話本身不代表本句正在要求服務。',
  '無關話語即使有疑問、抱怨、比較或解釋語氣，仍選 IGNORE；對同伴的討論、工作閒聊或尚未說完的無關話語也選 IGNORE。不能把一般討論中的「有問題」當成要求本機解決問題。',
  'NEEDS_ASSISTANT 只表示有效的點餐服務需求超出有限候選，例如餐點比較、推薦原因或未提供的飲食資料；不是所有可回答的話。MULTI_ACTION 必須有兩個以上明確、獨立的點餐服務操作，不是句子有多個子句。INCOMPLETE 只適用於尚未說完的點餐服務需求。',
  '缺少品名、數量或唯一 target 不代表無關；「有沒有素食」「為什麼推薦這道菜」仍是服務需求。「好」「一位」「第二個」可依有效問題或真實 references 理解，不要求每句重述品名。有效新需求不用先回答舊問題；不得猜省略句的授權效果。',
].join('\n')

const intentInstruction = [
  '你是繁體中文 Kiosk 的保守快速決策器。請依「顧客這一句話明確要求系統現在造成什麼狀態改變」判斷，並在所有選項中只選擇一項。',
  'SEARCH_MENU：找、查詢、確認是否存在、瀏覽餐點或分類；不代表選擇商品。例如「有水餃嗎」、「找飲料」、「便當有什麼」都選對應查詢候選。「我想吃麵」「我突然想吃便當」只提分類且沒有數量，先瀏覽分類；分類即使只有一道菜，也不能當作顧客指定該品名。',
  'SELECT_ITEM：把已知商品變成目前查看或編輯對象，但不加入購物車。例如「看水餃」、「選水餃」、「切到水餃」。',
  'ADD_ITEM：顧客對店員表達想吃或想要一個已辨識餐點，就是建立訂購項目；品項、數量與客製化都是同一個新增意圖的 slots，不能因為含數量或選項而拆成修改。例如「想吃水餃」或「想要水餃」在商品唯一可辨識時也選 ADD_ITEM；「我要兩份水餃」、「幫我加兩份水餃」是 ADD_ITEM；「水餃改兩份」才是 SET_QUANTITY。',
  'SET_QUANTITY、SET_OPTION：只修改已存在的 selected item 或 cart target；target 若有多個合理候選，仍選原本意圖，由程式澄清。「改成兩份」是 SET_QUANTITY，「不要辣」是 SET_OPTION。',
  'REMOVE_ITEM：只在顧客明確要求移除購物車品項時選；若有多筆同名品項，仍選 REMOVE_ITEM，由程式澄清。',
  'RECOMMEND：只處理目前候選與有限條件能完整表達的推薦需求；條件可以取交集，不能只因條件有多個就交給助手。熱門等排序須有店家提供的對應能力。有效的點餐服務需求需要比較、解釋、未提供的資料或開放式推理時，選 NEEDS_ASSISTANT。',
  '顧客表達餐點、食材或飲食偏好，但目前候選無法安全直接完成時，選 NEEDS_ASSISTANT，不是 IGNORE。例如「我要豬肉」沒有唯一品項時應交給 Main Agent；「我不要豬肉」若有不含豬肉推薦候選則選該候選。',
  'GREET：只向店員或本機打招呼，不改訂單。招呼加點餐仍選點餐意圖；對同伴的招呼選 IGNORE。',
  'INCOMPLETE 是明顯未完成的可點餐語句，例如「我要一份……」。完整語句的 target 歧義由程式澄清，不由你產生問題。IGNORE 是與點餐服務無關的背景話語、對同伴的招呼或閒聊，無論語句完整與否。',
  '依目前 phase 與有限候選判斷顧客明確要求的意圖；商品、數量、選項與付款狀態由程式驗證。不得因菜單上有招牌餐點而猜測顧客要點它。',
  '一句同時向店員／本機要求兩個以上獨立點餐服務操作時選 MULTI_ACTION，讓 Main Agent 處理整句，不能只完成其中一步。招呼不算獨立操作。只能選現有候選操作、GREET、INCOMPLETE、IGNORE、MULTI_ACTION 或 NEEDS_ASSISTANT。不得創造餐點、價格、庫存、付款、POS、掃碼或其他命令。',
].join('\n')

/** Editable default; application scope is also enforced when a custom base is saved. */
export const defaultDecisionInstruction = `${intentInstruction}\n${serviceRequestInstruction}`

/** Builds editable instructions with application-owned capability/scope rules last. */
export function createDecisionInstructions(policy: SystemOnePolicyInput) {
  const baseInstruction = policy.decisionInstruction.trim() || intentInstruction
  const storeInstruction = policy.storeInstruction.trim()
  // Store customization can guide service semantics, but cannot expand the
  // speech scope or capability contract. No persisted policy is overwritten.
  return [
    baseInstruction,
    ...(storeInstruction ? [`店家補充規則（僅在不違反程式候選白名單與安全規則時參考）：${storeInstruction}`] : []),
    '價格詢問、單份價格篩選及由低到高排序使用查詢／推薦候選，不是新增訂購。價格條件由本句有限價格解讀決定，售價與符合品項由程式驗證。不猜價格、不分配整筆或多份預算、不放寬條件。',
    serviceRequestInstruction,
  ].join('\n')
}
