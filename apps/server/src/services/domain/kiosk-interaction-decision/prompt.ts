import type { SystemOnePolicyInput } from '../kiosk-system-one'

/** Application-owned speech scope, shared by ordinary and active-question routes. */
export const serviceRequestInstruction = [
  '分類省略問句：在向本機查詢餐點的語境中，只說分類名稱、分類加「呢」「的有嗎」「之類的」，也是完整的分類瀏覽，選現有 SEARCH_MENU 查詢候選；不必重述「有沒有」。分類即使只有一道菜也不是指定訂購。缺動詞、份數或具體品名不等於 INCOMPLETE；明顯還沒說完才等待。分類匹配本身不能把同伴聊天變成服務需求。',
  '服務界線（程式固定規則，優先於自訂提示與店家補充）：先判斷說話對象：叫同伴名字對他說話，即使詢問餐點種類、報品名或要求操作，也選 IGNORE。只處理向店員／本機提出的點餐服務需求、詢問本機身分、名稱或能力，或依有效服務問題與真實 references 可理解的省略回答。畫面正在點餐、presence 或歷史對話本身不代表本句正在要求服務。',
  '顧客直接詢問本機身分、名稱或能力（例如「你是誰」「你叫什麼」「你能幫我做什麼」）是共用服務互動，選 NEEDS_ASSISTANT；正在確認操作時選 NEW_REQUEST，先撤銷舊授權再回答。對同伴提到這些句子不等於詢問本機。',
  '電話登記頁的電話是自願的。顧客明確表示略過、不留電話、不使用會員或直接點餐，是服務需求，選當前略過電話候選；詢問電話用途或可否略過可交給助手說明。不可假稱已驗證會員，也不可從語音猜填手機號碼。',
  '無關話語即使有疑問、抱怨、比較或解釋語氣，仍選 IGNORE；對同伴的討論、工作閒聊或尚未說完的無關話語也選 IGNORE。不能把一般討論中的「有問題」當成要求本機解決問題。',
  'NEEDS_ASSISTANT 表示顧客直接詢問本機身分、名稱或能力，或有效的點餐服務需求超出有限候選，例如餐點比較、推薦原因或未提供的飲食資料；不是所有可回答的話。MULTI_ACTION 必須有兩個以上明確、獨立的點餐服務操作，不是句子有多個子句。INCOMPLETE 只適用於尚未說完的點餐服務需求。',
  '詢問餐點或分類的種類、款式、有哪些選擇或有幾種，是 SEARCH_MENU 查詢，不是訂購或品名確認。即使商品只有一項，也應查詢目前可選內容，不要求顧客先報完整品名。助手先前要求提供名稱或列舉的例子，不是顧客的購買授權，也不能當作菜單事實。對同伴說話仍依服務界線忽略。',
  '缺少品名、數量或唯一 target 不代表無關；「有沒有素食」「為什麼推薦這道菜」仍是服務需求。「好」「一位」「第二個」可依有效問題或真實 references 理解，不要求每句重述品名。有效新需求不用先回答舊問題；不得猜省略句的授權效果。',
  // This rule must also follow saved base prompts: an unavailable mutation
  // candidate is an execution boundary, not evidence that speech was cut off.
  '缺少數量或必填選項不等於語句未完成。顧客已表達要點某餐點，即使沒有說份數／規格，仍是完整訂購需求；有合法新增候選就選該候選，由程式追問缺漏資料。若只匹配到 possible／fragment 品名或沒有合法新增候選，選 NEEDS_ASSISTANT 確認餐點，不能選 INCOMPLETE 等下一句，也不能改成查詢或擅自下單。先前推薦不是購買授權；現在明確提出訂購也不只是對推薦的附和。',
  '補問餐點份數／規格期間，顧客單說另一個真實菜單品名或分類，也可能是在換話題，不必帶「我要」「改成」才算新需求。當本句菜單證據指向與 CONFIGURING_ITEM 不同的餐點／分類，且沒有回答原問題所需的值，選 NEW_REQUEST 重新判斷需求，不是取消原餐點。只重述原餐點也不等於取消；取消必須有明確取消／不要該餐點的意思。NEW_REQUEST 本身不授權取消、替換或新增。',
  '購物車餐點換成另一道菜，例如「水餃不要，改牛肉麵」「剛才那份改水餃」，是既有訂單的更換，需要整句交給 Main Agent；一般路由選 MULTI_ACTION，不能只選新增或移除其中一步。單純「再加水餃」仍是新增，「水餃不要了」仍是移除，「水餃改兩份」仍是改數量。',
  '若當前提供 clarificationOffer 與 CLARIFY_REQUEST，且確定顧客向本機提出服務需求、只是不能確定是否要點該餐點，選 CLARIFY_REQUEST，用固定是／不是確認。此項優先於把不確定品名直接交助手或把省略話語當取消；明確訂購照原意圖，明確查價、篩選、問種類或有沒有走查詢。對象不明或背景話語不能用這項引起反問。',
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
    '價格詢問、單份價格篩選及由低到高排序使用查詢／推薦候選，不是新增訂購。只問某價格區間有哪些餐點也是完整查詢，不必指定品名；例如「有100～130之間的嗎」省略元仍可選查詢候選，不是 INCOMPLETE 或 NEEDS_ASSISTANT。價格條件由本句有限價格解讀決定，售價與符合品項由程式驗證。不猜價格、不分配整筆或多份預算、不放寬條件。',
    serviceRequestInstruction,
  ].join('\n')
}
