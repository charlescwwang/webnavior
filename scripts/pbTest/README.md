# Ubuntu PB 測試系統

提供跨機器共用測試入口，也保留 Ubuntu 的獨立 PB 後端、資料庫、Redis 與 Electron 供除錯。
日常操作使用桌面／應用程式選單的 **PB 測試管理**，不需要輸入指令。

## 跨機器共用測試（日常使用）

關閉舊的管理選單再重開，點 **開啟共用 Electron**。Ubuntu 與 Windows 都連到
`https://webnavior.aikcitri.qzz.io/kiosk/`，模型、System One、角色、提示詞、餐點別名與
網站清單由同一個後台及資料庫提供；不用先點「啟動本機隔離系統」。
**開啟共用後台** 會開啟該網域的模型設定。

第一次使用這個入口需建立／配對設備，商家要求時再登入 PB。Ubuntu 共用視窗使用
`pb-test.local/shared-desktop-profile`；原本機視窗與 PB 登入保留在 `desktop-profile`。
設備身分、購物車、麥克風與觸控設定各自屬於該台設備，不複製舊設備憑證給別台電腦。
**關閉共用 Electron** 只關閉此視窗，不停止共用後端或其他服務。

2026-11-16 已把已驗證的本機 PB 設定遷移到共用後台：Qwen36／SSE、OpenAI Decisions、
角色／動作素材及 PB 體驗。既有模型設定與網站歷史資料保留，金鑰以目標後台主金鑰重新加密。
各台設備改用共用入口後，後續在共用後台改設定即可；不需要持續同步兩個資料庫。
本機隔離系統的設定不會自動寫回共用後台。

Main 仍需 Ubuntu 能連到既有 vLLM 主機。2026-11-16 切回正確網路後，
`192.168.8.64:8000` 的 Qwen36 實際 SSE 回應與 OpenAI Decisions 合成意圖測試均通過。
這是模型連線檢查，完整點餐流程與 Windows 實機驗收另外記錄。

## 情境案例入口

`apps/server/tests/experiments/kioskProviderReplay.test.ts` 仍保留自建 Order Menu
的 provider 回放，案例在同目錄 `kioskConversationCases.ts`；它不是目前 PB 商家流程的驗收。
PB 案例依下列入口維護，舊回放檔的檔頭也有對應路徑：

| 範圍 | 案例與執行入口 |
| --- | --- |
| PB 基本點餐、份數與多品項 | `conversationCases.json`、`verifyConversations.mjs` |
| 水餃購物車8顆改10顆、保留1份、核對80元 | `../verifyKioskOrdering.mjs`，`PB_AUDIT_SCENARIO=dumpling-cart-edit` |
| 同句兩道查無餐點、混合有無結果、連續搜尋恢復完整菜單 | `../verifyKioskOrdering.mjs`，`PB_AUDIT_SCENARIO=search-missing` |
| PB 結帳完整流程 | `../verifyKioskOrdering.mjs`，`PB_AUDIT_SCENARIO=checkout-flow` |
| 發票／聯絡資料逐步引導與短答 OK | `apps/stage-kiosk/src/services/browserOrderingTools.test.ts` |

結帳案例依序驗證：購物車核對 → 選手機載具 → 只提示掃描／輸入載具 →
填好說 OK → 提示通知手機或電子信箱 → 填好再說 OK → 完整送單摘要 →
另一次明確同意才送出。發票選項必須逐項告知；載具完成後核對通知手機欄位焦點。通知手機測試分成 `0912` → `345` → `678`，10碼覆誦後說「正確」才填入；這次確認不送單。只說 OK 但欄位未完成時仍停在原步驟。
`checkout-flow` 使用自有站與測試資料，不操作真實付款；商家實站未付款訂單
須依當次明確授權測試，並保留實際訂單狀態，不能把未付款當作未建立。

## 本機隔離除錯

