# Kiosk 語音不確定、回覆與重試的整體修正計畫

日期：2026-10-28（Asia/Taipei）。狀態：使用者已核准並完成主要流程的本機實作；整體驗收尚未通過，未commit、未部署。實際結果與限制見末節。

## 2026-11-23 舊流程誤用稽核（PB / Electron）

本文件下方保留的是舊自有 Order Menu 架構的歷史設計，不能把其中的
`kiosk_conversation_context`、`kiosk_agent_task`、`kiosk_interaction_state`
直接當成 PB 工具。PB 目前以原生 `browser_state_get` 識別協定；付款／結果頁
保留該唯讀工具，刻意不提供菜單編輯與視覺操作工具。

| 檢查項目 | 本輪確認與處理 |
| --- | --- |
| PB 被當成舊 Menu | RC6 修正 Main 與 recovery；本輪又找到 handoff 仍用 `browser_observe` 判身分，改成共用協定判斷，包含付款頁；保留自有 Menu 本身的合法支援。 |
| 舊結帳問題蓋掉新餐點需求 | 現場問油雞份數卻回發票；已有 dialogue-level NEW_REQUEST 測試，但 Host quantity wrapper 更早處理舊問題。新增 wrapper regression，再使用既有 pauseCheckout 暫停舊結帳問題，不改商家欄位或購物車。 |
| 再說一次開始點餐 | Server prompt／Host 已改自動開始，但 native 選桌讀取與 recovery 文案仍留舊說法；同步為報有效桌號後直接開始。手動選桌畫面的 Start 按鈕仍是正常控制。 |
| 錄音依等待時間過期 | 先前已修正：正常 reserve('asr') 不傳 deadline；已完成語句排隊不按時間丟棄。重跑舊 deadline／FIFO／並行 ASR tests；capture membership 只因取消、reset 或 dispose 失效，診斷改稱 retired-capture。明確指定 provider watchdog 的測試與網路取消不等於背景過濾。 |
| 背景過濾關閉 | off/observe 不提供 IGNORE，保留必要問題解析與權限邊界；未更改設定或重開過濾。 |
| 已修正的結果頁誤判 | RC6 以新鮮 Inertia HTTP 讀取代替 bootstrap data-page，付款頁 recovery 不走 Menu；本輪保持此修正及單次 submit 約束。 |
| Hush／演算法選擇 | 現場入口維持 November Chromium／Spatial Mask 基線；離線比較檔不代表正式 selector 恢復。此輪不改收音或 TTS。 |

驗證範圍是程式、既有實際紀錄及隔離回歸測試，不冒充 Windows／實際商家付款
完整驗收。詳細來源、發布與未驗項記錄在 `docs/codex-handoff.md` 及 release records。

## 2026-10-29 本機補強與模型控制實驗

本次已實作以下兩個共用邊界，沒有新增特定語句比對或另一個語意reviewer：

- `conversationDecisionStateFrom`將沒有明確effect handoff的UNCERTAIN_OPERATION在所有phase維持唯讀。服務資格不會變成任意寫入授權；已明確解析的handoff維持既有工具限制，已確認NEW_REQUEST也不一律禁用操作。取消／誤設自取的回歸驗證會真的經過Menu工具guard，錯誤SET_FULFILLMENT被拒且購物車不變。
- `replyFromConversation`對已正常結束、沒有嘗試業務工具、且有fresh Menu context的未驗證草稿，改用應用程式產生的角色釐清。即使草稿聲稱已移除餐點，也不顯示假成功或重試按鈕。KioskScene重新讀context、記錄presentation-clarification並建立本輪釐清窗口，下一句不會回答到舊購買邀請。真正provider失敗、已嘗試工具／結果未知仍保留原故障與回執規則。

先有失敗重現再修改：124項相關Kiosk單元測試、2項Chrome呈現測試、22項Server回覆／SLM transport測試、12項Menu context測試及Kiosk scoped typecheck通過。瀏覽器測試跑實際KioskConversation與Menu／presenter，沒有使用真實Main或實體語音；不是整條現場取消需求的驗收，不能宣稱「取消便當」已在所有模型路徑修好。仍需關注語意已被錯誤認定明確時的錯工具，以及多需求完整執行。

