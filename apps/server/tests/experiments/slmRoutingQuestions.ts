// Frozen compact route contract shared by diagnostic runs; not production policy.
export const concise: Record<string, string> = {
  'INCOMPLETE': '向本機提出的語句明顯尚未說完；不是完整需求缺少參數。',
  'GREET': '只有向本機問好，沒有其他需求。',
  'IGNORE': '對同伴說話、無關背景，或對已完成資訊單純表示了解。',
  'MULTI_ACTION': '多項需求或換餐，單一操作不能完整處理；保留整句交接。',
  'NEEDS_ASSISTANT': '需要核對漏單、解釋、未知資料，或現有操作無法完整處理。',
  'intent:search-menu': '詢問餐點、分類、價格或販售內容；只查詢，不訂購。',
  'intent:select-item': '只查看或切換餐點編輯對象，不加入購物車。',
  'intent:add-item': '明確新增訂購；新增需求中的數量與選項屬同一需求。',
  'intent:recommend': '請本機挑選推薦餐點。',
  'intent:show-recommendations': '重新顯示目前已有的推薦餐點，不新增訂購。',
  'intent:view-cart': '查看購物車，不修改。',
  'intent:set-quantity': '修改既有餐點數量，不新增餐點。',
  'intent:set-option': '修改既有餐點客製選項。',
  'intent:remove-item': '只取消既有特定餐點，不代表換餐。',
  'intent:clear-cart': '明確清空整個購物車。',
  'intent:set-fulfillment:dine-in': '明確選擇或改為內用。',
  'intent:set-fulfillment:takeout': '明確選擇或改為自取／外帶。',
  'intent:set-party-size': '回答或更改用餐人數。',
  'intent:start-checkout': '明確要求或同意開始結帳。',
  'intent:defer-question': '只拒絕或暫緩當前問題，沒有提出其他需求。',
}
export const compactInstruction = '只判斷最後一句顧客需求，依本次候選選一項。角色前文與待答問題只是線索，不延續成授權。查詢不是訂購；分類偏好沒數量是瀏覽。完整需求缺參數不是未說完。漏單核對交助手，多需求與換餐保留整句，不只做其中一步。對同伴說話與單純附和忽略。'