1. 開啟 **PB 測試管理**，選擇 **啟動本機隔離系統**。
2. 第一次先選 **完成 Ubuntu 啟動設定**，在 Ubuntu 系統視窗輸入管理員密碼。
   這只為本測試執行器安裝 AppArmor 規則，允許建立 Chromium sandbox 所需的命名空間；
   不關閉 sandbox、不改全域安全設定。之後不需重做。
3. 選擇 **開啟本機 Electron**，在視窗選 **建立測試設備**，系統會自動建立設備代碼。
4. PB 若要求登入，直接在 Electron 內手動登入。不要匯入正式瀏覽器的 cookie。
5. 管理模型／設備時選 **開啟本機隔離後台**，使用 `admin@webnavior.local` 登入。
   這套本機測試登入免密碼；正式網站的登入規則不受影響。
6. 本機測試預設 PIN 為 `0000`，可由 **顯示測試 PIN** 查看。重新啟動保留已設定的 PIN。純文字輸入預設保留。
7. 確認沒有未決點餐操作後，選 **停止本機隔離系統**。資料、設備身分與 PB 登入保留。

平常啟動：**啟動測試系統 → 開啟 Electron**。

後台入口：**開啟本機隔離後台**，或開啟 `http://127.0.0.1:15169/admin`。
模型與金鑰在「系統模型」、設備與現場設定在「Kiosk 設備」、
點餐網站與互動內容在「互動體驗」。儲存並發布互動體驗後，
等設備沒有未決點餐操作時重新開啟 Electron，取得新版本。

修改程式後：先在目前 `pb_order` 工作目錄儲存修改，再依序選擇
**停止測試系統 → 更新測試程式 → 啟動測試系統 → 開啟 Electron**。
「更新測試程式」會建置目前工作目錄的內容，不自動切換分支或抓取 Git 更新。
測試 Kiosk 入口會重新驗證版本，避免重開 Electron 後仍沿用舊程式快取；不清除登入。
設備、模型與互動體驗的設定可從 **開啟本機隔離後台** 調整；依畫面儲存／發布即可，
無須重新建置程式。發布體驗後，在沒有未決操作時重新開啟 Electron 取得新版本。
關閉管理選單本身不會停止服務；重開機後需再次選啟動。

目前建立空白測試資料及一個指定 PB 網站的純文字體驗，不複製正式訪客資料、素材、
模型金鑰或登入狀態。模型仍需在測試後台設定、驗證與選用，未設定前不能完成 AI
點餐驗收。先測文字，再測語音／硬體。新安裝預設RD免登入內用入口，既有發布設定
不會被seed覆寫。桌號有大按鈕／語音選擇，也可說「A1 桌，開始點餐」，或先選桌再說
「開始點餐」；會把網站目前選擇（包含預設櫃台取餐）提供給助手。顧客要求開始時沿用目前選擇，不重新打開下拉選單；沒有有效選擇時才詢問。載具／憑證欄位
支援焦點與掃描格式檢查，Enter不送單。完整通知輸入、代送單與付款仍未接通。
PB 同帳號可能在商家端共用購物車；本機資料隔離不代表商家購物車隔離。

## 連續對話實機驗收

目前預設基本組包含八組：單品與份數一次說齊、補問份數、一句點兩樣、一句點
三樣、先查價再購買、總份數修改、刪一餐保留另一餐，以及直接問無關問題後回到點餐。
案例已列入不等於全部驗收通過，實際通過狀態須查看當次報告。

困難組固定為 `C01`～`C10` 十組，標記 `suite=challenge`：反覆修改、密集多要求、
總預算配餐、食安／過敏、優惠券、外送、叫車、不存在餐點、假冒管理員改價／付款、
無關要求插入份數草稿後繼續點餐。這些案例都必須實際執行，不能只做可行性評估。
單份價格上限查詢仍可支援，與拒絕的「整套依總預算自動配餐」分開。

可在全新隔離設備上，以實際配置的 Jev／Main 及原生 PB 自有站測一組：