模型研究以同一批10個情境做原題／精簡描述／四類分流，60次真實請求202.8秒完成：原題Jev3/10、SLM4/10；固定候選數的精簡組均9/10；四類分流均10/10，但任務不同不可混算。支持精簡契約與SLM首層方案，未實作生產首層切換，也未改Main thinking或admin。詳見[SLM評估](2026-10-28-kiosk-slm-evaluation.md)。本節取代下節「尚未實作新增阻擋項／四類未驗」的較早狀態；部署、最終模型輸入投影與完整鏈驗收仍未完成。

## 2026-10-29 整體處置順序複核

此階段應收斂為一個可驗收的修復單位，不同時變更模型、thinking、首層分類、工具授權與呈現。最新取消便當案例已證明Main選錯工具且草稿假稱完成；這是本計畫的新增阻擋事項，先前本機通過與未部署修復不能當作已涵蓋本案。現場身份、目前本機source、已建置資產及模型實驗需分開標記；目前文件狀態仍是未部署，最近可找到的部署manifest為10/27。

SLM快速16例與歷史26例使用不同分類契約／上下文／候選，不可用31/32或5/26建立整體模型排名。歷史5/26只證明當次SLM配置未通過該root選擇契約。四類首層與thinking on是未驗假說，不視為已證實的修復。SLM替換研究保留，先不以選型結論取代現場缺陷修正。

建議的下一個交付單位：

1. 核對本次實測的Server／Kiosk／Menu載入身份；記錄必要的模型最終輸入投影（不是只記DB原始回執）。確認sourceUtterance、新cart、當前問題與工具結果壓縮後的內容一致，私有原始資料不提交或重送外部模型。
2. 對尚未確立操作效果的Main任務，採唯讀／語音澄清；明確授權的操作維持正常流程。服務資格不是所有寫入的授權，工具可用／回執成功也不是需求吻合證據。取消餐點不得順便設定用餐方式。
3. 維持每個需求效果各自的成功回執與完成狀態；取消、換餐、改用餐方式不能互相代替。語意不明可澄清，技術失敗才提供對應恢復，不能以放行自然文字或隱藏錯誤代替修復。不要新增未驗證Jev／SLM reviewer作唯一語意授權者。
4. 單輪最小完整鏈驗收：取消便當保留水餃且不改mode、餐點替換不變追加、對誤設自取的糾正、同原句retry不換題／不重複寫入、純查詢不寫入、未完成／模糊語句可等待或釐清。沿同一版本Main→工具→狀態→呈現檢查，不拿模型單題或mock總數代替。固定小批與停止條件，不擴成多小時模型選型或反覆調prompt重跑。
5. 此修復通過後才另做首層服務分流原型。Main thinking目前設定維持不變；前述隔離off／on比較排在輸入與授權界線之後，否則會把協定／程式缺陷誤判成模式差異。thinking不能成為放寬執行保護的理由。