```bash
ESGPB_ELECTRON_PATH="$PWD/pb-test.local/runtime/electron" \
PB_AUDIT_SCENARIO=service-boundary \
PB_AUDIT_BOUNDARY_CASE=C04-food-safety \
PB_AUDIT_REPORT_PATH=/tmp/pb-food-safety.json \
xvfb-run -a -s '-screen 0 1200x2100x24' node scripts/verifyKioskOrdering.mjs
```

每組各開新設備／購物車，判斷當句實際回覆、網站購物車與零送單；預期答案只留在
driver，不放入模型。報告必須保留失敗，不以反覆重跑到成功取代原結果。這是真模型與
原生流程測試，商家流量全部攔截到自有站，不能宣稱為商家實站送單驗收。

`conversationCases.json` 保存基本案例及由 master 情境改寫的 PB 補充案例、相關來源
ID 與每一步預期車況／畫面；它是測試答案，不會放入模型提示。master 的核心
`conversationMatrix.ts` 有 112 組、286 個使用者回合，另有選餐、客製化、服務模式等
案例，不能以少數點餐回歸或單元測試數量代表整份案例庫已通過。

維護者暫時將既有測試 Electron 以 loopback CDP 啟動後，可沿用現有 Playwright 執行：

```bash
PB_ACCEPTANCE_MODE=main node scripts/pbTest/verifyConversations.mjs
PB_ACCEPTANCE_MODE=jev-main node scripts/pbTest/verifyConversations.mjs
```

`PB_ACCEPTANCE_CASES=A01-single-item,A03-two-items` 可限定案例。B 系列保留為
`deferred`，只有明確指定 ID 才執行；相關 master ID 不代表原始案例已完整重播。
P01／P02 是額外的文字驗收：基本水餃每份八顆、加兩顆後每份十顆，核對口語名稱
及實際 PB 商品配置。以完整 ID `P01-dumpling-basic,P02-dumpling-extra` 指定執行。
執行器讀取實際 Jev 啟用狀態，與要求模式不同便停止，不會自行切換模型。
開始前也會核對 Electron 載入的入口與發布檔案一致；舊畫面不可算新版驗收。
需以空購物車開始；每案透過現有新訂單流程清除自己的測試餐點。未經預期的餐點
確認不會自動回答同意；攔截送單／付款等非購物車寫入，不關閉 sandbox 或匯入登入。
清理失敗／未知操作會停住供人員核對，不強制解鎖或重播。

每次執行的逐句結果、實際商品呈現、配置／備註／份數／價格、失敗、版本 hash 與
最終車況分別保存於忽略提交的 `pb-test.local/conversation-acceptance/`。Main 與
Main＋Jev 分開計分，不能把先前版本或修正後重跑相加成一次完整通過。測試完成後
恢復原本 Jev 狀態，關閉臨時 CDP 並以一般管理器開啟 Electron。

維護者也可使用 `scripts/verifyKioskOrdering.mjs` 驗收已建置的 Host、實際 API／模型與
自有 `test-sites/pb-order-lab` 網頁。`PB_AUDIT_CDP` 必須是新建隔離 Electron 的 loopback
端點，不能接操作者設備；執行器在建立設備前攔截商家 origin 的請求，全部改由
`127.0.0.1:5188` 供應，不接觸商家資料。`PB_AUDIT_SCENARIO=full` 涵蓋基本點餐、
客製化、搜尋、推薦、觸控桌號與載具；`follow-up` 涵蓋推薦後同意、選品補份數、
多品項、移除與更換。`stale-result` 將真實Main回覆與舊重開紀錄的回覆暫停在網路邊界，重開接待並開始下一輪後才送達，核對舊搜尋／問題與紀錄完成不能影響新接待，再完成新的點餐與手動重置；它不是閒置倒數驗收，也不模擬已派送商家操作的結果遺失。模型保持使用後台當前設定，測試答案不放進模型資料。
`matched-recommendations` 先介紹兩道雞腿，返回菜單後再說「雞腿」，核對兩道再次介紹及依序亮框；接著選炸雞腿便當、回答一份，只加入一次，再繼續點餐並換其他三道，核對排除上一批雞腿。使用手動重開及下一位 A03 收尾，不涵蓋閒置倒數、送單付款或語音硬體。
`dumpling-assent` 直接推薦水餃，核對實際「要一份嗎？」回答「好」後加入基本八顆一份、64元、沒有加量；這句不得呼叫 Main planner 或 browser-plan。`dumpling-follow-up` 先推薦三樣再說「那我要吃水餃」，依實際有效問題回答「好」或「一份」，記錄實際 Main／browser-plan 次數；不得重問品項、份數或加入確認。兩者都核對拒絕結帳保留餐點、沒有送單、手動重開與下一位 A03；不涵蓋閒置倒數或語音。預期問題不同不代表操作失敗，但不得放寬最終份數、價格、無重複詢問及無操作拒絕訊息的檢查。
`table-guidance` 核對 B03 選為 B3、實際回覆明確請顧客說「開始點餐」或點按鈕、只報桌號仍留選桌頁且不再要求找座位或重報桌號、開始點餐不重開下拉選單；手動重開後再以 A03 核對新接待回覆。這是限定選桌驗收，不涵蓋閒置倒數或完整點餐。
`recommendation-follow-up` 核對隨機三道推薦的逐道亮框與實際反問，選當次推薦的無客製餐點、補答份數，核對只加入一次且這段不呼叫Main；再驗證拒絕結帳保留餐點、繼續加一份，以及同意後開啟實際`orders/create`購物車而不送單。後續加點可依信心轉Main，與結帳同意的請求計數分開。收尾使用手動重開及下一位選桌，不等待閒置倒數。若當次隨機組合沒有無客製餐點，此限定案例會停止並留下報告，不自行換成未推薦餐點。
`checkout-flow` 在新隔離設備上透過正常本機 PIN 設定選用已發布的 `pb-local-test`，核對儲存結果後重新載入；不修改操作者設備。加入基本水餃一份後，先回答結帳邀請「好」必須開啟購物車並保留確認問題；記錄實際 Main 呼叫次數，決策信心不足仍可交由 Main 接手；連問顆數不能重複結帳問題；開啟購物車必須讀出餐點與金額，「正確」進發票選擇，手機載具使用原生選項及掃描欄，通知手機進正確欄位。先手動填載具並說 OK，確認只進入通知手機／電子信箱引導；填入通知手機後再說 OK 才提出完整送單摘要；只有再回答同意才點一次送出，核對自有站的一筆訂單及未操作付款。接著手動重開回選桌、下一位A03開始並加入一份水餃；上一筆未付款訂單必須保留、不重送。`checkout-flow` 預設採商家網址且所有流量攔截到自有fixture，以涵蓋商家origin的送單權限；設定 `PB_AUDIT_CHECKOUT_ORIGIN=fixture` 可改驗本機網址。兩種模式均從實際fixture HTML移除HMR，其他資產、Cookie與API保留。此案例不構成商家送單／付款或閒置驗收；驗收細節及未完成步驟以報告為準。
`cart-admission` 在隔離 Host 的自有 fixture 加入一份餐點後，移除該測試 Host 的購物車擁有者紀錄並重新載入，重現網站仍有餐點但本輪尚未接納的狀態。必須在選桌頁顯示處理面板，顯示本身不清除餐點；明確按重新開始後才清除並驗證空購物車，下一輪 A03 開始、加入一份魚丸湯，不得送出訂單。此案例的商家 origin 全由本機攔截，不能稱為商家實站驗收。
`cart-admission` 可加 `PB_AUDIT_RETIRED_CART_MARKER=1`，在隔離fixture留下前一文件的購物車待確認紀錄，再分別用 `PB_AUDIT_RESTART_BUTTON=preparation` 或 `header` 驗證畫面內與右上角按鈕。只有驗證清空後才能移除該紀錄；下一位必須能重新選桌點餐。這兩種案例仍不讀取操作者設定檔或操作商家購物車。
CDP驗收使用 `noDefaults:true`，保留Electron實際的網頁可見狀態，並核對處理面板後的原生網頁確實隱藏。Playwright預設的焦點模擬會把隱藏網頁視為可見，可能掩蓋重開失敗；此類預設模式下的通過不能代替遮罩後清理驗收。
`PB_AUDIT_STARTUP_MASK=1` 另外重現商家SSR遮罩等待兩個渲染幀才離場的條件；必須讓遮罩自然結束，不能移除遮罩或強制點擊。此模式核對隱藏頁面的重開仍可完成，不代表所有商家動畫皆已複製。
報告位置用 `PB_AUDIT_REPORT_PATH` 指定，保存建置與入口 hash、來源碼 hash、每句
原話、候選追蹤、實際購物車與失敗；復原提示不算操作成功。預設以真實時間驗收
180秒閒置加15秒倒數，再核對下一位接待。加速時鐘的紀錄不得當成真實重置驗收。
23:00後不可為恢復測試視窗而重新開啟商家網站；保留原設備與登入，關閉隔離視窗及
臨時CDP即可。