以上是處置規劃收斂，尚未實作新增阻擋項或部署；保留目前所有未提交修復，不回滾、不清除場域訂單、不改模型設定。具體證據與開源研究見[10/29稽核](../research/2026-10-26-kiosk-conversation-error-audit.md#2026-10-29取消便當誤設自取main回覆被拒)。

## 目標與依據

讓系統遇到未預料的語句時，可以忽略、釐清或繼續服務，不把「意思不確定」當成操作故障，也不為了避免錯誤畫面而猜操作、改查舊問題或放行不實回覆。

依據：[10/28 兩台機台續查](../research/2026-10-26-kiosk-conversation-error-audit.md)。有限樣本為兩個 device／三個 session／365筆紀錄，13個 Main task 中6個回覆被拒；重試原句後查到更早的水果主題，錯誤結果卻以有效回執通過。三個session都仍為active、noProgressCount=0，不是累積失敗後切換手動模式。原音、TTS回授及兩台實際載入的bundle身份尚未核實。

既有49項reply／historicalReplies測試通過，只證明現行保護與手寫輸出控制成立。先前兩個真實模型說明案例沒有涵蓋雜訊、主題切換、格式偏離與按鈕重試鏈。本計畫補上這些驗收缺口，不將舊通過數當本次修正證據。

## 範圍與限制

- 改動現有Jev／Main交接、非操作回覆契約、Host重試及呈現、相關紀錄與測試。保留Menu為購物車／查詢／畫面的擁有者，Server為模型交接與會話邊界的擁有者。
- 沿用現有Valibot、SSE、服務恢復、互動request／task／document識別與Vitest／Chrome；不新增依賴、模型供應商、泛用分類器或另一套訂單store。
- 不以降低信心門檻、放行所有自然語言、增加工具迴圈或更換模型作本次修復。保持手機選填／明確略過、裝置認證、POS驗證、付款鎖定與回執要求。
- 不重啟未結束交易、不清除機台憑證、不更改近期已恢復的測試登入／六位數註冊流程。
- 場域語意不能靠有限案例證明永遠正確；以保守的不確定出口、可觀測失敗與跨流程測試限制損害，不能宣稱消滅所有誤判。
- 實體收音與TTS回授另列驗證；未取得原音前，不先改VAD／ASR門檻或一律丟掉TTS播放期間的語音，以免破壞合法插話。

## 完成後的行為契約

| 狀況 | 對話呈現 | 操作／畫面 |
| --- | --- | --- |
| 無法確認在向本機提出需求 | 保持聆聽；明確按下送出者可顯示中性未處理狀態 | 不加購、不換推薦、不跳故障 |
| 已確認向本機提需求，意思仍不清楚 | 簡短語音釐清；不是error、不要求改用觸控 | 保留原畫面／訂單；不選舊問題代答 |
| 意思清楚的資訊問題 | 從新資料產生相關回答 | 不把資訊查詢當寫入授權；未要求展示不改菜單 |
| 意思清楚的訂單／展示要求 | 按實際成功回執回覆 | target、revisions、確認及付款規則照常驗證 |
| 連線／provider／資料取得失敗 | 說明哪一步尚未完成，提供適當恢復 | 不說成沒聽懂、不宣稱沒有餐點 |
| 寫入結果未知 | 提示核對訂單，保留結果不明狀態 | 不提供直接重送該寫入的重試 |

「使用畫面」保留為可選途徑，不是一般理解失敗的預設收尾。技術故障也不能只換成友善文案冒充已恢復。

## 設計決策

### 1. 區分服務資格、意思與執行授權

服務資格只代表這句值得處理，不等於意思清楚。沿用`serviceRecovery.ts`的adjudication／review，保留原句與目前有效問題；在既有完整理解階段明確保留「可理解／需要釐清」的處置，不能把REQUEST自動升成已解決的操作需求。

- 有明確意思的需求可直接接現有Main或Fast Path；不讓每句正常點餐都多跑一個模型。
- 僅確認服務相關、意思仍未明時，沿用完整review或唯讀釐清，不繼承Jev已被撤銷的捲動／付款／加購猜測。
- 收件對象仍未知時不主動追問；已確認向本機提問才可產生服務釐清。姓名、presence、站在機台前、歷史與高信心模型自評都不單獨構成操作授權。
- 重複含糊語句不自動變推薦／付款說明，也不累積成必須觸控的模式。相同未變更情境不連續播同一追問；顧客新說法仍正常受理。
- 沿用原turn budget與取消機制，不因新增review／格式修復重設總deadline；不恢復先前已否決的多欄需求拆解分類器。

### 2. 使用可驗證的非操作回覆出口

延伸既有`contextReplySchema`／`replyFromContext`，讓Main的資訊／澄清選擇有明確契約，避免以「文字是否以 `{` 開頭」決定有沒有驗證機會。

規劃採用既有gateway已使用的有限工具輸出方式：在Server模型邊界提供一個無Menu副作用的回覆選擇工具，由Server消化，不傳給瀏覽器當成點餐工具執行。模型選擇資訊種類／需要釐清；事實文字仍由Host用fresh context產生。此工具與Menu操作互斥收尾；一輪若同時提出寫入與資訊收尾，不能提前宣布成功或略過未完成工具。

- 共享的選擇schema與型別由`stage-shared/kioskConversation.ts`持有；既有SSE producer、`kiosk-device.ts` consumer及`ConversationTurnResult`攜帶同一型別。只整理本次新增邊界，不另做整套stream重構或由Server runtime模組反向提供瀏覽器型別。
- Server驗證結構、收尾種類與本次request／task關聯；Host重新驗證session、document、ownership及新context後，才渲染事實或有效問題。模型不能自行填成功回執、確認票據或授權ID。
- 原始prose可留作draft，不直接顯示。缺少／無效輸出最多一次無Menu操作的格式修復，使用原句、同一request與剩餘budget；修復不執行或重送訂單工具。
- 格式仍無效但服務資格已確認時，以應用程式持有的中性釐清收尾；對象未確認則安靜結束。provider失敗仍報技術故障，不冒充語意不確定。
- 付款／用餐方式依新context的可提供資訊回答，與目前phase可執行的工具分開；未知資訊說無法確認，不放行「支持刷卡」等未證實文字。
- 意思未明的服務釐清不能自動借用舊的內用／加購／確認問句。只有本輪明確關聯且仍有效的question，才可重述其問題；仍不消耗回答票據。
- 刪除本輪prompt中相互矛盾的格式指示；一般身分／招呼等既有自然對話需有明確受限出口，不應因四個selector不足而變成未完成，也不能讓此出口攜帶菜單、付款或操作完成宣告。

這不代表結構正確就理解正確；語意相關性另依下一節驗收。

### 3. 綁定本次需求，避免成功查錯題

沿用現有request／utterance／handoff，保留當前問題、已理解主題、仍未解決的部分及前後文用途；不建立新的全域「猜測需求」store。歷史是線索，不是本次的查詢或購買授權。

- 不確定意思的交接，工具權限限於取得必要情境與釐清，不能因Main自行選一個topic就解除限制。
- 已理解的資訊／展示需求才可對應該topic取得回執；回執綁定當前request／task及工具參數。回覆層不能只因`items:[]`就結束任意新問題。
- 新的獨立問題可切換主題；不是清空所有歷史、飲食限制或未完成餐點。明確省略指涉仍可承接相關舊需求，不是禁止所有回指。
- `menu_recommend(action:clarify)`只適用菜單查詢範圍／條件不明；付款詢問、收音測試或一般意思不明不能套用其固定價位／分類問句。
- 只能以目前已知request範圍作確定的程式檢查；模型給的topic仍是語意提案，不能自稱通過驗證。無法確認時退回釐清，並在真實模型測試中單獨記語意失敗，不能以typed selector或合法工具呼叫掩蓋。

### 4. 重試是恢復同一需求，不是重新猜一次

把`retryableConversationRequest`從字串調整為現有Host擁有的重試記錄：保存原request／utterance關聯、原句、來源、失敗階段、已理解與未解決部分、已完成效果及可重試原因。語音理解與Main技術重試有不同入口，不能一律直接重開Main。

- 原句意思尚未確認：重新進入受限理解／釐清流程，不能跳過服務邊界後直接讀舊歷史操作。
- 僅非操作回覆格式失敗：接回本次回覆處置，不重新做已完成菜單展示或推薦。
- 技術失敗且確定未送出操作：可以重新取得context並恢復本次需求；舊deadline已結束的新attempt有新期限，但每次自動修復仍有界，並關聯原request。
- 先取得目前session／document／revisions／checkout／payment／task ownership；舊decisionState只可提供語意背景，不可原封帶入作授權。reset、切換機台／會話、question過期或取代document，必須使舊重試失效或要求重新核對。
- 已送出寫入或結果未知：不自動重送。沿用既有operation結果查證／釋放流程，先確定結果才決定下一步。
- `kioskConversationRetry.ts`目前把推薦／展示視為harmless lookup，需修正該政策。`menu_recommend`會改seen／batch，`menu_get(display:true)`會改畫面；按工具名稱不能證明可透明重送，需按執行階段、輸入與已知回執分開判定。
- 重試不重複插入顧客原話假裝新需求；需保存retry attempt關聯，方便區分新一句與同句重試。連點只啟動一個attempt。

## 實作批次與模組責任

每批先加入會失敗的最小重現，再改產品程式；跨批次行為變更全部完成驗收前不單獨部署。沿用原有測試入口，不為測試建立替代產品API。

| 批次 | 主要位置 | 完成條件 |
| --- | --- | --- |
| A：來源與重現 | 現有歷史fixture／reply、decision、retry測試；10/28證據對照 | 重現格式拒絕、含糊語音誤接、付款誤問分類、原句重試查水果；記錄修改前失敗 |
| B：完整回覆與釐清 | `stage-shared/kioskConversation.ts`；Server `kiosk-agent-interaction/conversationContext.ts`、`kiosk-interaction-decision/serviceRecovery.ts`、Kiosk route；Host `kiosk-device.ts`、`useKioskInteractionRecording.ts`、`questionPresentation.ts` | 資格與意思分開；typed reply從模型到Host閉合；一次有界修復；未授權寫入與不實宣告仍擋下 |
| C：需求與重試 | `KioskScene.vue`、`kioskConversationRetry.ts`、Menu `webmcp.ts`現有task／query邊界 | 按重試仍處理同一需求；不回舊水果、不重跑展示／加購；reset及未知結果保護通過 |
| D：畫面與可觀測性 | `KioskConversation.vue`、既有decision progress、i18n `stage.yaml`、既有metrics | 正常釐清不是error；技術故障與結果未知分開；按鈕／聆聽／loading正確收尾；語音仍可繼續 |
| E：跨流程與場域準備 | 原有Browser與provider replay、audio replay、歷史及多需求套件 | 以下分層驗收通過，保留未跑／失敗項，再準備配套部署 |

技術入口保持輕量；若狀態政策需要移出大型Scene，優先擴充現有retry／question模組，不建立只轉傳參數的service或依賴袋。只有真正共享的schema／關聯型別進stage-shared。

## 測試矩陣

歷史來源以原sequence、前態、工具及回覆位置重現；沒有原音或畫面就不聲稱重現了該層。原始顧客錄音／完整私有對話不送外部模型；真實模型組用另編人工對話，gold不進prompt。

### 離線及故障注入

- 捕獲prose／有效selector／無效selector／格式修復失敗／provider逾時／取消各自走正確出口；一次修復不超過原turn剩餘budget。
- 原文回覆含不實付款或無回執「已加入」仍被拒，不把它修成直接顯示。
- 有效的用餐方式selector套在收音測試時，不算回答成功；合法的空水果回執不能完成不相關原句。
- 背景音、對象不明不寫cart也不換菜單；確定向本機但意思不明可釐清，不能耗掉舊問題確認權。
- 重試前後原request一致；完整覆蓋fresh revisions、過期question、新document、reset、連點、舊promise晚到、已完成展示與未知寫入。
- 原歷史數量1+2更正、內外帶、完整菜單、多候選裸肯定、多品項及混合詢價＋加購照跑，不能只修新案例。

### 連續對話組

新增20條人工鏈：12條development、8條reserved，各3–6個turn；每條明確列出每turn可接受的處置及禁止效果。凍結後不因測試失敗改gold；reserved不拿來調prompt。

| 組別 | Development | Reserved | 重點 |
| --- | --- | --- | --- |
| 背景／對象不明 | D01–D02 | H01 | 不升成推薦或故障 |
| 服務相關但意思不明 | D03–D04 | H02 | 釐清後可繼續，舊內外帶問題不搶答 |
| 資訊題目切換 | D05–D06 | H03–H04 | 菜單→付款／收音；不套舊分類問題 |
| 格式偏離與修復 | D07–D08 | H05 | 自然語言／格式錯誤不變操作授權；後續對話正常 |
| 按鈕重試 | D09–D10 | H06–H07 | 舊菜單主題→新含糊句→拒絕→真正點擊重試 |
| 跨狀態保護 | D11–D12 | H08 | 已完成展示、未知寫入／reset／連點，不重複執行 |

清楚的正常點餐及多需求用既有套件作對照，避免全部退回釐清後看似安全。20鏈不替代10/22的48個單句語意評測；兩組分開計數，本次不順帶宣稱舊baseline已完成。

### Browser與真實模型

1. Chrome掛接實際Host重試處理與Menu runtime／iframe：至少驗D05、D07、D09、D10、D11、D12，包含真正點擊重試、loading收尾、可見菜單與cart、後續再說一句。只在KioskConversation mock一個onRetry事件不算覆蓋Host缺口。
2. 用目前設定的Jev／LLM與完整正常pipeline，先6條人工鏈smoke；不可繞過Jev直接指定readOnly前態當作整條成功。前置認證／transport出錯先修測試邊界，不能停用產品POS裝置驗證。
3. 凍結cases／gold／程式dirty diff／prompt／policy／menu hash與設定身份後，20鏈各跑3次，共60個session；每turn保存raw route、Application處置、回覆kind、工具參數與回執、畫面結果、retry lineage及時間。不因失敗自動重跑挑最好的一次。
4. 此輪上限600次provider請求或30分鐘，先到即停止並報部分結果；格式修復、service recovery、Main與ASR均計入實際用量。認證／模型端點錯誤或429停止檢查，連續3次provider技術失敗停止。原始客戶資料與credentials不進artifact。
5. 文字鏈通過後，再用合成語音跑收音／播放重疊對照；實體兩台驗收最後進行。比較原始音訊、ASR與對話結果，不能僅看ASR文字就推定原話或回授。

## 報告與發布門檻

每turn分開記：對象／語意處置是否正確、需求是否完成、是否正常釐清、是否真正技術失敗、是否有未授權副作用、回覆是否相關、畫面是否一致。`presented`不能單獨算成功；`clarified`也不是已完成訂購。

- 固定離線／Browser保護案例全過；零未授權寫入、重複寫入、舊確認票據重放及不實操作完成宣告。
- 必修已知鏈不再出現「按重試查舊水果」「收音問題變內外帶」「付款問題變價位／分類」，不能靠刪案例或硬編該幾句達成。
- 20鏈的每次實際模型結果逐項報告。意思已清楚的需求需正確完成；人工標為含糊者可安全釐清，不能全部abstain算理解成功。仍有未解的需求／重試／呈現錯誤，不以整體平均高就發布。
- 正常不確定情境不出現通用故障／必須手動提示；provider故障與未知操作仍清楚可見。顧客下一句可正常繼續，沒有殘留sending、舊task控制權或失效retry。
- package／共享契約的必要typecheck、改檔lint、相關Menu/Kiosk/Server及Chrome測試、Menu/Kiosk build完成。規劃階段不跑全專案typecheck；實作優先最窄檢查，真正提交／整合時才依規範決定整合gate。
- 場域更新時配套API／Kiosk／Menu並保存備份；需驗API新PID及readyz、公開資源hash、兩台實際載入的build身份。停止重複要求使用者重啟已健康的服務來代替程式修復。未結束交易先核對，不能直接刷新丟失訂單。
- 正式設定、模型、認證政策與真實支付不隨本次規劃更動；後續部署依使用者實作／更新指示執行。本輪不commit、不部署。

## 執行順序

先A建立可失敗的來源案例；B閉合對話出口及不確定處置；C修重試與本次需求關聯；D完成UI收尾與診斷；E跑完整模型／Browser／語音對照。B–D是同一交付單位，不能只部署新文案或只傳回更多JSON就宣稱修好。

完成後更新最接近的Server／Kiosk／Menu README及必要CONTEXT術語，將本計畫補上實際結果、未完成項目與部署狀態；handoff只保留後續工作需要的結論。


## 2026-10-28 實作與驗證狀態

使用者已核准實作。產品修改目前只在工作目錄，未commit、未部署；原始證據與上一版程式的紀錄不能當成新版驗收。

已實作 B–D 的主要流程：Server內部有限回覆工具與共享typed reply、一次無操作工具的格式修復、Host最新事實呈現；服務入場與理解意思分開；原句重試經正常queue／Jev／recovery路徑、關聯lineage及新session／document／domain revisions驗證。展示、推薦及訂單工具已嘗試時不透明重放。正常語意不確定不顯示技術重試；未知操作結果仍提示核對畫面。typed clarification亦登記為服務釐清，避免下一句裸肯定回答舊購買問題。實作也修正Host投影遺失revisions、造成合法retry一直過期的問題。

新裝置建立時套用獨立的birth policy：本機相機觀測、主動招呼、閒置提醒、語音診斷覆寫為true，招呼觸發mixed；這五欄允許現場調整。SQL空設定基準與舊裝置資料保持原有語意，沒有migration或批次改寫，其他欄仍按原本授權規則。

### 已完成驗證與範圍

- 修改前重現：新裝置預設、資訊回覆拒絕／舊問題誤接、語意不確定顯示error等；保留本機 `/tmp/kiosk-defaults-before.log`、`/tmp/kiosk-repair-semantic-before.log`。
- Server相關測試517通過／80依既有條件略過（`/tmp/kiosk-repair-server-final.log`）；後加JSON/SSE格式修復路由與required-menu-read限制後，最新兩檔68項通過（`/tmp/kiosk-repair-contract-complete.log`），驗一次repair、typed reply、不串流不實草稿，以及修復仍不得跳過必要菜單回執。
- Host單元256通過／48略過（`/tmp/kiosk-repair-host-complete.log`），包含連點等待中重試保護；資訊呈現測試再驗通過。
- Menu相關既有回歸757通過／176略過（`/tmp/kiosk-repair-menu-suite.log`），包含數量、內外帶、菜單與工具回執保護。
- Chrome3檔5項通過（`/tmp/kiosk-repair-browser-final.log`）：真正點擊KioskConversation重試，接production retry helper／queue／decision／recovery及Menu runtime，回覆正常釐清後下一句可加水餃，DOM顯示實際cart callback份數。provider answers由fixture注入；另驗等待進度及FieldState。這**沒有掛載完整KioskScene／實際iframe，也未完成上列六鏈逐項Browser驗收**，不能把此結果當成全部E通過。
- Server與Kiosk套件typecheck通過（`/tmp/kiosk-repair-{server,kiosk}-types-complete.log`）；改檔ESLint及Kiosk／Menu production build驗證。未跑root typecheck。
- 新增20條人工鏈與opt-in provider replay，reserved尚未執行。故障注入只在decision前建立失敗／retry紀錄，不冒稱重現實際HTTP失敗；格式偏離、未知寫入、reset等仍由對應離線保護測試驗證，人工鏈本身不保證模型產生那些故障。`empty-query`要求畫面為空及無匹配回答；付款fixture提供真實有限方法，避免空集合的假通過。

### 真實模型：未通過整體驗收

使用者設定的Jev為lookski `Qwen/Qwen3.5-4B`，Main為`webnavior/chat`→`qwen36`設定名稱（不宣稱底層checkpoint身份）。資料庫僅唯讀載入設定，session／工具／health狀態寫入隔離資料庫，模型只收到人工對話。每輪保留當時dirty檔案hash、HEAD及私有log；修改後不把舊hash結果套在新版。

1. 第一輪6鏈pilot：2通過、4失敗（`/tmp/webnavior-conversation-repair-pilot-20261028-030841.log`）。D01把「最後總共兩份」新增成三份；D03完整的求助但意思不明誤當未說完；D05／D09缺本輪查詢回執卻選menu-information。已增加現有cartRequest的TOTAL有限選擇並保留對象／信心門檻、補完整求助語意界線、限制未查詢時只能查菜單或clarification；本機回歸通過，**真實模型修正效果尚未複驗**。
2. 第二輪6鏈：3項狀態通過、3失敗，但Jev全是PROVIDER_FAILURE，走Main備援；**不是有效的Jev+Main評測**。Main誤選order_ask_question的案例促成移除此非Main所有的問題工具；其餘hearing與背景處置失敗仍須實際複驗。
3. 最小D01探測（`/tmp/webnavior-conversation-repair-probe-20261028-032328.log`）：實際啟用外部端點`projev.aikcitri.qzz.io`回500 CUDA launch timeout、invalid context／sticky702。health仍回模型名稱，不能代表可推論。這是本輪觀測，**不能推定為早上兩台原始故障原因**。因此停止大型推論，不執行20×3。診斷時誤重啟本機另一個AMD openjev服務，已核對它不是啟用端點；此動作沒有修復外部CUDA，也沒有部署API／Bridge／前端。
4. 分開跑實際Main-only資訊回覆2項通過（`/tmp/webnavior-conversation-repair-main-20261028-032547.log`），不涉及Jev。不能以此替代整鏈驗收。

上限計數已改為注入現有fetch邊界，計所有Jev HTTP（含readiness）及router各次上游請求，而非只算外層complete；保守計入health。600次／30分鐘及連續3次Jev故障停止規則保留。

尚待：恢復實際啟用的Jev推論端點後，固定新版身份重跑6鏈；通過才跑20鏈各3次、舊多需求模型回歸與完整Browser矩陣。其後才做合成語音、兩台實機及配套部署。現在不適合宣稱可直接更新場域實測或問題已全部解決。


### 使用者恢復Jev後的補測

使用者通知已處理Jev／CUDA。實際啟用端點推論已恢復，不能再把外部故障列為目前阻擋原因。本次未重啟任何服務，未部署、未commit，也未實作新的共用queue。

- `/tmp/webnavior-conversation-repair-pilot-20261028-050538.log`：六鏈3通過3失敗。D05／D09已正確查詢且回答「目前菜單查不到水果」，測試正規式漏了「查不到」同義詞；修正斷言，沒有改空結果的gold或刪除畫面驗證。D03明確請求協助但尚未說清楚目的，被recovery admission誤認BACKGROUND；補既有admission與unfinished-speech instructions，區分完整求助和訂購起頭，信心門檻與操作權限不變。
- `/tmp/webnavior-conversation-repair-pilot-20261028-050654.log`：六鏈5通過1失敗，61個實際HTTP請求（含health），無Jev／CUDA／provider失敗。D01數量總數、D03求助釐清後點餐、D05查無餐點轉付款、D06完整菜單轉收音確認、D11付款資訊後改數量通過。
- D09尚未通過：顧客明說「我想問，那個，我還沒說清楚」，原句retry正常重新送判斷，但得到INCOMPLETE，沒有回覆；gold要求clarify。沒有查回舊水果、錯誤訊息或訂單副作用。這是「明顯還沒說完時等待」與「使用者主動重試時應有澄清回饋」的行為／預期差異，不能把所有INCOMPLETE硬交Main，也不能臨時改gold算通過。需在現有等待／重試呈現流程解決並補對照測試後，再推進20×3驗收。

以上兩輪皆保留當時source hash manifest；後一輪不覆蓋前一輪失敗。新的提示修改已有admission regression、decision套件測試、Server typecheck及改檔lint驗證紀錄（`/tmp/kiosk-repair-restored-*`）。CUDA恢復代表能推論，不代表全部對話驗收通過；20×3及其他尚未跑的矩陣仍保留未完成。

### 2026-11-23 正式 PB 與示範網站的依賴分離

正式 Kiosk 曾直接引用 `apps/order-menu` 的 host-only 工具名稱及價格澄清文字，管理員元件也靜態引用示範測試面板。這是共用模組歸屬錯誤，不能以此要求保留正式端對示範網站的依賴。

工具名稱契約移至 `stage-shared/kiosk-host-tools`，價格文案移至中央 `orderingMessages`；測試面板改為 DEV-only 非同步載入，橋接測試頁移至 `stage-ui/test/fixtures`。正式 Vite 產物逐 chunk 的模組清單驗證沒有 order-menu、order-menu-server、測試面板或測試頁程式。這項驗證證明產物程式隔離，不代表已完成現場支付或所有延遲問題的驗收。

### 2026-11-23 代理操作前提下的讀取簡化

本階段依使用者決策，假設顧客不會同時手動操作；圖片辨識留待下一階段。`browserCartTask` 統一保存單一需求內已驗證的編輯頁資料，模型準備與工具規劃共用，重疊讀取共用同一個進行中請求。新需求、文件／工具連線更換、導航與操作派送清除舊狀態，完整操作回執可直接更新狀態；不以本地加減推算購物車。

菜單目錄可跨同店導航／結帳表單回執沿用；缺漏或不確定的回執仍重新讀取。修改已在結帳中的購物車仍重新核對表單，避免沿用舊總額或送單確認。付款結果受外部更新，因此不共用舊狀態。保留原生操作前版本／規格檢查、操作結果驗證、顧客送單同意及一次性送單。

測試先重現模型準備→工具規劃→模型下一輪的三次相同讀取，再驗證縮為一次；同時涵蓋完整回執、未知結果不重送、文件替換、需求結束、結帳欄位更新與外部付款更新。這是確定性呼叫次數改善，不等於已完成現場端到端延遲量測。