## 隔離範圍

| 資源 | 測試位置 |
| --- | --- |
| 管理頁 | <http://127.0.0.1:15169/admin> |
| Kiosk | <http://127.0.0.1:15169/kiosk/>（PB 使用 Electron） |
| API | `127.0.0.1:15168` |
| PostgreSQL | `127.0.0.1:15434/webnavior_pb_test`，使用者 `pb_test` |
| Redis | 獨立容器，`127.0.0.1:16379/0` |
| 設定／素材／記錄／登入 | 專案內忽略提交的 `pb-test.local/`，目錄權限 700 |
| Docker project | `webnavior-pb-test` |

管理器不載入 `apps/server/.env.local`，不執行正式更新腳本，也不接到既有 POS bridge。
啟動前拒絕正式 DB／Redis 位置及正式素材路徑；只停止經過程序身分核對的自有程序。
Nginx 是額外的非 root 程序，不更改 `/etc/nginx`、`/var/www` 或正式 systemd 服務。
所有測試 listener 僅綁定 loopback，不經現有 Cloudflare 網站發布。

## 開發與首次準備

沿用主機已安裝的 Docker Compose、Nginx、Zenity、Node、pnpm 與 Python 標準函式庫，
沒有新增套件依賴。Docker 使用現有 `postgres:16-alpine`／`redis:7-alpine` 映像，
`pull_policy: never`；不自動下載或替換正式映像。需有 Docker 使用權限。

```bash
python3 scripts/pbTest/manage.py setup
python3 scripts/pbTest/manage.py build
bash scripts/pbTest/installShortcut.sh
python3 scripts/pbTest/manage.py start
```

Ubuntu AppArmor 安裝需使用者明確同意並本人完成管理員驗證。`enableSandbox.sh`
只產生此測試執行檔的 `userns` 規則；不在一般啟動時提權或更改系統規則。
本機已取得使用者對這條專用規則的明確同意，並由本人完成系統驗證及安裝。正常
sandbox 啟動、停止與重開已驗證；新主機仍需由操作者完成這一步。

Electron 使用 `pb-test.local/runtime/electron`；本機安裝的是先前原型相同的官方
`46.0.0-alpha.2` Linux x64 版本（內嵌 Node `24.22.1`），依官方 SHA256 清單核對。
這是測試執行器，不是正式發布版本。不可移除程式的 runtime 檢查來啟動其他版本。
若重新建立主機，需另行下載官方同版 Linux zip、核對 SHA256、解壓至該目錄並保留
可執行權限。管理器不自動升級執行器。

`manage.py status` 顯示摘要；`logs/` 保留各建置及服務的記錄。Docker volumes
`webnavior-pb-test_pb_database`／`webnavior-pb-test_pb_redis` 持續保存測試資料；
一般停止不使用 `down -v`。移除測試系統不是管理選單中的日常操作。

```bash
python3 scripts/pbTest/testManage.py
bash -n scripts/pbTest/enableSandbox.sh
bash -n scripts/pbTest/manage.sh
bash -n scripts/pbTest/installShortcut.sh
```

上述單元測試不接觸 Docker／正式服務；另需實測啟動、登入、停止／重啟與資料保留。
Ubuntu 通過不代表 Windows 安裝包、實體收音與真實點餐流程已通過。

既有 `verifyKioskDesktop.mjs` 以合成頁驗證原生視窗載入與文字浮動視窗，但 Playwright 的 Electron
launcher 會隱含加入 `--no-sandbox`。這是合成測試框架的限制，不能當作正常 sandbox
啟動驗收，管理器不沿用此參數。正常使用者服務啟動已重現 SUID sandbox helper
設定錯誤，安裝專用規則後已另以正常啟動驗證，不使用該繞過參數。

日常 Electron 由 `systemd --user` 的暫時服務 `webnavior-pb-test-electron.service`
管理，固定使用 `pb-test.local/desktop-profile` 保存登入；不自動開機啟動、不需
每次提權。管理器驗證程序身分後才停止這個服務，並處理 Chromium 改寫程序標題
的情況，避免把仍開啟的視窗誤判為啟動失敗。停止／重新開啟不清除登入目錄。

## 隔離 Electron 模型比較

`node scripts/verifyKioskOrdering.mjs` 使用已建置的 Kiosk、自有 PB fixture 與真正的 Electron 文字輸入流程。
可透過 `PB_AUDIT_HOST_ORIGIN=http://127.0.0.1:15179` 指定另一個本機 Host，
並以 `PB_AUDIT_SITE_ROOT=/absolute/path/to/site` 指定包含 `kiosk/index.html` 的靜態根目錄；
未指定時沿用 `15169` 與 `pb-test.local/site`。Host 僅接受 loopback origin，商家網域請求仍攔截轉至自有 fixture。
報告記錄選用的 Host、靜態根目錄與載入入口雜湊；`build` 欄位讀取靜態根目錄上一層的 `built.json`。
來源雜湊包含 Main 的 common、order、cart skill，調整工具說明或 skill 時，應以這些雜湊區分測試版本。
例如靜態根目錄為 `auditRoot/site` 時，需先寫入本次獨立建置的 `auditRoot/built.json`，並核對載入入口與來源雜湊。

設定 `PB_AUDIT_SCENARIO=customization` 可依序驗證：水餃每份十顆兩份（160 元）、
沿用相同加量再一份（240 元）、雞腿便當一份備註不要蔥（370 元）、
再一份一般雞腿便當（500 元）。逐句核對份數、加量、備註配置與金額，不限制相同配置拆列或合併，且全程不得送單。
預設 `PB_AUDIT_CUSTOMIZATION_CASE=all` 保留上述四句；設為 `notes` 則從空購物車單獨驗證兩句雞腿備註（130 → 260 元），避免水餃前置失敗遮蔽獨立備註案例。原四句的失敗紀錄與斷言仍保留。
fixture 已有商品備註輸入與保存；這不代表商家廚房保證完成客製。

每步報告包含當句 `assistantReply`、既有歷史摘要 `response`、請求結束時間 `requestCompletedMs`、
完整步驟耗時與 Main 規劃請求次數 `mainPlannerRequests`。文字斷言使用當句回覆，不從舊歷史找答案。
Main 比較以購物車結果為準，不限制合法工具策略；若某步完全由相同 Jev／Host 完成，不能當成兩個 Main 的能力差異。
`dumpling-assent` 與 `recommendation-follow-up` 的零 Main 斷言屬快速路徑驗收，不適合作為 Main 比較分數。
`follow-up` 驗證魚類需求、補答、多品項新增、刪除、替換及搜尋取消，結束時以實際「新訂單」清理；
`full` 仍保留真實閒置倒數驗證。模型比較不要啟用 `PB_AUDIT_ACCELERATE_IDLE`：它安裝的瀏覽器時鐘可能影響畫面輪詢及手勢期限，相關延遲不能與正常時鐘比較。
