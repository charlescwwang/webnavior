# Codex Handoff

## 2026-11-24 Kiosk RC10 已發布

- 共用 Kiosk 前端已更新至 `kiosk-rc10-20261124-r1`。顧客取消選餐後依購物車狀態接結帳邀請或另一道推薦，答應結帳後才進購物車核對。換客重置可接受沒有搜尋欄的完整菜單。
- Windows x64 可攜包與前端均來自 `5bd097e0`；最新包指標已更新。四入口與主程式共九項 HTTP 檔案核對、共用入口取消流程程式檔、ZIP CRC 與 81 個檔案雜湊均通過。API 保持原程序且健康。
- Kiosk 1293 項通過，另有 1 項預期失敗和 49 項略過。PB 控制項瀏覽器測試 39 項通過。Electron 無搜尋欄換客測試通過，完整桌面測試停在既有的離屏品項提示斷言。Windows 機台驗收待完成。[發布紀錄](releases/kiosk-v0.7.8-rc.10-deployment.json)

## 2026-11-24 Kiosk RC9 已發布

- RC9 包含語音對話去重、語音排隊逾時清理、可見購物車核對／清空後回菜單與選桌後菜單載入失敗診斷。Kiosk 四入口核對完成，Web 同步產品版號，API 健康。Windows 實機安裝與首次開頁慢的現場驗證待完成。[發布紀錄](releases/kiosk-v0.7.8-rc.9-deployment.json)

## 2026-11-24 Windows RC8 與管理前端已發布

- 管理端 `web-v2026.11.24.2` 統一點餐網站設定入口，餐點別名依網站收合。Windows `0.7.8-rc.8` 配對 `kiosk-rc8-20261124-r1`，支援待付款訂單的付款方式選擇與切換。正式 API 已套用兩項付款提示／辨識用語變更，公開 db、redis 健康。
- [發布紀錄](releases/kiosk-v0.7.8-rc.8-deployment.json) 包含版本、Windows ZIP 位置、校驗碼與驗證結果。可攜包已更新最新版本指標，Windows 實機安裝與驗收待完成。

## 2026-11-23 Windows RC7 與正式前端已發布

- [發布紀錄](releases/kiosk-v0.7.8-rc.7-deployment.json) 包含 Windows x64 可攜包位置與 SHA256。四個前端入口共九項 HTTP 位元組核對通過；本機與公開服務 db、redis 健康。Windows 機台仍待安裝及實機驗收。

## 2026-11-23 正式 PB 送單回應與重複讀取交接

- 正式 PB 非營業實測已確認。使用者在獨立 Chrome 視窗手動送單一次，台北時間 20:11:11 發出送單 POST，PB 回 302。重新導向 GET 回 200，頁面為 `Order/Create`，`props.errors.diningTime` 帶回「目前非營業時間，暫時無法點餐。」；隨後畫面顯示同一文字。送單前的結帳 GET 沒有該錯誤。
- 本機已修改送單、購物車回執、結帳邀請與菜單查詢。Electron 桌面程式在最終確認時觀察當次送單 XHR 的重新導向回應，核對同源結帳頁及 Order/Create 後取 order 或 diningTime 原文。無法辨識的結果保留既有防重送。正式售完格式、成功收單、Windows 現場與兩段延遲仍待驗收。
- 改份數、刪除、清空可沿用已核實的最後明細；回菜單和準備結帳傳回操作中取得的明細。加餐先呈現，再以只含購物車的讀取綁定結帳邀請。Main 的初次完整觀察可一併取得重試依據。文件內品項索引按取餐時段及人工操作版本沿用，原生寫入仍重新驗證。
- 本機 Electron 回放 POST／302／GET 非營業、模擬缺貨及無錯誤三例。既有付款回歸涵蓋 LINE Pay、信用卡及表單 POST。未部署；正式驗收需要含此次原生變更的新版桌面程式。[實測與五項驗收條件](plans/2026-10-22-kiosk-field-investigation.md#2026-11-23-pb-資料傳遞與送單回應交接)。


## 2026-11-23 Agent-only task observation reuse

- User explicitly chose no simultaneous manual website operation for this phase; screenshots are deferred. Existing browserCartTask owns one per-task validated editor snapshot, shared by model context and tool planning with single-flight overlapping reads. Full catalog satisfies smaller reads; smaller reads do not invent products. Snapshots/results copied and isolated by task, execute function and discovery tool-array identity.
- Invalidate before effect or new dispatched read. Late replaced-document reads cannot repopulate state. Complete verified cart receipts replace the whole cart (no arithmetic deltas); navigation/checkout receipts update page/form data while retaining unchanged same-store catalog. Missing/unknown/throwing effects leave no snapshot. Existing checkout/open-item state forces refresh after cart edits. Table/payment/recovery remain live. Native prewrite version/spec checks, readback, final consent and one-use submit are retained.
- Regression-first: initial6 tests had4 failures, including unchanged preparation→planning→preparation issuing3 reads; now1. Added14 cases for reuse/coalescing/verified receipts/unknown/no replay/new task/document switch/read refusal/navigation/partial receipts/live payment/form receipt/form invalidation. Updated old login fixture to refuse on state rather than the obsolete third-read count; new effect-time refusal case proves exception propagation, not a live merchant login problem or new login requirement. Existing manual-change protections at the native write boundary remain.
- Kiosk1220 pass/1 expected fail/49 skip;24 checkout/payment browser pass; Kiosk scoped typecheck and changed-code lint pass. No root typecheck. No new library, screenshot, ASR/TTS/model/native code change. End-to-end field latency/Windows acceptance not measured. Final production build and module audit pass (2921 emitted modules,0 demo/test modules). Deployed kiosk-task-reads-20261123-r1 from 313485df;96 changed files,9 HTTP byte checks,local/public db+redis ready,API PID421721 unchanged. Evidence in release-stage validation; tracked docs/releases/kiosk-task-reads-20261123-r1.json. Existing RC6 ZIP/tag unchanged; latest pointer paired frontend updated; no new EXE required.


## 2026-11-23 Production PB / demo dependency separation

- User challenged production PB depending on the test application. Removed Kiosk runtime imports from apps/order-menu: host-only tool names now belong to stage-shared/kiosk-host-tools; price clarification copy belongs to central orderingMessages. No compatibility re-export from the demo app.
- Moved operator simulation component to Kiosk devtools and replaced its static import with a DEV-only async import. Moved bridge fixture pages from stage-ui/src/services/fixtures to stage-ui/test/fixtures, updating integration tests. Demo runtime remains available to isolated development/tests only; no demo website deletion needed for this boundary fix.
- Production Vite chunk-module audit:2921 emitted modules,0 demo/order-menu-server/devtools simulation/test fixture modules. Kiosk1206 pass/1 expected fail/49 skip,pricing87 pass,bridge browser20 pass,simulation browser1 pass. Kiosk/order-menu/stage-ui/stage-shared scoped types and changed-code lint pass. Root typecheck not run. No ASR/TTS/model/checkout policy/native executable change. Deployed kiosk-production-boundary-20261123-r1 from 0b17b64;99 changed files,9 HTTP byte checks,local/public db+redis ready,API PID421721 unchanged. Evidence retained in pb-test.local/kiosk-production-boundary-20261123-r1/validation; tracked release record in docs/releases. Existing RC6 archive/tag unchanged; latest pointer paired frontend updated. No new EXE required.


## 2026-11-23 Past-fix regression audit and follow-through

- User asked what old Menu means, challenged recording expiry, and requested checking prior organized fixes for active misuse. Audited handoff, October conversation-repair/service-recovery plans, current native/owned protocol paths, capture lifecycle/FIFO, quantity/checkout wrappers, table guidance, background-mode direct rules, and production audio entry. CodeGraph status0 pending; graph is supplementary because Vue callback edges are incomplete.
- Confirmed normal reserve('asr') has no queue deadline, completed transcripts survive long preceding requests, concurrent voice candidates remain valid through Main/tool/new captures. Only cancellation/reset/dispose retires capture ownership. No TTL removed in this audit because it was already removed previously. Renamed diagnostic stale-capture to retired-capture; do not call it an expired recording.
- Found active old protocol detection in handoff/gesture paths: browser_observe disappears on payment pages. Existing kiosk-fast-path domain now owns conversationSource via browser_state_get, used consistently across entry/handoff/Main; native read-only pages cannot acquire owned Menu restrictions. Owned Menu remains supported for its own app, not a PB fallback.
- Found actual reported quantity→invoice issue: lower-level dialogue NEW_REQUEST test existed, but executeBrowserQuantityQuestion returned its old-question resolver before checking an explicitly named current meal. Wrapper regression first failed, fixed through existing pauseCheckout only for a validated explicitly mentioned/aliased meal. Old invoice/contact fields and cart persist; next quantity answer resolves same meal, no order submission. Non-mentioned model target cannot retire checkout.
- Found old separate-Start text in native table state and recovery translation despite the earlier auto-start Host/prompt fix. Host now owns current table guidance instead of replaying native/default-choice text, so deployed RC6 hosts can use the corrected frontend without another EXE. Native source string also synchronized for the next complete build; no native contract/algorithm change.
- Updated existing docs/plans/2026-10-28-kiosk-conversation-repair.md with an audit table and historical owned-Menu scope. No background filter/TTS/audio changes, no customer/order/ASR-content external requests. Full field/Windows acceptance remains separate. Targeted voice/queue/lifecycle/protocol/dialogue tests and existing submission/payment browser regressions passed; Kiosk1206 passed/1 expected fail/49 skipped;24 browser checkout/payment and18 server direct-policy pass. Stage-ui/Desktop scoped types pass; task-caused boolean/string comparison fixed and standalone Kiosk types pass. Changed-code lint and frontend build pass. Deployed kiosk-flow-audit-20261123-r1 from e9fec4e (98 changed files,9 HTTP byte checks), local/public readyz db/redis ok; API PID421721 unchanged. docs/releases/kiosk-flow-audit-20261123-r1.json records scope. Existing RC6 ZIP/tag untouched, latest pointer paired frontend updated; no new EXE required because Host owns the updated table guidance. No new Windows package required or built for this audit.

## 2026-11-23 RC6 submission recovery and speech diagnostic repair

- User says background filtering is off, asks not to work on paid TTS and to fix recurring false failure messages. Prior assistant interpretation of submitted=false as possible filtering was imprecise: it is utterance queue admission, not ASR request submission. Direct off/observe tests18 confirm no IGNORE candidate; ASR disposition now explicitly records empty-transcript/cancelled/stale-capture/presence-changed/recognition-failed/submitted, recognized character count and active background mode. Cancelled captures use interrupted diagnostic status. No filter/ASR/VAD/TTS policy changes.
- Latest field yWT... seq698 actually dispatched submit, seq699 returned order-submission-result unknown/invalid-result-format; seq700 incorrectly used generic cart review and seq703/705/708 recovery failed Menu recovery tools unavailable despite native ready. Reproduced old bootstrap Order/Create after SPA URL change; native checkout now injects shared fresh same-order HTTP reader rather than data-page bootstrap. Fresh read failure stays pending, submit remains one-use. Recovery recognizes native payment/result state without legacy Menu tools. Submission receipt guidance retained, no false generic cart-error substitution.
- Auto-review rejected readonly external fetch containing actual order ref; not retried. Existing local capture and isolated browser fixture used instead. No real order submit/payment. TTS is out of scope. Logs in /tmp/recovery-*.log until copied to release stage. Kiosk1201 pass/1 expected fail/49 skip and server direct18 passed; scoped types/browser final recorded at release checkpoint. RC6 native change requires complete new EXE package; RC4 tags/packages unchanged. RC5 was an internal immutable source checkpoint, never deployed/packaged; final review also found Main prepareRound checked browser_observe (editor-only) and fell into owned Menu on payment pages. It now retains the captured native owner and skips editor retry capture for read-only result documents. RC6 deployed kiosk-rc6-20261123-r1:97 changed files,9 HTTP bytes checks, local/public readyz db/redis ok; API PID421721 unchanged. Source b0d240ac9658e29851cb6124e0afc83218498405. ZIP Webnavior-Kiosk-v0.7.8-rc.6-Windows-x64-20261123-130559.zip SHA256 b6b3eda7c9967f59d8e18d58d8d5801f16e8050e1275c0db1a832a70974202fa;81 hashes/CRC/compiled main-preload-PB match, native offline payment fixture passed. stage-ui/Kiosk/Desktop scoped types,24 browser cases,1201 Kiosk units,18 server policy tests and changed-code lint pass. Latest pointer updated, docs/releases/kiosk-v0.7.8-rc.6-deployment.json records scope; Windows/full field pending. No API restart/push/TTS/filter setting change.

## 2026-11-23 Spoken table server prompts activated after authorization

- User reported password entered. Initial audit still found original runtime/PID400244; retried normal systemctl authorization, succeeded PID421721. Both common/table prompts and tool description match staged after hashes (runtime-only review_required guard retained). All9 frontend HTTP byte checks repeated and local/public readyz db/redis ok. Supersedes pending prompt limitation below. Frontend and backend now agree on valid spoken table→Start and reselect mechanism. RC4 ZIP unchanged, no EXE upgrade needed for this feature. Deployment record/latest pointer updated.

## 2026-11-23 Spoken table selection now starts ordering

- User requested direct Start after a valid spoken table, with correction for wrong speech/ASR. Host table selection now dispatches combined browser_start_ordering once; preserves live approximate-table confirmation, missing/ambiguous rejection, one-use answers, menu readiness and matching-table readback. Confirmation wording and public select_table semantics/common+table prompts agree. No native contract change.
- Table-only utterances retire the task after its navigation receipt; compound food requests stay uncovered. Menu acknowledgement names the verified table and teaches「重選桌號」. Existing same-store return_to_table preserves cart, retires local pending questions, and does not select a replacement/submit; fast-path candidates now include「桌號錯了」「重選桌號」. New table requires fresh choices. No reception restart or cart clear.
- First test reproduced old select-only behavior, then Kiosk1199 pass/1 expected fail/49 skip, shared23, server skill5, Kiosk scoped types and changed-code lint passed. Root checks not run. Existing RC4 native host supports these operations; no new EXE is required for this frontend/prompt change. Physical field ASR acceptance not performed. Frontend kiosk-table-entry-20261123-r1 deployed from source5210652 (97 changedfiles, 9 HTTP byte checks), local/public readyz db/redis ok, API PID400244 retained. No new EXE/package/tag; existing RC4 host supports it. API prompt/tool-description restart authorization timed out, originals verified restored; staged source preserves runtime-only review_required gate. Backend prompts pending authorization, Host independently enforces auto-Start even for select_table. Deployment record docs/releases/kiosk-table-entry-20261123-r1.json; artifacts pb-test.local/kiosk-table-entry-20261123-r1. User notified and asked whether password dialog appeared.

## 2026-11-23 RC4 server history activated after renewed authorization

- User clarified that the password authorization dialog disappeared before they could type. Retried systemctl through the normal system authorization flow (no sudo), user completed authorization, and deployment succeeded. Two runtime files match committed after hashes; API restarted PID137553→400244; local/public readyz db/redis ok and all 9 frontend HTTP byte checks passed again. History cap12/6000 and recovery-guidance context filtering are now active; full archive preserved. This supersedes the earlier pending-history limitation below.
- RC4 deployment JSON, latest package pointer and Desktop README updated. Existing RC4 ZIP/source tag are unchanged, no rebuild needed. Runtime backup stage/api-before; api-activation.json records success. No new Windows/full payment claim.

## 2026-11-23 RC4 manual payment / announcement / history fixes

- Field confirms RC3 was restarted and manual LINE Pay clicks also fail; credit must remain usable. Electron blocked cross-origin redirect/popups and the PB adapter disabled credit. RC4 admits same-order merchant LINE/credit wrappers and initial pinned gateway, preserves named-window POST in owned view and HTTPS authentication, emits manual-payment with no PB tool authority, and rediscovers only after supported merchant return. No real payment/order submission during validation.
- Actual payment state reproduced HTTP409 because native read omitted rendered X-Inertia-Version; live readonly red→green verified. Ordinary menu reads now dismiss observed business announcement before context; actual isolated native test acknowledged initial notice and completed three cart cycles, adding/removing one draft only.
- Recent archive independently shows Main context-unavailable before later optional browser_present rejection. Optional speech/cleanup presentation no longer revokes connection; normal loading waits and manual payment settles without error. New metrics retain native failed receipt/context exception details; do not claim the later cue explains every earlier field failure.
- Model context capped 12 messages/6000 chars, recovery guidance filtered from inference only; full durable archive retained. Two server domain modules require runtime update/restart. No screenshot recognition, audio/model configuration change.
- Kiosk 1190 pass / 1 expected fail / 49 skip; Desktop43, Stage UI targeted95, Server190, browser42, five scoped package typechecks and changed-code ESLint pass. Checked scripts/verifyKioskPayments.mjs verifies offline real Electron navigation/credit POST/provider isolation, zero real payment requests. Windows physical/full formal field flow pending, no stable claim. Logs/private customer evidence in ignored pb-test.local/field-errors-20261123-r1; never commit raw logs. New immutable RC4; RC1/2/3 unchanged. Frontend kiosk-rc4-20261123-r1 deployed (98 changed files, 9 HTTP byte checks), API PID137553 remains ready. Archive Webnavior-Kiosk-v0.7.8-rc.4-Windows-x64-20261123-120801.zip SHA256 8a9669d1edc3227de8cfd17d8e5d1a2ce3e4f2103f8fe2a9c0e32097736108ce; 81 payload hashes/CRC/main-preload-PB/source commit b598ef9 match, latest pointer updated. Final rebuilt native payment fixture passes. Server history shortening NOT active: systemctl restart authorization timed out, sudo denied by NoNewPrivs; original two runtime files verified restored and original API healthy. Do not imply a completed server deployment. docs/releases/kiosk-v0.7.8-rc.4-deployment.json records the limitation; runtime backup in stage/api-before-first-attempt. User was informed. No Git remote push.

## 2026-11-23 Windows 包檔名納入版本號

- 使用者要求往後檔名必須有版本號。packagePortable.py 現在由Desktop package.json取得version，產生 `Webnavior-Kiosk-v<version>-Windows-x64-<timestamp>.zip`；checksum檔沿用同名規則，Windows README已更新。
- 本次RC3 ZIP已改名為 `Webnavior-Kiosk-v0.7.8-rc.3-Windows-x64-20261123-110857.zip`，相鄰sha256、最新包metadata與deployment記錄同步更新。改名前後SHA256仍為f0148f2f31f3abeac83d567d9fbd006171c9d2efdb863130eecbc22167aae853，內容／內嵌來源commit與正式前端均未變更，沒有重部署。`archive-rename.json`保留對照，Python語法檢查與diffcheck通過；單純命名修改未重跑應用測試。


## 2026-11-23 RC3 部署與 Windows 打包完成

- 使用者明確要求部署與打包。包版本改為0.7.8-rc.3以區別舊0.7.8，來源commit 95ad652625c144024ec068a41b73b9b203379809（RC3修正加包版號／說明），不移動既有RC tags、不宣稱stable。Windows README與包內先看我已更新。
- 前端發布 kiosk-rc3-20261123-r1，/var/www/airi/kiosk 共96 changed files，備份舊入口、保留舊hash資產，index最後切換。四入口index/version＋公開entry JS共9項HTTP bytes核對通過；API PID137553保持不變、無restart，公開與本機readyz均db/redis ok。未變更API、資料庫、模型、收音或PB商家服務。
- Windows x64包 Webnavior-Kiosk-Windows-x64-20261123-110857.zip，163763236 bytes，SHA256 f0148f2f31f3abeac83d567d9fbd006171c9d2efdb863130eecbc22167aae853；官方固定Runtime SHA／PE x64／ZIP CRC／81檔payload hashes及main/preload/pb編譯輸出一致均通過，包內version 0.7.8-rc.3與sourceCommit已核對。未簽章，Windows實機仍待驗收。Electron原生載入fixture通過；修正本身3次live cart cycles與100 scoped unit等見RC3記錄。
- 證據與回復資料 /home/aimax/webnavior/pb-test.local/kiosk-rc3-20261123-r1/；deployment正式記錄 docs/releases/kiosk-v0.7.8-rc.3-deployment.json。/tmp/latest-windows-portable.json已更新且舊檔備份在stage。舊Windows ZIP不含本次修正，現場需完整退出並整包解壓新資料夾；保留LOCALAPPDATA設備／商家登入。只刷新網頁不足以更新native PB adapter。未自動操作現場Windows機台，未push Git遠端。


## 2026-11-23 菜單轉購物車實測根因與修正（RC3，未部署）

- 使用者補充最常在菜單轉購物車後顯示完整資料讀取失敗；真 Linux Electron/native IPC/PB 隔離profile重現：購物車導航與 includeCatalog=false 成功，includeCatalog=true 三次皆拒絕。HTTP證據為裸 menu 302 至同店 menu?table=... 再200；原本 response.url 必須等於request URL，把正常canonical redirect當登入錯誤。並非已證明商家改版或此次由跨document競態造成。僅保留rendered link參數的嘗試沒有解決，已移除該嘗試。
- pbRoutes.matchesPageResponseUrl 只接受同店裸guest menu補上一個非空table參數；登入、選桌、跨店／來源、cart redirect、替換明確table、額外query皆拒絕。pbBrowserService仍驗component/buyer/store/flow，payload URL對final response URL核對；不刪guard、不新增模型／查詢、不重播寫入。
- 同次實測發現首次add讀回會短暫出現subtotal0/details[]/order.hash=null；readCartPage要求string導致輪詢立即拋錯、結果unknown。已補先紅後綠測試，只接受這個明確空草稿，保持orderRef未指派，讓既有readback poll繼續等原add；非空／非零或缺details仍拒絕。不是任意忽略parse錯誤。
- 修後真Electron連續3次menu→cart→完整context→return menu皆成功；一份草稿只add一次，最後remove並核實空車，無送單，profile刪除。100個PB/routes/transport定向unit、stage-ui/desktop types、變更程式eslint、Electron main/preload/PB build、diffcheck通過；未重跑root checks。不是正式Vue/API/LLM/ASR或Windows實機驗收。
- Artifacts pb-test.local/cart-transition-20261123-r1/：pre-fix三次失敗、HTTP302證據、最初空draft失敗及最終成功結果、unit/types/lint/build與summary。新immutable tag kiosk-v0.7.8-rc.3，RC1/2不移動。舊ZIP不含修正；沒有新Windows包、push或部署。全域service-recovery鎖定流程是另個尚未此輪變更的問題，不把共用錯誤提示當作該鎖定的證據。


## 2026-11-23 PB 資料缺口修正（RC2，未部署）

- 使用者要求直接修正已發現漏洞。新增 stage-shared `pb-browser-state` 中立契約，按 table/editor/order 分頁驗證；editor 必須明確提供有效 cart.version 與 cart.lines，不再將缺明細預設為空車。includeCatalog=true 另要求 products/configurations；空 configurations 仍代表未核實，不授權猜測規格。
- Fast Path 在 pending answer/search 等分支前先驗證；Main browserCartTask 內所有原生呼叫經同一邊界，對 state/cart read、cart_review、return_menu 驗證；其餘工具回執保持原有語意。Native PB table/editor/full catalog/menu return 使用同一契約。不增加 LLM 呼叫／網頁查詢，保留價格、版本、規格與寫後核對；不恢復顧客歸屬 gate。
- 先寫 browserStateContract.test.ts 重現，再修產品。57 個新 regression cases 覆蓋缺來源／ok／頁面／版本／rows／row ref、非法數量、Main 寫入與模型上下文、導航回執、pending/search、舊候選作廢及 catalog-free 正常導航。舊 fixtures 改為 native 真實必要格式；RC1 看購物車失敗亦修正。
- Kiosk 1187 pass / 1 expected fail / 49 skip；Desktop39、PB cart/catalog/product70、既有 native receipts離線重播19通過。stage-shared/stage-ui/stage-kiosk/desktop scoped types、變更程式 ESLint、diffcheck、Electron main/preload/PB bundle build通過。root typecheck/lint 未重跑；RC1已記錄全域既有 lint 4047 errors。日誌 pb-test.local/contract-fix-20261123-r2/。
- RC1 不移動；修正建立新 kiosk-v0.7.8-rc.2，詳 docs/releases/kiosk-v0.7.8-rc.2.json。EXE package version仍0.7.8，沒有新Windows ZIP、遠端push或正式服務切換；舊ZIP不包含本次修正。Windows實機、live端到端點餐與正式延遲驗收仍待完成，不宣稱stable。不加入PB截圖或變更模型／收音。


## 2026-11-23 圖片前候選版版控整理（驗證未完成）

- 使用者明確要求先保存圖片功能加入前的可運作版本，授權開始版控處理，並補充「尚未完成驗證」。已從pb_order/f593ac9建立 `codex/kiosk-text-rc-20261123`；目標annotated tag `kiosk-v0.7.8-rc.1`，不是stable。此輪使用者的明確提交授權優先於AGENTS舊spec的no-commit指示。未實作／啟用PB截圖，未改正式服務或模型設定。
- 安全備份 `pb-test.local/version-control-20261123-r1/`：完整tracked binary patch、23個nonignored untracked檔案的private tar、初始status及head，0700目錄／0600檔案。應用程式1120個來源與Nov20 visible-cart發布manifest全部匹配；本機checkout prompt與保留API runtime皆為8a3479b…，不是尚未套用的另一份提示。
- 候選記錄 `docs/releases/kiosk-v0.7.8-rc.1.json`，Desktop README已連結。EXE仍0.7.8，原ZIP SHA256 1719befb…重新hash/CRC通過，hardlink保存在 `pb-test.local/releases/kiosk-v0.7.8-rc.1/`；不是重新打包、不是Windows實機驗收，也不宣稱EXE內嵌新Git commit。
- 本次因實際進入commit/release checkpoint，依CONTRIBUTING before-commit規範跑一次root typecheck（通過）與root lint（4047 errors，包含既有研究／eval／generated與凍結DSP reference等，未mass fix）。Kiosk unit1129pass/1fail/1expectedFail/49skip，失敗為browserFastPathCandidates「does not invent a direct purchase for 看購物車」收到contextError；未在保存快照任務中改寫該測試。Desktop39、shared ordering19、pbCart/inputGain63通過。Browser與Windows現場未本輪驗證，RC的green release gate未滿足。
- 保存快照的commits刻意停用會執行moeru-lint --fix的pre-commit hook，避免改寫既有程式與provenance凍結reference；不是宣稱lint通過。唯讀完整檢查、失敗與未驗項已寫入candidate record。開發工具、產品來源、規劃／候選文件分批保存；.codex/config.toml仍是本機設定，不納commit，ignored runtime/ZIP/測試截圖/bytecode亦不納。
- 後續修正用新tag rc.2等，不移動RC1；穩定tag `kiosk-v0.7.8`只在明確驗收後建立。影像功能後續獨立分支，候選可用`kiosk-v0.8.0-rc.1`。尚未推送遠端。

## 2026-11-20 OpenAI正式操作與地端比較修改規劃完成（尚未實作）

- 使用者要求開始修改規劃，已建立 `docs/plans/kioskOpenaiShadowVisionPlan.md`。本輪僅規劃與handoff，未改產品程式、模型設定、資料庫或正式服務，未commit。沿用repository docs/plans；CodeGraph status為0 pending，仍以本輪實際source與報告確認接點。
- 階段順序：正式Vue/API/native時間trace＋完整任務fixtures→OpenAI正式／地端背景比較分離→精簡主動引導＋按需PB截圖→System One分流與重複等待→prompt整理及單純麥克風→分批驗收發布。保留現有必要規格／價格／版本／寫後核對及送單確認；不恢復顧客歸屬gate，不用最快者操作。
- 計畫列出server model control/runtime/schema/admin、比較排程與保存、Main route及DI、Kiosk資料、Electron capture/preload/Eventa中立契約、PB native、管理UI、收音、正式runner與README/i18n的預計位置。新增比較模組擁有排程／persist／timeout實質責任，不擴充通用gateway來擁有訂單。沿用既有套件，未選新queue或影像庫。
- 明記canonical語意input與供應商opaque reasoning分離；地端不支援圖片則unsupported／不同條件文字評測，不能默默去圖。shadow無派送／顧客回覆權且不阻塞正式，保存失敗／晚到／shutdown狀態；snapshot新鮮度以task/document/observation關聯處理，sceneFrame攝影機不混用。
- 驗收目標不是現況成績：固定完整任務集>=95%，關鍵重複／未授權操作案例觀察0錯；先攻文字就緒後首次動作p90<=3秒，語音結束起算另含VAD/ASR實測，不能冒充現場已達標。新capture/preload契約須新EXE配前端。麥克風型號／DSP／Windows仍待現場驗證；併發/timeout/retention/image size limits在正式基準後定值。
- 規劃已read back，檔案引用檢查僅比較模組與runner為明列的預計新增檔；Markdown fence／diffcheck過，文件變更不跑typecheck。未執行egm逐節審批或新增Page/cloud目的地。

## 2026-11-20 Electron 原型文字就緒→實際PB操作計時（18筆，未含ASR／正式Vue/API）

- 使用者要求實測時間，已用現有built Electron46alpha／真preload Eventa IPC／native PB executor／正式PB公開頁面與configured OpenAI Main `gpt-6-sol`，獨立暫存profile，不使用操作員cookie，不加餐／結帳／送單。測試host只有本機空白頁，原型自行組shared prompt/model request後派送原生導航，**不是正式Vue→API→System One／reply repair整條流程，也未含麥克風／VAD／ASR**。不得宣稱Windows現場完整端到端已過。
- Artifacts `pb-test.local/model-routing-evaluation-20261120-r1/electron-latency/`：`run.mts`、`browserMonitor.mjs`、results.jsonl／raw-report.json／report.json，每trial state與before/after screenshots。文字就緒後才起計，含discover、fresh browser_state_get(includeCatalog=true)、選用真capturePage→base64、模型完整JSON回覆、IPC執行與DOM目標確認。setup／初始頁面載入在計時外。原生操作cue新建立後兩個rAF記firstOperationFrame；與目標畫面first frame／完整工具回執分開，無狀態文字假動作。
- 開始點餐／開炸雞腿便當／從商品返回菜單 ×text/image×3repeats=18，皆成功且模型每次只選正確單一read/navigation工具；18次完整回覆、所有有cart的state都0行。dispatch allowlist只有state/start/return-table/open-product/return-menu。正式服務／模型設定／產品source均未改，Electron退出並刪自己temp profile。
- 首次針對操作的手勢median：Start text1341/image1515ms；open text2917/image3505ms；return text2190/image2737ms。15/18<=3秒，三筆超時均open，最慢4328ms；不是目標頁面已完成。open目標視窗frame median text3569/image4158ms；return菜單frame3523/4050ms，但完整回執5191/5572ms。Start新文件導致monitor reset，target frame空，另DOM核實upper-bound3195/3281ms，不能把該上界說成精確首paint。
- 含圖open分段median：state777ms、capture/fixture prep40ms、model2219ms、IPC dispatch到首gesture536ms。含圖return state744ms、capture87ms、model1729ms、首gesture175ms；Start capture20ms。先前「模型含圖多0.15秒」不能當整體增加量。樣本小、無冷熱隔離／統計保證，不外推常態或全部點餐操作。
- 此原型return仍讀full catalog，現有production navigation fastpath已includeCatalog=false，不能說該重讀是正式版必須成本。open native自身再次readCatalog再controls.open；return含關商品＋清搜尋＋verify，解釋畫面早已動但receipt較晚。僅觀測，不刪guard／改native流程。
- 初次monitor在tsx序列化出現__name錯誤（無有效trial），改為獨立plain mjs browserMonitor；修正期間一個語法錯在啟動前被node --check定位並修正。另一attempt有一筆Start有效但下一次return-table尚未ready而guard拒絕；保留navigation-readiness-attempt-*，不納比較summary。加入真load＋既有onNavigation ready等待，不是繞過限制；完整18筆重跑通過。JSON/18筆/成功/完整回覆/3秒計數/空cart檢查與diffcheck過，未fulltypes／commit。

## 2026-11-20 主動引導＋PB網頁截圖對照測試（未正式接入Electron）

- 使用者明確說明點餐需引導使用者、反問有必要，並要求加入網頁截圖測試。以服務目標保留簡短購買釐清規則；介紹後「好」不是購買授權，畫面預設一份不作同意。未修改正式prompt或服務。
- 技能agent-browser已讀，但CLI `skills get agent-browser` 回Unknown command，改CUA fresh獨立PB guest。選桌預設櫃台取餐→開始→暫緩券（未領券／勾不再顯示）→記錄公告→關非約束公告→記錄菜單→打開炸雞腿便當記錄→關窗；未按選好了、未加餐或送單。CUA最後畫面確認回菜單且已completion_summary。截圖／public DOM observation存 `pb-test.local/model-routing-evaluation-20261120-r1/vision/` 的 pb-table/announcement/menu/product.png、menu-observation.json、screenshots.json（hash/dimensions）。不是Windows Electron現場截圖。
- 確認一般Main streaming只有文字state；現有sceneFrame是攝影機主動互動，不是PB screenshot，不應混用。沿用現有Responses多模態adapter，測試OpenAI Main `gpt-6-sol`實際接受input_image。無地端Jev／System One呼叫、無正式設定修改。
- `vision/pairedReplay.mts`：5情境×2 repeats×2文字/含圖×2現行workflow/簡短引導補充，共40次。現行文字9/10、現行含圖10/10、引導文字10/10、引導含圖10/10為符合各自資訊下的預期首步；全部completed且公開工具參數schema有效40/40。不能稱整筆點餐成功率或統計顯著提升。各組完整回覆median依序1539/1885/1514/1660ms；不含capture／編碼／UI操作，未證明截圖降低推論時間。
- 現行文字在「介紹炸雞腿便當後說好」一次只ack，其餘條件皆ask purchase-recommendation，沒有以好／預設一份直接加入。指涉題故意未提供structured open-product title（但其他catalog等資訊一致）：無圖都詢問哪道，含圖都將「這個來兩份」對應炸雞腿便當quantity2；「這個多少錢」則get_menu_item_details不購買。完整state若已含品名，未證明仍須加圖。全部菜單只評安全首步，不冒稱已實際更新畫面。
- `vision/screenFactsReplay.mts`另4次僅圖辨識：選桌／公告／菜單／商品4/4正確，能辨識公告遮擋；商品為炸雞腿便當、可見quantity1／unitPrice80，與截圖核對一致。結果 `paired-results.jsonl`、`screen-facts-results.jsonl`、`report.json`；輸出無金鑰，未寫截圖base64到模型紀錄。JSON/筆數/參數/觀察事實驗證通過，無production code變更，未fulltypes／commit。
- 建議正式接入將webpage image與sceneFrame分開；以現有task/document/observation關聯防舊圖，不恢復顧客歸屬gate。畫面變更／彈窗／指涉不明時按需取圖，不每個步驟都多加一輪vision。保留structured價格／規格與工具回執，不以截圖代替購買同意或成功證據。

## 2026-11-20 歷史題 OpenAI Main 補測（重建PB狀態，非完整現場重播）

- 使用者追問歷史問題集OpenAI是否答對，已實測 configured OpenAI Main `gpt-6-sol`，不呼叫地端Jev／System One／地端Main。Artifacts同 `pb-test.local/model-routing-evaluation-20261120-r1/`，`historicalOpenaiReplay.mts`／`historical-openai-results.jsonl`、`historicalOpenaiFollowups.mts`／`historical-openai-followups.jsonl`、`historicalMenuFollowups.mts`／`historical-menu-followups.jsonl`、`historical-openai-report.json`。
- 12來源情境中8情境可做PB語意適配，共9組原句／語境各兩次；18次首輪皆completed、16次符合預設首步。另兩次要求全部菜單先list_menu_items(criteria.category='')，是準備讀取，不直接判為語意錯誤。4個舊Menu電話／內用修改情境（7個變體）缺相應PB流程而未測，不算通過。中性角色＋現行shared projection/workflow/tools、reconstructed catalog/cart/questions，非完整原始現場快照／正式saved角色prompt。
- 複合「水餃改一份好了 然後我要再一碗牛肉麵」兩次續輪都先set quantity=1，再add牛肉麵quantity=1。回執用現行browserToolResult投影模擬，沒有派送真實工具；只證明提案接續，不證明實際購物車已完成。
- 全部菜單續輪初測兩次incomplete（初版未存reason）；提高輸出上限補測，一次提出point_to_menu_items全部5項purpose=information，另一次incomplete reason=max_messages。不能宣稱全題通過或將incomplete當模型理解錯。shared state projection不暴露context.search，舊篩選是否解除不能只歸因模型；實際PB畫面／清除搜尋仍未驗收。不繼續無止境重試或因此修改production prompt。
- 所有來源、已測／未測、提案／模擬回執及限制在report；JSON與結果筆數／兩次複合提案序列檢查過。未改正式服務、未fulltypes／commit，未測ASR／實體收音。

## 2026-11-20 歷史案例測試集起始清單（尚未模型重播）

- 使用者要求建立測試集並詢問能否用過去實際案例。已核對既有 fieldRegression／filterDiagnosis／incompleteDiagnosis／fulfillmentDiagnosis／mainScopeReplay tests 與 Oct22 field investigation；建立 `pb-test.local/model-routing-evaluation-20261120-r1/historical-case-catalog.json`，12情境、16組原句＋語境變體，每筆附來源檔案／anchor／行號、必要效果、禁止效果。所有來源anchor皆驗證存在。
- 明確為 historical-report-derived、partial context、provisional labels，不冒稱原始完整現場快照／原音已驗證。來源大多為舊 owned Menu，移到目前 PB 必須另補對應快照／工具適配，不直接沿用舊 Menu IDs 或凍結的模型選擇當標準答案。與先前16個合成測試分開計數。本輪未讀取匯出DB對話、未呼叫模型、未改服務。
- 初始涵蓋無問題的附和、全部菜單解除舊搜尋、附和不新增排除、查詢不是購買、漏餐抱怨（有／無上下文）、分類省略、結帳問題中改內用、同句撤回（電話頁／點餐頁）、改份數＋加另一道、略過電話。完整重播前仍需補菜單／規格／購物車／當前問題、版本與能力，並複核現行政策；未測案例不計分。資料切分以同次接待／同源變體成組，避免訓練與保留測試混入同案。

## 2026-11-20 Main 與 System One 隔離實測（未變更正式服務）

- 使用者要求先測試是否依賴 OpenAI／部分地端與 System One 是否保留；後續明確指示地端 Jev 先不管，不納入結論。唯讀確認實際 active System One 為 OpenAI Decisions `gpt-6-luna`，Main `webnavior/chat` 是地端 `qwen36` 優先、OpenAI `gpt-6-sol` 備援。未切換設定、未重啟或發布。
- 隔離 artifacts：`pb-test.local/model-routing-evaluation-20261120-r1/{replay.mts,results.jsonl,tool-schemas.json,report.json}`。16 個合成情境各兩次；兩 Main 每題並行，System One 分開呼叫，無任何商家／工具派送、顧客資料或正式 session 寫入。DB BEGIN READ ONLY／Redis GET；金鑰只在記憶體解密，未保存或輸出。地端 Jev 一次 optional probe unavailable，另 health HTTP502；已停止且不計入成績。
- 使用現有 browserConversationSchema 驗證 fixture，實際 browser projection、common＋當前 workflow、public ordering tool schemas、required tool policy、Responses adapter。角色為合成中性角色，未含正式 character/store prompt／真實對話。System One 使用正式 direct router／已儲存 policy，但候選是固定人工合成，background off；未測正式候選編譯器。
- 每組32筆皆無傳輸錯誤。完整模型回覆耗時 median／p95：地端421／644ms、OpenAI1432／1987ms、System One263／357ms。兩 Main 比較32次均地端先完成；這是非串流完整回覆，不是首次 token／可執行串流工具／首畫面動作時間。
- 嚴格「預期首步＋參數 schema」命中地端18/32、OpenAI30/32；不是完整任務正確率，額外讀取並不自動代表語意錯。地端7筆含不符合公開 schema 的空參數包裝（如 parameters/arguments/properties），OpenAI0筆；Host 是否容忍該欄位未在此測試判定。其餘差異明細在 report。
- 購物車兩道不同餐、無選取／問題，只說「改成兩份」：地端兩次猜雞腿飯；OpenAI兩次詢問 cart-target。固定候選下 System One 同樣兩次選雞腿飯，不能宣稱正式候選編譯／Host 已錯改，也不能把分類層當操作驗證。System One 18/32交Main；14次直接選擇中12次符合預期、2次為上述猜目標。兩 Main 對純介紹後「好」也未遵守預設的購買釐清首步：地端重列飯類、OpenAI acknowledgement；無未授權購買。
- preflight-results.jsonl 明確排除：初始 fixture 的價格／配置欄位與 required tool policy 不完整，修正並驗證後才重跑，不能混入正式結果。測試只涵蓋首輪，未執行額外讀取後續輪次、ASR／VAD／收音、UI／購物車操作，未 full-project types。建議不用單純最快者自動取得寫入權；此小樣本不支持立即移除 System One 或直接全面地端。未修改正式 prompt／音訊。

## 2026-11-20 使用者要求不推定購物車的顧客歸屬（已發布）

- 使用者明確要求不要管「購物車是不是目前這位顧客操作」，因本機接待ID無法識別真正操作者。本輪先red重現saved owner不同→nonempty cart blocked，再完整刪除browserCartSession持久gate、BrowserCartHandoff人工確認元件及其專屬tests；沒有改成owns永遠true之類stub，也不讀寫舊browser-cart-owner localStorage。
- browserCartTask移除cartSession/cartOwner/ownsCurrentCart、order結果隱藏、一般回覆ownership前讀取、cart_get/open_product額外ownership讀取，以及cart_review/return_menu換頁前ownership preflight。保留table entry/typed failed-read處理（checkBrowserState）、isCurrent/active task、document scope、cart/config/price/readback、unknown effect barrier與final consent。BrowserDialogue/question的session/document/cart關聯保留，用於取消舊任務與舊確認，不是推定實際顧客身分。KioskScene不再套gate或顯示人工交接區，restart仍能中止舊任務。
- shared browserConversation移除review_required enum/文案/customerBoundary分類，orderingTools同步移除該狀態限制，signin/readOnly/paid result限制保留。舊Server仍接受本輪既有phase子集合，未改server政策／未重啟API。更新Kiosk與stage-ui README，刪掉舊ownership說明；i18n的cart-handoff命名仍有restart/準備錯誤共用字串，不代表保留ownership gate。
- 8檔Kiosk593過、pbCart56過、shared ordering19過，共668。兩scopedtypes、targetedlint、Kioskbuild、diffcheck過，未roottypes。移除phase後首次types定位到orderingTools同型舊分支TS2367，修正後重跑兩套件types綠。cartState新regressions驗證非空可讀、泛用回覆不讀cart、directreview、late cancel與signin；原生tests仍覆蓋價格/配置/版本/完整readback/duplicate guard。
- 正式前端 `pb-test.local/kiosk-visible-cart-20261120-r1` 已啟用，98 changed static、index last，備份/舊hashed assets保留，API PID137553不變。四入口index/version＋公開entry9項HTTP byte檢查，source-hashes/release/activation/validation/logs在stage；/tmp/latest-windows-portable.json pairedRelease已更新。只需重新開點餐頁，0.7.8 ZIP不變；未改native PB/音訊、未新包、未commit。未做Windows現場首動作延遲或實體麥克風驗收。

## 2026-11-20 檢查是否真的擋過：已核對派送步驟

- 使用者追問檢查如何做、是否真擋過。唯讀7日tool_result限定3種固定錯誤、最多30筆，證據 `/tmp/real-guard-evidence.jsonl`。台北Nov19 04:27:02 browser_question_answer：open-product completed/dispatched=true，但add/cart step failed/dispatched=false，effect=none，reason「派送前餐點規格或價格已變更，尚未加入」。證明實際阻止加入，不證明商家真的調價（source也可能current configuration missing/version mismatch）。台北Nov20 04:39:25 add_items_to_cart：open-product failed/dispatched=false、effect=none，被其他畫面遮住；台北Nov19 12:23–12:24 invoice focus同型未派送。不能把每次遮擋／失效都稱必要的安全攔截，仍可能是定位或時序缺陷。
- 技術檢查由程式直接比較：PB Inertia fresh cart/選定product configuration、cart JSON fingerprint與advertised UUID版本、selection.version/unit price、owner/document，以及DOM elementFromPoint/actionability。寫後verifyAddition/row edit對比數量、價錢、配置及未修改行。不等於再次詢問LLM，也未證明6次完整重查都有必要。本輪未改production code/服務，未跑測試。

## 2026-11-20 使用者要求「實際畫面先動」，已減少換頁前的完整菜單等待

- 使用者明確否定點頭／收到／等待提示，要求PB畫面盡快開始真正操作。本輪先做的DecisionProgress顯示、ThoughtBubble放大／dots、ActivityGlow實驗已全部撤回，未發布；相關 `/tmp/kiosk-feedback-*` 測試是已放棄實驗，不能當本次成果。保留先前音訊rollback與codegraph等既有修改。
- `browserFastPath.context`只在無pending question、獨立看購物車／返回菜單句子、有對應工具時改讀 `browser_state_get includeCatalog=false`；檢查頁面/cart後提供單一read-only navigation候選。這只縮小資料讀取範圍，Jev仍負責admission/選擇，Host仍在換頁前核對owner。表格／訂單結果／錯誤處理保留；否定、複合句、餐點資訊和pending question繼續完整處理。不以關鍵字直接執行、不假操作、不跳過寫入驗證。
- `browserCartTask` cart_review後fresh讀取改 `browser_cart_get includeCatalog=false`，用products=[]建立cart專屬question（原question policy本就不綁menu products），保留owner/document/cartVersion與明細／金額核對。避免購物車已開之後再等整份menu retrieval。
- test-only red重現完整catalog仍pending時導航候選／核對被擋。增加2 navigation、4否定/複合資訊排除、1cart readback案例；4檔340過，Kiosk scopedtypes/targetedlint/build/diffcheck過，未roottypes。測試證明catalog阻塞不再gate導航準備／核對，未量現場從說話到首動作<3秒；不宣稱全部加餐／結帳都已提速。
- 已發布前端 `pb-test.local/kiosk-navigation-response-20261120-r1`，96 static changed、index last、備份與舊hashed assets保留，API PID137553不變、不重啟。四入口index/version及公開entry JS驗證存http-verification.json；logs/source-hashes/release/activation/validation在stage。原0.7.8 ZIP不變，本次不用另換EXE，只需重新載入Kiosk前端；/tmp/latest-windows-portable.json的pairedRelease已更新。未commit／未改收音或PB bundle；真正現場首動作延遲仍待驗收。

## 2026-11-20 購物車與LLM延遲：已取得分段證據並實走商家草稿

- 使用者要求自行取得資訊確認，不再僅答未知。查production DB最近24h main_task/main_round/utterance/native metrics，僅輸出技術資訊與系統錯誤，不輸出顧客語句；最新匹配接待的時間是台北04:42–04:44，早於0.7.8發布，不當成新版後故障。證據 `/tmp/cart-performance-audit.jsonl`、`cart-native-audit.jsonl`、`cart-model-audit.jsonl`、`cart-slow-tools.jsonl`；摘要 `/tmp/cart-latency-confirmation-20261120.json`。
- utterance41 Main總17,621ms，2輪provider合計1,200ms（main_round seq442/460），cart_add原生操作7,687ms；6次寫入前cart_get合計約5.2秒，各約0.86秒，另外state/recovery/末尾readback。native操作包含開關商品、到購物車改數量、返回菜單與手勢等待，不能稱7.7秒全是PB網路。其他例14.1秒/2round、10.5秒/2round、16.1秒/4round4tool。現有LLM執行狀態涵蓋context/tools，而非純推論。完整tool定義約13.7KB、模型input約11k tokens，但實測provider round多0.5–0.6秒，沒有證據稱prompt大小是主要瓶頸。不要為省讀取刪掉寫入前後fresh cart核對；優化應針對重複整份catalog與多次UI準備。
- utterance45的native cart_review1,189ms，navigate step completed；隨後cart_get259ms resolved，但Host reply_to_customer拋generic execution failed（seq548純文字tool_result，先前JSON-only查詢漏掉）；Main5,284ms/1round最後tool-rejected。缺少底層error，不能聲稱已定位唯一根因。之後若干任務modelRounds=0/context-unavailable，native recovery報approved PB journey限制；scope檢查同時含navigation/loading/failed，不把它直接當URL改版。
- CUA fresh guest正式PB：先無餐點直開orders/create，重現商家空白頁與Create-Dsp6K78R.js `Cannot read properties of null (reading note)`。隨後回菜單，暫緩券/關公告，僅在此獨立測試guest加蛋花湯一份草稿，實際按去結算→Order/Create，發票/總額/明細均顯示。reload後讀DOM必要props（不讀auth/私人欄位），`node --import tsx /tmp/check-pb-observation.ts`直接跑production `readCartPage`成功：1行、40元、table存在。invoice radio label hit-test為true。Inertia version與Nov15記錄同為a0bbf9181bd6265267584750f958cffc，不支持近期schema改版結論；JS chunk名不同且公開curl404不能作部署時間證據。
- 測試後按PB清空，只清本輪獨立guest草稿，畫面確認購物車是空的。沒有按送出訂單／付款／填私人資料／領券；此輪確實新增並清掉草稿，不得沿用上輪「零加餐」說法。DOM observation 0600 `/tmp/pb-current-cart-observation.json`，畫面 `/tmp/pb-nonempty-cart-audit-20261120.png`、`/tmp/pb-audit-cart-cleaned-20261120.png`、空頁 `/tmp/pb-empty-cart-audit-20261120.png`。無production code/部署/新EXE修改，僅handoff記錄；0.7.8仍最新。

## 2026-11-20 購物車是否因PB再改版：未有證據

- 使用者問剛剛前往購物車反覆錯誤是否PB又改版。唯讀最近48h、最多35筆cart/checkout工具結果，最新匹配是台北Nov20 04:42:02 ask_customer_question回「餐點或購物車狀態已變更，請重新確認」；Nov19 12:23–12:24 continue_checkout多次「前往發票方式被其他畫面遮住」，不是PB schema/version mismatch證據。尚無此次剛剛的新失敗記錄，不假設是0.7.8後的新故障。
- CUA背景fresh guest實際開PB正式table入口→開始點餐，仍有coupon＋舊文案公告「我知道了，開始點餐」疊加；稍後再領→關公告後菜單正常，未加餐／送單／付款，未測非空購物車或Inertia回應。與前輪觀測新短文案並存，不能推斷對方部署時間。截圖 `/tmp/pb-cart-audit-20261120.png`。本輪未改程式／發布／設定；0.7.8修核對prompt不等於已解決現場全部換頁遮擋。

## 2026-11-20 Electron 0.7.8 回復十一月收音、PB公告與購物車核對（已配套發布）

- 使用者要求移除 Hush，回復十一月 master 穩定收音，並強調仍是 Electron。以 master/origin/master `b1a7f5b`（Nov10，含 `326ff95`）為基準；9個核心收音檔逐byte一致，證據在 `pb-test.local/kiosk-audio-rollback-20261120-r1/master-baseline-verification.json`。當時正式流程是 Chromium getUserMedia，實際8ch Spatial Mask／其他聲道一般AEC/NS/AGC，LCMV只作比較；不是恢復LCMV正式選項。保留目前Electron Main、native PB、統編代填、VAD/ASR與預設關閉的嘴型輔助。移除Hush模型、Python/PortAudio/nativeAudio/arrayInput/utility capture與250ms傳輸鏈；不以提高deadline或重試掩蓋問題。
- PB公告指商家頁 `.business-dialog` 的「線上點餐公告／我知道了」。原只支援「我知道了，開始點餐」，已新增限定公告容器的短按鈕；優惠券只按稍後再領。test-only red後32 controls＋18 checkout綠，人工PB空購物車頁關閉疊加公告與優惠券，未新增／送出訂單、未領券。截圖 `/tmp/pb-announcement-closed.png`。先前誤查Host通知的test-only實驗已撤銷，未改Host通知逾時。
- 使用者報進購物車後只說狀態無法確認。已重現：native customerMessage蓋掉核對問句；且只有checkout欄位存在才建立核對。修正為已成功且含cart的receipt即可，在fresh owner/cart版本檢查後合併實際PB明細與「餐點、份數和金額正確嗎」。發票未載入也能核對，未授權送單。新增2個red→green案例；3檔263過。最近48h有界唯讀工具錯誤未找到與現場描述完全相同的失敗，不宣稱唯一根因或實機完整修復。
- 收音／既有對話targeted 296過、1 expected-fail、1 opt-in skipped；Desktop39、Browser32、PB50過。Kiosk/Desktop/StageUI scopedtypes、targetedlint、兩build及diffcheck過，未roottypes。真Electron46＋正式main/preload、Chromium fake2ch與synthetic8ch驗證非零連續PCM、PB child view與UI350ms卡頓、TTS切換；native橋確實不存在，零商家訂單請求；不是Windows實體USB／聲學驗收。
- 正式前端已發布 `kiosk-audio-rollback-20261120-r1`：98 changed static files，API PID137553不變、不重啟，checkout政策hash不變。四入口index/version＋公開entry JS共9項逐byte驗證；保留舊hashed assets與before-activation。public urllib403但curl正常200；未變更Live2D大檔下載檢查取消後改主entry有界驗證。activation/HTTP/validation/source-hashes證據在stage。Windows 0.7.8 ZIP `windows/Webnavior-Kiosk-Windows-x64-20261120-124147.zip`，163762438 bytes，SHA256 `1719befb00f1094acd525de183ae645b6d4bb9481b95d12389de21a216c9d2e8`，CRC/81payload hashes/compiled main+preload+PB逐byte通過；`/tmp/latest-windows-portable.json`已指本包。現場必須完整退出舊版、整包解壓新資料夾，不能只換EXE。未commit；既有codegraph/AGENTS/.gitignore本機修改保留。

## 2026-11-20 現場再報各演算法錄音途中250ms（未定位／未修復）

- 使用者回報「最新版本」錄音途中仍報250ms，各演算法皆會發生；目前不確定完整錯誤、版本及發生時間。不可將0.7.7稱為此現場問題已解決，亦不能假定使用者沒更新。
- 再查production DB僅audio_runtime、唯讀48小時最近12筆錯誤；最新可見錯誤是台北11/20 04:09:47.992 `Native playback delivery exceeded 250 ms.`，早於0.7.7打包。這筆snapshot已顯示browser-vad但error仍是先前native錯誤，不能用當筆processing直接判斷發生錯誤的演算法。沒有取得這次新版故障證據。
- 現行來源確認：LCMV的raw傳輸已獨立utility；Hush ArrayInput的read仍在window Main，nativeCapture.worker保留單筆read250ms保護；另外Python有capture／speaker backlog250ms、raw Worklet有reference ACK250ms。數字相同不代表根因相同；不要放寬deadline或自動重啟掩蓋。需要現場 `%LOCALAPPDATA%\Webnavior\Kiosk-Pilot\diagnostics` 的current／previous／older.jsonl（不自動上傳），核對程序負載與時間；尚缺新故障完整錯誤與實際套件版本。本輪未改production音訊、未新打包或部署，沒有新的修復測試結果。

## 2026-11-20 LCMV 獨立即時程序修正（0.7.7已打包，Windows現場待驗）

- 使用者要求實際調整LCMV，先前僅調查不算修復。先test-only red重現：視窗Main刻意卡350ms時LCMV報`Native playback delivery exceeded 250 ms.`。新增Desktop `LcmvInput`＋`lcmvInputUtility`，透過既有Electron utilityProcess／MessagePort將raw capture的NativeAudio/Python pipes放到獨立程序；Worker直接連utility，Main只管一次setup／stop。Eventa setup/stop契約在lcmvInputProtocol，重用既有array-input v1與前端capture。原LCMV/AEC3/DSP／100ms來源對齊／250ms真失效保護保持，沒有新增350ms等待；Hush的ArrayInput處理owner分離、切換前等待前一owner退出。
- lifecycle綁generation／document／revision；舊disconnect不能關新generation。window navigation/close清理utility與Python；startup取消拒絕晚到ready。nativeAudioOptionsSchema由NativeAudio擁有；主entry與utility以electron-vite多entry共用compiledchunk，Windows packager白名單加入utility與所有main `.js`，不帶source/maps/profile。
- checked-in可重跑`test:lcmv-native`：script在apps/stage-kiosk-desktop/scripts/checkLcmvInput.mjs，真Electron46＋正式preload／utility＋真Pythonframing／AEC3／LCMV，只模擬獨立10msPortAudio輸入。最後 `/tmp/kiosk-lcmv-check-DDX3XO/result.json`全過：menu view load/focus、UI350ms、Main350ms皆持續非零連續PCM；替換／stale disconnect／pending startup取消及OS實際process清理過；SIGSTOP真音訊utility350ms仍在250ms失效。Chromiummetrics短暫保留已退出process，test改以OS liveness有界觀測，未放寬產品deadline。零商家/API請求，未WindowsUSB實機驗收。
- Desktop41 unit過＋原opt-in真Hush Python regression1過，Desktop scopedtypes、targetedlint、build及diffcheck過；未roottypes。可攜0.7.7 ZIP `pb-test.local/kiosk-lcmv-isolated-20261120-r1/windows/Webnavior-Kiosk-Hush-Windows-x64-20261120-110014.zip`，241134701 bytes，SHA256 `293bf122d22cf0056f259e1f22f9edc662e8fc30aeab3852f059d2669cff1e8c`。CRC／2709 payload hashes／compiledmain逐byte／所有relative JS import齊全驗過；音訊Python／模型、preload、pb.js對0.7.6保持一致。validation／package-verification／source-hashes／red與green證據在stage，/tmp/latest-windows-portable.json更新。
- 這次是EXE內部流程修正，現行Kiosk前端／Server不用改版，沒有重啟或切換正式服務。現場完整退出0.7.6或舊版，整包解壓0.7.7到新資料夾再開；既有使用者profile保留。嘴型設定未改（目前effective=false），不稱嘴型功能程式已全刪。仍需現場Windows負載驗收；此修正解決已重現的Mainevent-loop阻塞，不能保證任意OS／USB／驅動停頓永不超時。未commit。

## 2026-11-20 嘴型關閉與LCMV舊／新傳輸隔離確認

- 使用者要求再確認，認為現在不應有嘴型辨識。正式runtime `packages/kiosk-proactive/src/deviceSettings.ts`預設mouthDetectionEnabled=false；runtime getDeviceSettings的site defaults沒有覆寫嘴型，該現場device DB也無mouth覆寫，按現行規則effective=false。KioskScene關閉時visualSpeechRequired=false、mouthActivity.allowsStart/complete直接放行、ASR signal不綁targetCaptureController。功能程式與可選開關尚保留，不能稱已整段移除；目前設定不應要求嘴型。
- 新隔離stage `pb-test.local/kiosk-lcmv-check-20261120-r1`：真Electron46 alpha2、正式preload、真MessagePort與NativeAudio/Python framing、AEC3/LCMV；僅PortAudio硬體以獨立10ms回呼模擬，無正式服務／商家請求。比較4b256af舊Main（ArrayInput／NativeAudio／audioProtocol）＋0.6.3 ZIP內matching Python原始碼，與目前Main＋Python；兩者用相同current capture/AEC3/LCMV前端。舊新版都在無嘴部觀測／無browser media request時持續輸出非零連續PCM；local menu WebContentsView載入／focus及renderer UI卡350ms都過。刻意卡Electron main350ms，舊新版都得到`Native playback delivery exceeded 250 ms.`。comparison.json與old-main/current-result.json留證；不能將此Linux合成硬體結果稱為Windows實機修復或確診main是現場根因。
- 嘴型gate8單元過；沒有修改production收音、timeout或設定，未新打包／部署。初版harness舊Main誤接current Python（provider參數不合），改配舊ZIP Python；同process連跑兩variant有window銷毀／ERR_FAILED及segfault，改各自獨立process後過，兩次harness錯誤不當成功證據。尚需Windows既有diagnostics判斷實際阻塞段。

## 2026-11-20 LCMV 進點餐後失聲：已對上現場250ms傳輸錯誤，未修復

- 使用者補充0.7.6前版（0.7.5）先能說兩句，進點餐頁後無法收音，嘴型開關不確定。以production DB只讀transaction／5秒statement timeout查看audio_runtime及browser_tool_metrics（不讀語句或訂單），找到台北11/20 02:11:59 listening=true→02:12:39.681 browser_start_ordering→02:12:43.114 listening=false/error=`Native playback delivery exceeded 250 ms.`；同時browser_cart_get耗時約1998ms。另01:52、01:54等LCMV同型傳輸逾時。這是實際收音停止，不可再只建議關嘴型或稱LCMV全好。
- 該設備目前mouthDetectionEnabled沒有覆寫，shared預設false；不代表已證明當時所有設定，但不能用嘴型解釋傳輸錯誤。原生Audio owner綁Host webContents，PB view換頁沒有直接dispose Host capture。LCMV的Worklet→DSP Worker→Electron Main→Python→DSP ack仍有250ms保護；尚無每段RTT資料可確定Windows哪段阻塞，不放寬超時／丟PCM／自動重啟掩蓋。
- 只讀證據在/tmp/lcmv-current-audio-state.log與/tmp/lcmv-timeline-private.jsonl（0600）；原始diag狀態UTC，以上為台北時間。需要現場 `%LOCALAPPDATA%\Webnavior\Kiosk-Pilot\diagnostics` 同時段資料，以既有process-sample／renderer-performance的main loop lag、CPU與換頁耗時區分卡點。未修改收音程式、未打新修復包；0.7.6統編版音訊逐byte與0.7.5相同。

## 2026-11-20 統編口說正式配套已切換（0.7.6）

- 使用者明確授權切正式。`kiosk-tax-voice-20261120-r1/activate.py` dry-run通過；1個Server checkout政策與574前端檔案／97變更配套啟用。保留舊hashed assets與before-activation備份，index最後。API已ready，PID137553，四入口index/version＋公開JS共9項HTTP bytes核對通過。validation.json與/tmp/latest-windows-portable.json改activated-http-verified。
- sudo要求互動密碼，未改動；改確認既有服務擁有者可直接`systemctl --no-ask-password restart webnavior-api.service`，部署檔均屬aimax。先驗重啟權限PID136526，再以當下PID重做dry-run／正式啟用。未改sudo或系統權限；未強迫現場頁面刷新。Windows仍需完整換0.7.6包。
- 使用者新報0.7.6前一版LCMV無法收音，補充似乎仍要求嘴部偵測。0.7.6音訊與0.7.5逐byte一致，不宣稱此包修復。mouthDetectionEnabled預設false；開啟時所有一般語音後端均受gate限制。已詢問現場此開關狀態，尚待回覆，未擅自變更現場設定或移除功能。mouthActivity8單元過；Chromium LCMV與嘴型開關保存等15過，另deviceTextOnlySettings的text-only editor例失敗（預期無select但仍有，未改的文字模式UI），不宣稱整份browser suite全過。未重現Windows現場收音問題。

## 2026-11-20 統編口說代填 Windows 0.7.6（已打包，未發布）

- 使用者要求打包。版本0.7.6、操作說明更新；沿既有packagePortable.py、已核對官方Electron46 alpha2與/tmp/hush-noaec-runtime-final，Desktop重新build通過。新ZIP `pb-test.local/kiosk-tax-voice-20261120-r1/windows/Webnavior-Kiosk-Hush-Windows-x64-20261120-095401.zip`，241130127 bytes，SHA256 `057c7aa31bd223eefb1ccc6762f665262fa0046664f4bcfcd6d31126e7b13812`；CRC／2707 payload hashes通過，main/preload/pb.js與本次build逐byte一致。
- 相較0.7.5僅pb.js／resources/app/package.json／先看我.txt三檔變更，無刪檔；音訊main/preload／Python／模型保持。stage的package-verification.json與validation.json、/tmp/latest-windows-portable.json已更新；此latest狀態為packaged-not-published，不是已啟用證據。
- 配套前端573檔存stage/kiosk，Server政策存stage/checkout-policy.md；source-hashes.json、frontend-hashes.json及README.txt記錄配套。尚未發布前端或Server政策、未改正式服務、未commit。必須配套啟用才可用統編代填；未做Windows硬體／真Electron完整旅程驗收，不重複宣稱舊包只刷新能支援。

## 2026-11-20 PB 統一編號口說代填（已實作，未發布）

- 依使用者確認規劃：選中tax的發票輸入階段可跨句累積8碼；中文／全形數字正規化、保留顧客報出的前導0，不補零。短句接續、完整8碼替換；重來清空、更正／改成重新累積；超長清空重報，不截斷。完整逐碼覆誦、顧客確認後才Host sealed `tax-confirmed`→native `browser_invoice_tax`。非統編階段及夾帶其他要求的句子不代填。
- `browserDialogue`與`browserQuestionWindow`以120秒單次ticket保存分段／確認，綁owner/document/cart/完整checkoutVersion；手動表單變更、換方式、換接待／文件及逾時撤銷號碼。`pbCheckout.tax`只接受選中統編及8碼ASCII，沿用input/change、操作檢查及讀回；重新prepare/focus next，只改草稿，不授權送單。同步Main checkout政策、i18n與三個套件README。
- 先red重現口述統編不支援；最後Kiosk6檔495過、Server policy5過、Chrome native checkout18過；Kiosk與stage-ui套件typecheck、targeted lint、Kiosk與Desktop build通過，未跑root typecheck。第一次一般browser設定未headless連線逾時；headless與既有focused設定皆18過。正式站／訂單／付款零操作，未做真Electron旅程或Windows麥克風實機驗收。
- 尚未發布／打新版Windows ZIP／commit。新native工具在PB bundle中，需新桌面完整包搭配Kiosk前端及Server checkout政策；既有0.7.5已發布包不含本能力，不能聲稱只刷新即支援。未修改版本號或現有發布檔案。

## 2026-11-20 Hush 完整移除 AEC／播放配對（0.7.5／bridgev9，已配套發布）

- 使用者後續要求分批commit，已依點餐／畫面／收音／文件分類，先前「未commit」為當時狀態。本次提交關卡全專案typecheck通過；root lint失敗（2364 errors，含未修改的chats.test.ts與研究文件等），不擴大修復；各批保留正常staged lint hook。
- **最新現場未解決**：使用者以網頁推薦B（20dB／10%）仍報 Native microphone read exceeded250ms，captured13920／processed13824／lastRTT180ms／DSP151ms。已收290ms、已處理288ms；RTT與DSP是上一筆成功回覆，不是超時當筆，DSP亦為整批合計，不能直接推論每16ms成本或鎖定Hush。已證明移除AEC仍未穩定；待分階段Windows量測。現有testNativePipeline.cmd固定100dB／0%，不等同B，須調整參數才作精確對照；本次未修改診斷程式。
- 使用者在0.7.4仍回報啟動／套用即 playback delivery 250ms：sent21504、ack9216、pending32、oldest260ms、RTT233ms、DSP3ms；證明已有回覆後累積延遲，Windows確切瓶頸仍未證實。使用者決定移除Hush AEC，本節取代下方0.7.4的現行流程。
- Hush 改為 PortAudio 自有收音時鐘→7聲道／16k→gain→RTF/MVDR→OLA→Hush CPU＋dry mix→AGC→VAD→既有Server ASR。Capture(paired=False)無100ms配對延遲；不建立AEC、不送播放參考、不建立Hush AudioContext/Worklet、不跑reference ACK。原LCMV paired路徑不變。UI先載入，模型ready後才open麥克風；模型載入不計入read250ms，首次推論／資源競爭仍未排除。
- Native worker單筆read在途，回覆後16ms續讀；來源時計來自真實capturedFrames，不依UI/timer補零；保留真正mic backlog及read250ms保護。Hush設定移除AEC欄位／舊值不再轉送，A/B/baseline保留。無AEC可能重新收到喇叭TTS，不能宣稱實體Windows所有超時已排除。
- Python64過/3 opt-in略、Desktop42過、Windows tools8過；targeted Chromium capture/delivery/LCMV/settings/dark-theme、三個scoped types、lint、兩build皆過。真Electron main/preload＋Python Hush/MVDR/VAD＋Server ASR，獨立10ms執行緒模擬PortAudio，A/B各完成一段「我要一份水餃。」；啟動前及運行中UI卡350ms通過，reference/render皆0、零商家寫入。不是實體Windows／USB／聲學回音驗收。證據在pb-test.local/kiosk-hush-noaec-20261120-r1/live-check/result.json。
- 0.7.5 ZIP：pb-test.local/kiosk-hush-noaec-20261120-r1/windows/Webnavior-Kiosk-Hush-Windows-x64-20261120-022116.zip，SHA256 9aa88900bdfef488c9a6e630bf25877fa02e1a4044365cc8492fc5717978f473；2707 payload hashes/CRC通過。配套前端已activate，四入口12項HTTP驗證過，API PID3342211未重啟。勿重跑publisher。validation.json及/tmp/latest-windows-portable.json已更新。未commit／未跑root typecheck。

## 2026-11-20 啟動／套用後立即250ms（0.7.4／bridgev8，已配套發布，待Windows現場確認）

- 使用者確認最新0.7.3完整包，**剛啟動或套用設定後立刻**報 `Native playback delivery exceeded250ms`。前輪運行中UI350ms測試不足，不能宣稱其現場問題已排除。
- 新增真Electron/Python啟動重現：connect已open硬體後、UI尚未接reference時卡350ms，0processedFrames即 `Native capture exceeded250ms backlog waiting for processing/reference`。證實另一啟動競態；文字與現場playback不同，不宣稱完全同一根因。
- 0.7.4改為connect只start模型／交付port→Worklet接好reference回ready但暫停時鐘→Worker經nativeport open硬體→open完成直接run Worklet並native-ready通知UI，UI等此握手才標收音已啟動。native-ready以Worker絕對performance時間建立來源時鐘，不算device-open或UI排程延遲。rawLCMV bridgev1不改。
- 原250ms保護不放寬。playback錯誤附sent／ack／pending／oldest／lastRTT／DSP（無音訊／裝置私資），若仍出現請使用者提供完整新錯誤以區分首包／native／Worker排程卡點。尚未取得Windows現場內部耗時資料。
- Chromium18＋最終時間戳／握手6項過：裝置延後350ms ready、運行中UI350ms不斷、真native停頓仍250ms且含pending32/ack0、原LCMV及設定。Desktop42、三套件局部types／lint／兩build／diffcheck過，未roottypes／commit。真Electron正式main/preload＋正式音訊模組、真Python配對／AEC／Hush，獨立10ms模擬PortAudio：啟動接線前＋運行中各卡350ms，AEC開關均1完整VAD及真ServerASR「我要一份水餃」，0商家寫入；報告live-check/result.json。非WindowsUSB／真喇叭／長時負載保證。
- 已發布 `pb-test.local/kiosk-hush-startup-20261120-r1`（574靜態／99變動，API PID3342211未重啟）；新完整ZIP `windows/Webnavior-Kiosk-Hush-Windows-x64-20261120-014959.zip`，SHA256 `931cd6b5ad3fd437f022569fc41a443a9716d207778d0f3e52a51c1a7d120447`。2707payload hashes／CRC過，main/preload與實測out逐byte同。需完整換0.7.4／v8。已清理隔離測試server，正式API及設定不改。

## 2026-11-20 Hush 即時播放參考傳輸（0.7.3／bridge v7，已發布）

- 已解決後述0.7.2留下的UI關鍵路徑／診斷誤顯示：nativeCapture.worker.ts直接接Worklet reference port與Electron native input port；UI只接結果／音量／VAD callbacks，native DSP完成才ack。沿用ArrayInput的generation／文件／裝置清理，Hush connect統一start→open→交付port；rawLCMV bridge v1不改。真原生不回覆仍250ms中止，不提前ack、不放寬上限／丟PCM。KioskScene原生診斷不要求!!stream、忽略browser分支過期錯誤、GPU字改Hush CPU。
- 真Electron46 alpha.2測出ArrayBuffer transfer→MessagePortMain整包data=null，Python連第一poll都收不到；跨Electron改clone3KiB PCM，browser-only port仍transfer。與既有capture.worker.ts LCMV相同策略；electron/electron#34905及NOTICE已記錄。start/block離線診斷保留；新connect要求bridgev7／EXE0.7.3。
- Chromium先red重現350ms UI阻塞斷流，修後18項過（含350ms UI存活、真正native停頓仍觸發250ms、stale generation不影響、音訊連續／語音完整段／中止不再回送、LCMV及設定／暗色）。PythonCapture/Worker23／Desktop42過，三套件局部types／lint／兩build／diffcheck過，未roottypes、未commit。
- 真Electron正式out main/preload＋Vite隔離頁載入正式音訊模組＋真Python Capture配對／AEC／Hush：只模擬PortAudio獨立10ms回呼輸入TTS8路，非零播放參考；AEC開／關各阻塞UI350ms仍各1完整VAD段／Server ASR「我要一份水餃」。max round-trip6.7／4ms、max DSP3.41／2.61ms，0商家寫入，非WindowsUSB／真喇叭回音／長時負載保證。報告 `pb-test.local/kiosk-hush-ports-20261120-r1/live-check/result.json`；fixture與獨立profile不入正式包。
- 已發布 `kiosk-hush-ports-20261120-r1`（574靜態／99變動），保留舊hashed assets／rollback、index最後，API PID3342211未重啟。新ZIP `windows/Webnavior-Kiosk-Hush-Windows-x64-20261120-013450.zip`，SHA256 `80054d6a78e5c3d701fea5a90e1b04d22ca48dcefe94ac5a0cc49ca4198744d8`，2707 payload hashes／CRC過、main/preload逐byte等於實測out。需完整換0.7.3，舊v6會要求更新。既有A/B及AEC開關保留；詳audio/README及計畫文件。Windows硬體／實際場域仍待確認。

## 2026-11-20 Hush AEC 開關（0.7.2／bridge v6，已配套發布）

- Hush 設定增加獨立 `aecEnabled`，預設 true、按套用才保存並重啟 generation；A／B preset 不改此開關。原生 start 契約為 required boolean，Python 依現有 Config.aec_enabled 略過 AEC3／128 樣本延遲補償，RTF/MVDR→Hush→AGC→VAD 保留；status 回報實際 AEC。橋接 v6／EXE0.7.2，舊 EXE 須更新。
- 已發布 `pb-test.local/kiosk-hush-aec-20261120-r1`，573靜態／97變動，API PID3342211未重啟。Windows ZIP `windows/Webnavior-Kiosk-Hush-Windows-x64-20261120-011804.zip`，SHA256 `54e4219a543ae68b9a6846f9c7ce54eb1cd6a1453e1c2e7a28863059058cc11f`，2707 payload hashes／CRC過。Python worker10／Desktop42／Chromium17／Windows工具8過，三package局部types／lint／兩build過；未roottypes或commit。
- 真Electron main/preload v6→Python Hush→既有Server ASR：A+AEC關／B+AEC開各一完整VAD段並辨識「我要一份水餃」，0商家寫入。合成8路PCM回放，非WindowsUSB／喇叭回音／即時poll驗收，報告live-check/result.json。
- **未完成既有問題**：使用者報 native playback delivery exceeded250ms；目前 Hush nativeCapture.ts 仍經 renderer 收Worklet block／送native poll／回ack，UI阻塞350ms可穩定觸發。Hush模型確實Python執行，未證明現場這次是CPU慢。需沿用LCMV現有MessagePort main↔Worker↔Worklet通道移除UI關鍵路徑，保留真native停頓超時保護。不要宣稱本次AEC開關已修復；即使關AEC仍需播放時鐘參考。
- 另一待修：KioskScene 診斷 microphone binding 多要求 `!!stream` 導致原生收音沒有browser MediaStream被誤顯示「收音管線未啟動」；Hush label／missingbridge文案仍有GPU字。前輪已向使用者承諾修正，尚未改。規劃文件 plans/2026-11-19-kiosk-native-hush-audio.md。

## 2026-11-20 UMA-8 Hush CPU／兩組參數／暗色顯示（0.7.1，配套網頁已發布）

- 使用者要求做到EXE可直接接起來運作、不要留第二段部署。已於台北2026-11-20 00:50發布Kiosk `kiosk-hush-20261120-r3`（573 files/110changed）與管理前端 `web-falcon-removal-20261120-r1`（528/374），保留舊hashed assets、備份／rollback、index最後切換；未強制客戶頁面刷新。四Kiosk入口index/version＋公開JS＋管理頁共10 HTTP bytes過，Cache-Control no-cache／公開DYNAMIC，API PID3342211未變。
- 核對Hush所用Server transcribe/speak函式與現有runtime逐字相同，故接通不需API改版／restart。真Electron46.0.0-alpha.2／Node24.22.1載入實際發布的172入口、正式out main/preload＋真Hush，取現有服務TTS合成「我要一份水餃」作8路PCM回放，A/B各1完整VAD段、各1實際Server ASR請求，均回同句；0商家請求寫入／0送單。報告r3/live-check/result.json（success true）及validation.json；非WindowsUSB／真喇叭回音驗收。測試使用獨立profile／新增DEV-967120測試設備，未改原設備或模型設定。ZIP內main/preload/PB bundle與實測out逐byte相同，沿用0.7.1即可；r2 validation與/tmp/latest-windows-portable.json已標配套發布。
- 管理前端已移除Falcon設定；API執行中舊Falcon路由仍存在、但新前端不使用。完整Server退休的來源變更尚未啟用，sudo需要密碼且無可reload入口，未強殺程序／偽造故障觸發重啟；此清理不阻礙新Hush正常ASR。勿將「Hush已接通」誤報成「執行中API已無Falcon」。
- 使用者提供 Downloads/UMA8-Windows-Integration-README.txt，要求分析並加入 A=20dB/30% MVDR 原音、B=20dB/10%，另保留100dB/0%原始對照及原預設。Hush 設定下拉選擇是 draft，按「套用音訊設定」才保存並重啟 generation；保留裝置／七路映射／共同增益與LCMV設定。文件三錄音不同，不能當參數品質比較；仍用既有Server ASR，不因文件提到Whisper而納入本機ASR。
- UL-UNAS／OpenVINO及專用GPU／bypass資產已退休；獨立native-hush保留existing LCMV／Spatial Mask及標準輸入，舊GPU選擇須明確重選。管線RAW48k＋真應用播放參考→七路16k→AEC3→共同增益→線上RTF/MVDR→OLA PCM→Hush混音→AGC→空間/WebRTC VAD→Server ASR。資產固定audio/hush，不依賴Standalone／Downloads路徑或額外HTTP服務。
- 正衰減混音先延遲原始MVDR PCM160樣本，再按百分比混Hush；dry buffer不含native clipping／silence floor。0dB直接通過、delay0；source evidence及256/160配對、尾音排出保留。上游低能量跳狀態仍以已註記Nyquist floor處理；-100錯誤拒絕。每generation新session、持續跨VAD，程序共用weights；native status回報active hush參數。start要求hush物件，bridge v5／EXE0.7.1，需配對新前端，0.7.0不支援本次參數契約。
- 切換等舊程序退出，導航退休待啟動請求，列舉獨立程序；自動WASAPI失敗且唯一miniDSP RAW WDM-KS才選它，明確裝置不替換。Kiosk暗色底原有light-theme控制項導致黑字，先Chrome重現rgb(0,0,0)，再HTML dark＋root color-scheme dark，控制項及body portal亮色字回歸通過；其他app主題未改。
- Python62過3optin skip，三組各120秒真AEC3/Hush合成串流另過；Desktop42、Chromium20（含雙preset保存／未套用不生效／start攜參數／亮色控制項）、Windows工具8過。Kiosk/Desktop/Shared局部types、scopedlint、兩appbuild／diff check過；未roottypes／commit／部署／重啟。計畫與依據見plans/2026-11-19-kiosk-native-hush-audio.md及原生audio/README。
- 後續使用者提醒白底白字：新增Kiosk專屬data-kiosk-theme固定字／底色、selected/highlight配色，包含body portal，不依賴全域dark class或系統主題；亮／暗class兩情境與選中項測試通過。只改前端，沿用0.7.1 EXE，r2靜態檔／manifest已更新；30分鐘是初期建議觀察區間，用於累積型問題，非Hush要求或啟動等待。
- 最新交付`pb-test.local/kiosk-hush-20261120-r2/`：`windows/Webnavior-Kiosk-Hush-Windows-x64-20261120-003921.zip`，241128852 bytes，SHA256 `99f309b98d5dc37c63eb0191225afb5fd0533b7aee97afcd748a1cd54602688e`；2707 payload hashes／CRC過；572配對靜態檔在kiosk-dist/，另有manifest、validation.json及logs。r1為上一版0.7.0歷史試用包。真Windows DLL／UMA-8、相同錄音比較、TTS／雙向說話／背景干擾／ASR、USB／反覆切換及至少30分鐘完整運行仍待實機驗收。前輪Falcon移除亦需同步Server／管理前端發布，不能只換EXE宣稱生效。

## 2026-11-19 Falcon 功能移除

- 使用者確認完整移除 Falcon：Kiosk AV capture／模式輪詢、Server admin／辨識 routes、ConfigKV schema、管理面板、shared codec/settings exports 與專用測試已移除。一般 ASR 不再等待 recognition policy；UMA-8 原生收音、AEC3、LCMV／Spatial Mask、GPU RTF/MVDR 與現有 ASR/TTS 保留。
- 主動迎賓與可選 mouthDetectionEnabled 仍使用共用 Face/Pose 幾何觀測，不再產生 25 fps 嘴部影像。歷程既有資料未刪；DSP 來源授權／provenance 保留。舊 Falcon Redis 設定不再被讀取，未操作運行中的資料或服務。
- 驗證：Kiosk 120 項單元測試、Server ASR／TTS 與已移除路由 5 項、Chromium 31 項通過（含 synthetic camera geometry）；Kiosk／Web／Server／Shared scoped types、scoped lint、Kiosk／Web build 與 diff check 通過。未跑 root typecheck、未做 Windows 實體收音驗收。
- 此段為 Falcon 清理當時紀錄；Hush 已於後續 0.7.0 整合，本機 Whisper 不在範圍。需同步發布 Server、管理介面與 Kiosk 網頁後才在現場生效；本輪不部署、不重包 EXE、不 commit。

## 2026-11-19 套餐湯品誤框／炸物排除反轉／對話顯示（r6待啟用）

- 使用者報套餐蛋花湯框單點、文字模式TTS不亮、我要炸的漏炸雞腿炸排骨且列10道、明確重述炸雞腿仍胡言。唯讀正式742／本機1081事件：本機6aehl_1a 台北22:13:47「那我要炸的」Main list_menu_items criteria.excludedTerms=[炸]，search炸找到正確兩道，point推薦卻被持久限制拒絕；Host將先前10品項catalog summary＋重複presentationFailure念出。22:16:25／47明確炸雞腿仍被此限制擋；不是商家沒有商品。raw `/tmp/nov19-local-fried-private.json`0600，後續再拉DB失敗（未暴露DBerror／未重啟本機），以先前完整快照確認已知根因。
- Host `browserRecommendationCriteria`在沒有任何拒絕／忌口字面證據時拒絕新增excludedTerms、保留原state，回INVALID_TOOL_ARGUMENTS/dataOnly給Main修正；這是必要條件guard，非完整語意分類器（含不相關否定的混合句仍需Main正確理解）。指定商品存在但被推薦條件排除時point回可修正purpose conflict，導引information，不再錯稱無法確定或清掉其餘忌口／預算。Common/browse policy明列正向炸物、新需求與份數補問。
- browserPresentation.speak重用shared productMentions最長文字span，套餐完整名稱內蛋花湯不再觸發單點；另外說單點仍框。questionPresentation一般catalog只介紹3道，失敗target不讀無關catalog、不重複相同failure；specific details與cart/final確認不截斷。真本機Main＋合成菜單r6/verifyFriedMain.cjs過：炸雞腿／炸排骨兩框，注入舊excluded炸後明確炸雞腿仍正確框單品；零商家requests／cartwrites。只驗定位語意及修正，不是實體ASR／購買／完整原始現場重現，烤的前置未作查無正確性斷言。
- 使用者允許縮人物。保持整體menu75%／assistant25%高度，assistant內avatar24%／conversation76%，min5.5rem（窄5rem）。上一答3行可展開、0.8字級(default22.4)，本次問答保留28預設與既有operator值；全history可展開不改model/audit。訊息泡泡96%寬、留白收斂；訊息列不flex shrink，history minheight0可捲，初始也做300ms Markdown延後跟隨。KioskActivityGlow speaking加4px明邊與insetglow，未改TTS state來源；目前來源本來兩模式都接onPlaying，未重現現場那次不亮。真Chrome HTMLAudio生命周期＋glow測試驗playing亮／stop滅，不宣稱重現現場原因。
- 初始4回歸red→green，Kiosk8檔623過；browser相關26過（含等待Markdown真正渲染、泡泡邊界與小高度可捲動），Server policy5過。Kiosk scopedtypes、targetedlint/build通過；r6以`sudo python3 /home/aimax/webnavior/pb-test.local/kiosk-ordering-preview-20261119-r6/activate.py --activate`啟用，取代r5指令；沿用已交付0.6.11完整ZIP。r6 final dryrun＋rollback7過，3API policies/573static/1397source，API PID3237944，READY/validation/logs完成；未啟用。無commit／roottypes／production改動。原r5未啟用，這批r6取代其啟用；沿用r5 Windows0.6.11ZIP，native能力本輪無改，不重包EXE。

## 2026-11-19 掃碼明示與捐贈碼語音代填（0.6.11／r5待啟用）

- 使用者要選手機載具／自然人憑證後明確告知可直接掃碼、不必點欄位；捐贈可口述3～7碼。既有pbInvoiceInput／surface已含DOM及native keyboard handoff，本輪不加新相機decoder或套件，改提示掃碼器／條碼或QR Code／不用先點／掃好說好了。
- `browserDialogue`只在選中donation且invoice-details／invoice-donation-confirm接受完整數字（含中文數字，保留0），3～7碼覆誦；正確後Host sealed action→新native `browser_invoice_donation`。不暴露model-facing代填工具，不把捐贈碼當phone；範圍錯不寫、NEW_REQUEST沿用退舊題、form改變撤銷待確認。`browserQuestionWindow`donation confirm綁checkoutVersion，expired僅恢復entry不繼承號碼。native donate驗選中donation＋數字範圍、input/change、freshprepare/focus next，不送單。明確需要新EXE0.6.11，不可宣稱舊0.6.10只刷新即有新native能力。
- Kiosk6檔601過、Chrome checkout/invoiceinput25過、Desktop41過/1optin skip、Server policy5過；Kiosk/UI/Desktop scopedtypes、targetedlint、Kiosk build通過（最後再建置）及Desktop build過。實際Electron46＋正式PB獨立profile `r5/verifyNativeInvoice.cjs`最終7checks過：選carrier/citizen不點文字欄即可keyboard injection，native focused WebContents是PB，Enter不送單；donation填001保留0；清本測試草稿，正式order/payment0。不是實體USB/光學QR/Windows驗收。中間兩次測試分別Host未載入頁面而無focus、一次gesture目標未派送即失效；harness補loadURL並等待原生捲動版面600ms才穩定，未改產品delay／放寬guard，不能宣稱所有transient失敗已解。本測試重跑復用既有專用草稿，未重複加餐。
- 準備時發現r4已啟用（API PID3237944），verifyHttp.py四入口index/version＋公開JS9bytes過；勿重跑r4。這批r5接續r4；原r4局部結帳恢復全包含。正式服務未改／未重啟，無commit/roottypes。r5 Windows ZIP `windows/Webnavior-Kiosk-GPU-Windows-x64-20261119-221307.zip` 314467594 bytes，SHA256 `2d46b5ffaaf1b47539a46c68c1e1633c92c2989c222f4944fddcaf093aa9db23`，3708 payload hashes/CRC過；相對0.6.10僅pb.js/packageversion/guide3檔變動，main/preload/audio/models/settings未變。啟用用`sudo python3 /home/aimax/webnavior/pb-test.local/kiosk-ordering-preview-20261119-r5/activate.py --activate`，完成後換整包0.6.11、保留自訂設定與既有profile，閒置接待刷新／重開。正式HTTP仍待啟用後核對，r5 dryrun/activation7過，1API policy/573static/1395source，預期API PID3237944，READY/validation/logs完成。另回歸覆誦錯誤可重報，以及Main誤呼叫phone時仍優先解析已發donation slot，不把001當手機。

## 2026-11-19 結帳無進展恢復（r4待啟用）

- 使用者澄清卡題＝發票等流程反覆停同一步，非僅UNCERTAIN，接受先試但要求效果可評估。新`dialogue.observeCheckout`比對owner/document/cart＋step＋完整form（排除confirmationToken），僅跨不同utterance計數；無ID用task實體，同語音不重計；資料/步驟改變重置。初始entry＋兩次完成仍不變→invoice重建方法choices、contact改直接語音報號碼、其他readiness pauseCheckout退舊題。連續兩個effect none且ok false的browser結帳操作才在fresh read／admit後重建invoice選擇。unknown/pending不恢復、不重送。
- `CHECKOUT_RECOVERY`是Host terminalreceipt，reason/step/attempts留工具紀錄、不帶欄位值；recording/presentation不續Main重建原題。保留商家cart/form，無遮罩/計時取消/原生修改/程序重啟。無法保證缺少的PB資料會自動修復；checkout-details真缺漏會白話說明並暫停舊待答，仍可自然修改／再繼續。沒有自動送單/付款測試。
- 先兩個實際compiler回歸red，完成後Kiosk6檔592過（包含兩次無進展／改發票接續／phone恢復／sameutterance不雙計／資料改變清counter／unknown不重試／pause不復活舊題），scopedtypes及lint通過。Windows沿用0.6.10，不需新EXE。本輪無commit／production改動；r3未啟用且sourcefreeze已過期，改用`sudo python3 /home/aimax/webnavior/pb-test.local/kiosk-ordering-preview-20261119-r4/activate.py --activate`。r4 3API/573static/1395source final dryrun＋7activationrollback過，API PID3158482；Kiosk build14.87s通過，READY/validation/logs完成。無新WindowsZIP／未實體驗／尚未啟用。

## 2026-11-19 共用錯誤隔離／湯品語意／自動卡題退出（r3待啟用）

- 使用者追問其他情境是否會噴程式錯誤，並報「虱目魚湯沒有→那有什麼湯→沒有送出訂單或變更餐點」。唯讀正式0、本機411 events：本機Be3z6Mss台北21:25:49 Main確實list_menu_items criteria.category=湯，Host只接受已設定完整category而拒絕，questionPresentation丟失read failure而用了noChange訂單修改回覆。raw `/tmp/nov19-local-soup-private.json`(0600)。不是餐點網站掛掉。
- `browserRecommendationCriteria`先驗證category再update，未知回categories不污染state。compiler回可修正INVALID_TOOL_ARGUMENTS，附當前compact完整菜單候選並指示Main按語意挑選，不猜category。read failure保留具體查詢回覆，無結果改lookup文案；unknown寫入/送單仍走獨立保護。Common policy放湯品範例，因UNCERTAIN handoff可能走order，不能只放browse。
- 使用者問關鍵字適合度。真正Main初版probe重現湯字串把湯餃與套餐全框；因此`browser_search`現在只有唯一完整餐名/alias或真正已設定完整category可直接框，其他substring僅dataOnly候選，必須Main語意選name再point。不輸入PB非空搜尋框。真本機Main＋合成7品項（非商家/ASR）：虱目魚湯查無→湯品category不符→湯候選→point僅紅燒牛肉湯(無肉)/蛋花湯/魚丸湯，無湯餃/套餐，`r3/soup-main-live.json`(0600)。harness中間修過缺括號與把清框[]誤當呈現完成，最終只認非空cue。沒有merchant requests/cart/order/payment。
- 共用compiler `CustomerInputError`僅允許本模組明確構造的顧客提醒，Valibot、transport/runtime例外都用普通customerMessage，內部explanation保留原錯誤。批次加/刪catch亦共用此隔離；已核實前項effect保留。水餃補問catch不再外洩rawerror。Fastpath例外原本只trace，operationReplyFrom只讀customerMessage；未宣稱所有其他模組/程式凍結皆解。
- **使用者明確否定要求說「取消這題」的設計**：已移除所有新提示與service專用口令handler，不要求或教特殊取消詞。自然拒絕仍走已發問題的cancel選項，NEW_REQUEST接續新需求。BrowserDialogue同一選餐/checkout問題連續兩個不同utterance無法解答或回非法choice，自動release問題與未加入draft，pause checkout position，保留recommendations及所有商家狀態。signature綁owner/document/cart/題目內容與choices，不讓換UUID重置；同utterance不雙計，進展清count，舊IO不得退新題。QUESTION_RETRY_LIMIT與自然拒絕QUESTION_RELEASED為Host terminal receipt，recording不再續Main重建題，presentation顯示白話退題。無15秒新取消、無PB重整/清cart/重送、無自動Electron重啟。程序整個無回應仍需手動重開，不能混稱對話loop breaker。
- Kiosk6檔584通過（誤接參數/非schemaError/部分已完成保留、查無→category修正→正確框選、2次退題/同語音去重/新題不受舊IO/成功清counter/送單題不送出/recording終止）；Server局部2、activation7、Kiosk scopedtypes/lint/build通過。TS choiceId optional已補明確guard；source最後重新build。未root types/commit/新Windows包/Windows實體驗。
- r2已由使用者啟用：activation PID3158482，verifyHttp.py四入口index/version＋公開JS9 bytes過；不要重跑r2。新stage `pb-test.local/kiosk-ordering-preview-20261119-r3` 3API(common/browse policy＋orderingTools)/573static/1395source，final dryrun過；staging清舊中間產物後重建，線上舊hashed assets保留。**r3未啟用**，需`sudo python3 /home/aimax/webnavior/pb-test.local/kiosk-ordering-preview-20261119-r3/activate.py --activate`。沿用0.6.10ZIP，guide來源已移除取消口令建議，未重包ZIP。啟用後閒置Kiosk刷新/重開並postverify。validation/READY/logs完整；無production writes/restart本輪。

## 2026-11-19 優惠問答誤用工具／Valibot外洩（r2待啟用）

- 使用者「有沒有買一送一」見Invalid type expected question enum received promotion-policy。原始碼可精確重現：Main把replyType當ask_customer_question.questionType；Host parse丟ValiError後genericcatch將errorMessageFrom直接當customerMessage。不是PB服務中斷。先新增2回歸red，再修正green。
- `orderingTools`共用customerQuestionTypeSchema綁public JSON schema與Host驗證；ask_customer_question用safeParse在任何PB讀寫前拒絕，回INVALID_TOOL_ARGUMENTS/dataOnly/effect none與內部修正說明，沿用既有最多兩批bounded correction，不把錯誤類型當新支援類型。promotion-policy仍只能reply_to_customer.replyType。保留原pending題及cart。
- Host其他ValiError也不再把英文schema當customerMessage，內部explanation留診斷，對外用i18n普通訊息；這些可能來自website readback，故不標成可重送的INVALID_TOOL_ARGUMENTS。沒有宣稱所有非Valibot exception都已隔離。Common policy/tool description明列買一送一走reply，不捏造優惠；zh/en promotion訊息說明無法確認額外優惠，以公告/畫面為準。
- Kiosk orderingTools＋recording267過（含實際compiler＋mock Main先錯後修、零PB操作），Server policy5、shared20、activation rollback7、Kiosk scopedtypes/lint/build過；無roottypes／commit／真Main/Windows實機新驗。public/native能力及參數枚舉不變，此修正只需網頁/政策更新，不需再換EXE，沿用已交付0.6.10 ZIP。重build native bundle會因共用schema初始化與訊息字典而產生不同bytes，未宣稱bundle逐byte未變；未另打包。
- 新stage `pb-test.local/kiosk-ordering-preview-20261119-r2`取代r1啟用指令，8API/573static/1395sources dryrun過，PID1435071。**尚未啟用**，需使用者sudo執行`sudo python3 /home/aimax/webnavior/pb-test.local/kiosk-ordering-preview-20261119-r2/activate.py --activate`。r1 sourcefreeze已因修正而過期，勿執行舊指令；原Windows ZIP仍可用。r1 READY標superseded，r2 READY/validation/logs完整。使用者執行後讀activation＋verifyHttp.py，勿重跑activate。未改production或自動重啟裝置。

## 2026-11-19 0.6.10 現場Windows完整測試包（已準備，待sudo啟用）

- 使用者要求到kiosk端測試，已將Desktop version升0.6.10，更新quickstart，包含此前未部署的layout/ASR/table/menu/recommendation/voice-first/checkout修正及本輪水餃slot/取消這題/隱藏動作label。包不含同頁未營業送單拒絕偵測。
- Stage `pb-test.local/kiosk-ordering-preview-20261119-r1`，完整ZIP `windows/Webnavior-Kiosk-GPU-Windows-x64-20261119-211935.zip`，314466452 bytes，SHA256 `eeefc2bf4169d27ef58bf9da0c69342bcf24e3fbbf74597d7c60a824a3a2990c`。3708 payload SHA/CRC通過，相對0.6.9僅main／PB bundle／package version／quickstart四檔變更，preload／連線設定／全部音訊與模型runtime逐byte未變；實體Windows未驗。
- 使用既有packagePortable.py，第一次選舊auto-audio runtime被source一致性檢查拒絕，未產物；已改用與0.6.3之後source完全相符的kiosk-lcmv-native-20261119-r1/audio-runtime，保持音訊不變。沒有繞過guard。
- Kiosk及Desktop重build、Desktop scopedtypes、41 tests（另1optin skip）、activation rollback7測通過。Server原161測有160過、1舊搜尋框政策文字assert失敗；只更新assert以確認新的「全菜單查詢並框選」契約，該測重跑過，另局部20測全過。未重跑全部／roottypes。此前本輪Kiosk206及browser13亦過。
- 配套activate.py準備8個API/政策來源、573 static，1395 source freeze；使用現況before SHA／PID1435071、檔案備份、health與rollback，保留舊hashed assets。不觸正式Admin／模型env／設備設定。dryrun已過，**尚未啟用**；sudo -n true回password required，沒有production writes／restart。使用者需執行`sudo python3 /home/aimax/webnavior/pb-test.local/kiosk-ordering-preview-20261119-r1/activate.py --activate`。不是auto-review拒絕。
- 使用者執行後應postverify activation.json及verifyHttp.py（4入口index/version＋公開JS共9 bytes），不可再重跑activate。Windows須退出舊程式、完整解壓新目錄、保留自訂settings及既有Kiosk-Pilot，選172.17.69.17入口。ready及validation報告已放stage。無commit。

## 2026-11-19 水餃問題白話化／隱藏動作label（來源完成，未部署）

- `browserOrderDrafts`對已驗證周氏水餃＋單一`水餃1顆`原生群組，新增`dumpling-pieces`待答欄位，直接問每份總顆數；未說份數時可答10顆2份，已說份數時10顆保留原份數，正常＝8顆，split回答分開配置。保留原生extra上限、fresh snapshot、最終計價與購買admission；不猜其他商品基本顆數。原始「加量要選哪一項」是generic group wording直接露出原生群組，未轉換為顧客語意。
- `browserQuestionChoice`增加「取消這題／取消這個問題／先跳過這題」只在已有cancel選項時解析，不取消正式訂單；清尚未加入draft、保留cart。UNCERTAIN時保留原題但補出口說明，不自動猜同意。NEW_REQUEST既有退題行為新增回歸確認，仍依Main判斷，不能保證現場再無誤判。
- `pbPresentation`現在動作label也hidden，只留hand與frames；control.label仍在原操作/診斷契約。未修改商家原生文字。
- 回歸Kiosk三檔206 passed、Chrome presentation13 passed，Kiosk scoped typecheck、targeted lint、Kiosk build與native PB bundle通過；未root typecheck／新Windows包／部署／重啟現場。新增測試覆蓋10顆／正常／明示3份／split配置／取消後新題／UNCERTAIN出口／Main換話題。
- 本機Linux使用manage stop/build/start/electron，無需打包Windows EXE。這批累積native修改需現場Windows新完整包；單Server政策修改原則不需EXE。使用者目前正在跑的site及Electron未被自動替換。

## 2026-11-19 推薦巡指／「還有什麼」接續（來源完成，未部署）

- 使用者圖片顯示三卡全框但手指只在第一卡，上方重複聚合餐名。`pbPresentation.show` passive related batch保留全部框，單一hand依products順序巡每卡（距離敏感移動＋180ms停留），不重複品名label，control動作label於後續修正也隱藏。可見receipt先完成，tour背景由同AbortController管理，speech及下一題不等待、不鎖input、不額外scroll。data-pointed-product-ref在實際到達後記目前ref，供native診斷。Mutation/render在receipt前先settle，舊card換內容仍回cancelled，未放寬原安全回歸。
- 唯讀正式633／本機289 events，在本機接待M43_WT61明確見台北21:02:10推薦三道；21:02:36「還有什麼」Main只list＋ask item，重問舊題；21:02:57「還有推薦什麼」Main才換批，卻加excludedTerms為上一批餐名。raw只存`/tmp/nov19-recommend-private.json`及nov19-local-recommend-private.json（0600）。
- 根因是pending question分支提前return，未提供recommend-other候選。`browserFastPath`現在對已有成功推薦、無商品視窗且非checkout的商品選擇問題，提供符合目前criteria、排除上一批的有限推薦候選；Jev決定是否換一批，不用字串regex自動當成購買。共用sampling policy從原inline抽出，兩處使用，無新依賴。Common policy補明確「還有什麼」接續與不寫excludedTerms；放common因pending choosing_product會走order workflow，不能只放browse。既有忌口／預算仍保留。
- 真Electron46＋正式PB（獨立recommendation-native-profile，merchant非GET全阻擋）：三實際卡refs p-2503/p-2588/p-2591依序巡到、全框、scroll不變；CDP檢查closed shadow品名label hidden，截圖`pb-test.local/kiosk-activity-query-20261119-r1/recommendation-native-tour.png`。第一批是驗證過的tool input，非Main新推薦；後句「還有什麼」呼叫真正本機Jev，選intent:recommend-other並經Host執行新PB三品項、pending更新、excludedTerms未改，零merchant writes。native-verification完整在recommendation-native-verification.json。是Linux正常Electron與正式PB驗證，非Windows物理驗收。
- 回歸先red（tour metadata／pending無other候選）再green。Kiosk相關4檔377項、Chrome presentation13、Server policy4；追加runFastPath接續回歸、scoped Kiosk/UI types、4檔lint與build檢查。兩fixture截圖之一是Chrome元件測試，不當作完整PB；native PNG已實看無重複文字且hand在最後一張。未root typecheck／commit／部署／新Windows包；需重建Desktop native bundle及Kiosk／Server政策，manage本機全套build再重開才生效。

## 2026-11-19 語音優先引導（來源完成，未部署）

- 使用者要求全程優先語音，非必要不轉交畫面。移除一般選桌回執「或點開始」、不存在桌號／選桌取消的畫面替代，通知手機只提示分段口述及覆誦確認，不主動推鍵盤／email。Common與Checkout policy要求用現有工具代處理；不因一次理解不清就轉手動。語意未理解及menu recovery改請重述；cart recovery保留未核實／核對後再繼續，不聲稱已自動核對。既有手動控制不隱藏／不鎖住。
- 發票carrier/citizen直接請掃描條碼；tax/donation目前沒有語音代填欄位工具，明說此欄需輸入。正常通知手機與發票步驟去掉冗長自行完成替代。未新增填碼、email或付款能力。
- LINE Pay目前僅state_get＋Host說明與原生manual anchor，沒有語音代開入口；本輪明確向使用者說明此缺口。付款回覆改說明「目前尚無法代開付款頁，這一步需要點選LINE Pay，再用手機完成付款授權」，不能宣稱全流程免觸控／付款已自動化。缺少native checkout能力的舊入口fallback也明確說明限制，不泛稱可以自行操作。en／zh-Hant同步。
- 新通知手機voice regression先red再green；Kiosk四個相關檔440項、Server政策4項通過；相關lint與scoped Kiosk types／build檢查。未root types／commit／部署／新Windows包；原生PB table spoken receipt改動需重建Desktop bundle（manage全套build會取得），不是只重整現有網站。

## 2026-11-19 購物車發票遮擋／預選提示／僅 LINE Pay（來源完成，未部署）

- 新一輪唯讀正式3566／隔離731 events，範圍台北11:00–21:00。正式12:32–12:34同接待反覆continue_checkout在「前往發票方式」失敗約3.4–3.6s；20:23亦重現。根因仍是checked透明radio被同label內裝飾span命中，非整區loading cover。完整私有資料`/tmp/nov19-day-checkout-private.json`、`/tmp/nov19-local-day-checkout-private.json`（0600）；勿輸出顧客電話等欄位。
- `pbCheckout.focus`用同一radio的可見label作movement/hit-test，dispatch僅focus對應input；欄位focus不變。Chrome先red重現既有radio patch再green；真dialog覆蓋仍拒絕，未關hit-test或force click。
- Host invoice問題先說fresh checkout.methods selected的「目前預選…」，再問哪種，移除此步長篇entryModes；所有可用方式仍列出，不把預選當同意。選中choice描述明列可沿用預選。新增cart-review→正確→invoice-method不重開cart、不選預設、不送單回歸。
- 新`pbPayment.ts`在已批准journey的orders/{hash}/choosePayment，僅允許同origin同order `/order/linepay/redirect/{hash}/LinePay`。其他.pay-method anchors（含Credit）移href、aria-disabled、tabindex -1及is-disabled，capture click/auxclick/Enter/Space攔截；inline支援說明，沒有cover，原生放棄付款不動。MutationObserver處理晚出現連結，離付款頁／pagehide清理，保留原屬性。未提供自動支付工具；共用raw order paymentMethods保留商家實況，Host pending回覆／common與checkout政策另限定LINE Pay，沒該入口則洽現場人員。
- 官方PB現行`ChoosePayment-BwlyWqwy.js`確認使用`.order-pay .pay-method a.el-button`、href與btn-LinePay/btn-Credit；只做使用者授權的kiosk原生增强，無新依賴。PAYMENT限制Chrome3項含real click、信用卡/新分頁阻擋、native取消、SPA清理；未走真支付或建立正式訂單。
- 實際Electron46＋正式PB獨立`checkout-native-profile`：目前草稿cart的原生發票focus、選carrier自動focus barcode欄位成功；清除自己測試草稿成功，正式送單端點禁止且無嘗試。`pb-test.local/kiosk-activity-query-20261119-r1/checkout-inspect-verification.json`。第一次harness禁止orders/*誤攔草稿details/store，已收斂只攔正式POST orders；不是產品修正。另actual add曾出現null string readback unknown，另輪add成功後緊接review遇到商品dialog動畫退場target失效。`pbControls.close`新增自然消失已滿足close的處理（signal abort或仍有product dialog仍拋錯），先red再green；最新真Electron正式PB同一harness加車一次→review→invoice→carrier→清草稿全部成功，checkout-readback-verification.json success=true、draftWrites1、正式送單attempt0。首次null讀回錯誤仍未確診，不可宣稱所有偶發錯誤已全解；下步在當下記錄readback schema path，不可自動重送add。
- 後續使用者詢問是否真送單／付款方式問答：已明確說明上一輪未submit，09:27是既有現場派送unknown，不能當本輪成功。現行submit仍等待path變更，非營業同頁錯誤未完成驗收，初始公告不能證明本次拒絕。此輪不因「目前未營業」而假定真送單必定無副作用；未派送新的正式訂單／支付。
- 補真Main本機API（獨立DEV-956319；合成PAYMENT-QUESTION-TEST狀態，非真付款頁）3問：「有沒有其他付款方式」「可以用信用卡嗎」「可以付現金嗎」，Main原工具選擇交目前Host compiler/executor後皆回僅LINE Pay／信用卡不支援並引導畫面；沒有merchant/payment呼叫。`pb-test.local/kiosk-activity-query-20261119-r1/verifyPaymentQuestions.cjs`及payment-questions-live.json（0600）。Main選replyType有information-unavailable/acknowledgement甚至另輪greeting，但Host fresh pending order分支統一約束可見回覆；不是Main分類全部正確的證據。API使用正在跑的既有建置、未重啟，Host執行器是本輪來源bundle。新增4項Host付款問答回歸通過（含PB只有信用卡時不捏造LINE Pay入口）；未做ASR真人／真支付驗收。
- 驗證：Kiosk checkout相關341項，追加cart confirmation流程測試通過；Chrome controls31＋checkout16＋payment3（共50）；Server policy4；Kiosk/UI scoped types、targeted lint、Kiosk build及native PB bundle build通過。未root typecheck／commit／新Windows包／部署。需manage stop/build/start/electron才取得本機新前端、政策及native；正式Windows需重包EXE，單改Server不足。保留使用者測試中的服務，不強制reload。

## 2026-11-19 運作流光／一般詢問改框選／文字框選（原始碼與本機建置完成，未部署）

- 使用者要求Siri式流光：TTS亮人物框、偵測說話亮上半整框、代操作亮下半框。新`KioskActivityGlow.vue`純CSS gradient edge（pointer-events:none／aria-hidden／reduced-motion靜態）；Scene依實際`processingSpeechActive`或admin TTS、`isAudioListening&&isSpeech`、correlated activeServiceOperations（排除state/cart/recovery/observe讀取）驅動。ScenarioSurface固定padding6px讓Host邊框位於native bounds外，active不改尺寸、不遮蓋/隱藏PB。無新模型/套件。
- 查了本機隔離DB真紀錄：UTC12:10:35小米粥查無；12:10:58「那有什麼魚類」先search魚找到魚丸湯，Main又發search粥及無顧客依據的excludedTerms，最終Host拼「魚丸湯…找不到粥」。私人raw在`/tmp/menu-query-recent-private.json`（0600），不可當公開artifact；不是transport晚回的猜測。
- ordinary`search_menu_items`（及Jev走同Host的browser_search）現在從fresh full catalog按name/aliases/category查，found走browser_present info，不填PB搜尋框；notfound保留fullmenu，回concise alternatives（ref/name/price/category，無configs）給Main。使用者後續明確要求「只看某類」也只框選：已移除public display參數及filter分支；缺少當前task/dialogue或catalog能力時拒絕非空查詢，不退回原生篩選。query空字串仍可清除手動篩選。未加新native契約。未加購物車/送單動作。
- `createMenuReplyWindow({sourceUtterance})`在Main本輪記錄查無query；不把非本輪明確詞的查無回執拼到最終（包含options.outcome），保留本輪多品項明確缺品和raw診斷。Common/Browse policy要求只處理最新題、無合理相近品時先問是否其他推薦、不捏造食材或自訂排除；這是prompt修正，仍需真人/Live Main後續驗收，未聲稱模型從此不會發錯工具。
- 文字框選原本已有`acknowledgePresentedReply`→speak，前述聲稱完全漏接不精確，已向使用者修正。真正缺口為preservePage讓舊search隱藏/畫面外卡片被跳過。text傳revealMenu=true，只有fresh observed page=menu才許native reveal；cart/checkout及語音維持preservePage=true。版面/原始辨識/商家購物車不改。
- 回歸先red重現（魚→舊粥、text reveal、ordinary lookup不filter）；Kiosk1059 pass/49 skip；targeted287；Glow+Scenario browser3；shared20；policy4；scoped Kiosk types及targeted lint/build通過，未root types/commit。新browser glow真click可穿透、尺寸不變，截圖`apps/stage-kiosk/src/components/__screenshots__/kiosk-activity-glow.png`是元件fixture不是完整現場UI。
- 真Electron46＋正式PB＋真Host compiler/task/presentation重播既有工具順序通過：notfound不blank且有alternatives；魚後故意再查粥最終只魚丸湯50元，text原生彩色框魚丸湯；最新重驗「只顯示魚類」仍框魚丸湯且保留13項；初始自動定位與手點便當都scroll616，重新discover保留客人scroll0，1040×1416直式native viewport完整13卡可見。`pb-test.local/kiosk-activity-query-20261119-r1/native-verification.json`，獨立profile、阻止merchant POST等寫入且count0；是recorded tool replay，不是新Live Main模型驗證。harness esbuild標external的sury/effect已確認為xsschema optional peers，raw JSON tools不走那些adapters，未改production依賴。
- 本輪追加驗證：Kiosk orderingTools/cartTask 231、shared orderingTools20通過；Kiosk/UI scoped types、5檔lint通過，native bundle重建及真Electron/PB回歸通過（zero writes）。未root types或commit。
- 未停使用者本機隔離系統，未改`pb-test.local/site`或正式static/API、未重包Windows。用manage stop/build/start/electron重建後，才會載入這批前端與新common policy；單重整舊建置不會生效。本批新增功能屬前端/Server政策；上一批尚未發布的換桌/初始定位仍需要重建Desktop，整體本機build會一起取得。

## 2026-11-19 菜單可讀性／ASR 熱詞／換桌回頁（本機原始碼完成，未發布）

- 使用者授權同步完成前述5項回饋，先本機測試，不部署現場。Kiosk上下比例改助手25%／點餐75%，font預設28（保留已存管理員字級）；對話預設本輪及未完成需求，可展開歷史，ASR／模型／audit原文不裁切。Main common policy要求一般回覆1–2短句，一次一個問題，購物車／送單摘要及未知狀態保留完整。
- `tableChoices` 缺少是真缺口：Main在menu用選桌／問桌工具直接parse選桌schema。新增public `return_to_table`→native `browser_return_table`，menu/cart問桌與選桌先回同店approved table GET，再讀真桌號；不選桌、不Start、不清cart／送單。shared receipt `table-selection-starting`、client及ServiceSurface只承認相關operation／原document／service owner及同店table target，不能用此收據settle cart write。需重建Desktop＋前端；未換正式EXE／未重包Windows，package仍0.6.9。
- PB menu初始定位等第一分類標題、對應原生tab及商品DOM，點一次第一分類tab（目前便當）；實測此tab只scroll不filter，直接沿用PB sticky offset。MutationObserver只到第一次定位／trusted takeover／pagehide；保留已有scroll。已在view內的推薦一次框整批，不逐品項1秒dwell或introduce input lock；preservePage語音提示若offscreen就取消提示，不自動捲。較小螢幕仍可正常捲動，不能宣稱任何解析度都同時看到13品項。
- Legacy ASR捕捉時固定serviceId及既有browserPresentation cache餐名（不為熱詞加PB fetch）；Server驗設備assigned immutable Profile的site，加published餐名／aliases，經gateway最多100去重詞／JSON預算1500字＋提示prefix後放`prompt`。upstream kitchen-asr-v0.4 OpenAPI已確認支援；原ASR transcript不改寫，不新增模型。Falcon binary未加未驗證欄位。詞彙只提示，不授予購買權；ASR真人準確度尚待現場驗收。
- 驗證：Kiosk1052 pass/49 env skip；conversation browser16；presentation browser12（真click不被passive batch鎖）；client24；shared29；Desktop41 pass/1 opt-in skip；audio gateway/route選測5 pass（其餘152為name filter）。Kiosk/UI/Server/Desktop scoped types、targeted lint、兩build、diff check過；未root types或commit。
- 真Electron46＋正式PB獨立profile/實際ServiceSurface，證據`pb-test.local/kiosk-menu-readability-20261119-r1/native-verification.json`：1040×1416菜單viewport13項同時可見、3品項batch約493ms且scroll不動、重新discover保留scroll、換桌receipt完成並重新取得A3-1等桌號；沒有加餐/送單。開發X11螢幕會clamp hidden host，harness明確set原生view viewport、showInactive；這是直式viewport驗證，不是現場螢幕驗收。未focus視窗sendInputEvent滾輪無法可靠證明manual takeover，已撤該fixture斷言，改真browser click測試，未更改產品去配合。
- 使用者本機manage系統及Electron仍在跑舊build（shared Electron未開）。刻意不停止其測試或替換`pb-test.local/site`。下一步在使用者結束當次操作後依序`python3 scripts/pbTest/manage.py stop`、`build`、`start`、`electron`，可用目前來源重建本機前後端/native。現有saved字級若20需管理員調28。不能只重整或用shared-electron看這批。

## 2026-11-20 CodeGraph live／專案 MCP 已接通（既有 chat 直接呼叫成功）

- 依使用者「開始進行」完成計畫 C／D 的設定與專案 runtime 驗證；source of truth 為 `docs/plans/codegraphWatcherIntegration.md`，新證據 `codegraph-pilot.local/live-20261120-r1/verification.json`。保留官方 v1.6.3 Linux bundle，無 installer／全域依賴／產品部署／服務重啟／commit。
- `codegraph.json` 排除根目錄其他範圍、其他 apps、本機資料與產物，實際 2468 files 與上游 scanDirectory 候選完全一致；涵蓋 Kiosk／Kiosk Desktop／Order Menu／Order Menu Server／Server＋packages。live init wall18.298s、slice peak955.12MiB。Git hooks hash未變。臨時未import的 `packages/stage-shared/codegraphAcceptanceProbe.ts` 自動新增／刪除各約0.502s（先看DB hash後query），已刪除且圖譜無殘留。六live整合檢查通過；35點105HTTP全200，API listener PID3342245/starttime前後一致，收尾仍健康。
- 新 `scripts/codegraph/run.py`＋`webnaviorCodegraph.slice` 使用每次連線的transient scope、共用CPUQuota100%／MemoryMax2GiB／High1536MiB／無swap／Tasks128，nice19／idle IO。已確認實際daemon/worker在slice，產品來源mount ro、只索引與專用tmp可持久寫，Bubblewrap隔離外網且私有/dev讓detached spawn可用。雙連線共用daemon且第一連線關閉不會kill另一個。只啟動器，沒另寫watcher／MCP代理。全域daemon registry不可寫，操作以slice或worktree pidfile為準。
- `.codex/config.toml` 已建立optional codegraph stdio、六read tools、startup30/tool60、不變更approval；顯式轉交DBUS_SESSION_BUS_ADDRESS與XDG_RUNTIME_DIR供啟動器使用，原生工具內環境會清空。啟動器絕對路徑是此主機路徑；索引root繼承專案runtime cwd，再git解析各worktree。不要把MCP cwd固定指原worktree。其他主機需相同bundle/systemd/Bubblewrap並調路徑；缺少依賴不fallback到無限制執行。
- `codex mcp get codegraph --json`確認trusted project設定可見；installed Codex app-server以本專案cwd的ephemeral runtime直接載入專案設定，status/node(readPbJourney)/callers均成功且六工具可見。無model turn、無持久側欄chat。非thread全域MCP清單讀使用者層，曾回空／用user .codex cwd不能當project驗收；最終測試沒有copy config overrides去假裝project成功。後續使用者回報找不到Restart時，這個既有chat已出現工具，直接呼叫mcp__codegraph__codegraph_status成功，當次2448 files／零待同步；不需再要求Restart。未重啟整個app／其他chat。
- AGENTS加入cross-file navigation／freshness／call-vs-import與Eventa限制規則（新增段落byte27832–29572，位於Codex預設32KiB文件預算內），.gitignore忽略索引。仍只有一處已知wlipsync JSON import attributes parse_error；status零pending不代表解析／編譯正確。未改產品去配合工具，未跑產品測試／root typecheck；實際CLI/MCP與py_compile、scoped diff檢查為本輪驗證。
- 日常MCP連線會啟動原生watcher；最後client關閉後原生約5分鐘idle退出，再連線補離線變更並確認freshness。停用：project config enabled=false並重載MCP，然後 `python3 /home/aimax/webnavior/scripts/codegraph/run.py stop`（只本integration slice，含其CodeGraph worktrees，不碰產品服務）。writer釋放後可同launcher sync/index。保留live索引；不要用/tmp隔離副本作正式MCP。先前17項隔離／十分鐘結果與外部r4啟用時單點probe中斷記錄仍在11/19 evidence與計畫中。

## 2026-11-19 09:57 手動初始化不再依賴 PB（0.6.9 已交付／前端已啟用）

- 使用者最新明確要求：訂單未確認也必須能初始化我們網頁，PB 不確定狀態由現場人工處理。本輪僅改手動 `staff` 初始化；自動 idle／confirmed completion 的既有核對清理保留。shared lifecycle 將 reason 傳入 resetInteractiveSurface；Kiosk staff/PB 分支不讀訂單、不等 clear、不呼叫 browser_customer_reset。清接待與對話、結束舊 visitor、撤銷連線後 renew entry；PB transport 失敗不能 veto 本機初始化。
- EXE 新 Host-only `browser_reception_reset` 即使 editorRetired／結果頁仍可用，繞過 commerce FIFO，只解除本機 cart-pending 標記、使舊 queued control／confirmation 失效並移除我們的視覺。已派送商家工作不重試、不取消、不當成功；PB cart／order／payment 不動，staff 人工處理。結束前 visitor 的 `browser_previous_operation_retired` 記 `resolution=host-only-initialization`、`editableCartCleared=false`；舊操作結果仍在原接待歷史。下一客的非空 cart ownership 核對仍在，不能宣稱所有購物車檢查都已移除。
- 實際正常 Linux Electron46＋正式 PB，獨立 partition，三種 order/reset/cart 虛構本機標記均解除、原 PB 欄位與 URL 不變、商家寫入0。另只在 isolated adapter 的 fetch 邊界 hold 一筆只讀請求，local reset 0ms 完成；不是現場長 loading 重現。證據 `pb-test.local/kiosk-host-initialize-20261119-r1/native-verification.json`／harness。Host regression 先 red（未知訂單 veto）再 green；165 Kiosk、22 transport、41 Desktop（1 opt-in skip）、4 publisher；三 scoped types、lint、兩 build、diff check 通過，未 root types／commit。
- 完整0.6.9 ZIP `pb-test.local/kiosk-host-initialize-20261119-r1/windows/Webnavior-Kiosk-GPU-Windows-x64-20261119-095520.zip`，314464786 bytes，SHA `de2391cfe50590b6e01336dd7a47a2e5a2713b946d3737b93373df5f5f0f9263`。3708 payload SHA／CRC、1263 source freeze 過；對0.6.8只 main／PB bundle／package version／quickstart 4 payload 變更，設定、preload、音訊及模型 runtime 不變。必須完全退出舊 EXE、整包解壓新目錄，沿用既有 profile／自訂 settings；Windows實機驗收未做。
- 前端 09:57:17 已啟用573檔／98變更，四入口 index/version＋公開 JS 共9 HTTP bytes 過；保留舊 hashed assets／備份、不強制 reload／不重啟 API（PID1435071）。sudo -n 最初要求密碼而未執行，後確認 static 屬 aimax，直接既有使用者權限發布成功；不是要求使用者 sudo。禁止重跑已啟用 publish.py。
- **未營業偵測尚未交付**：使用者解釋未收到單因未營業，但只指開頭公告，沒有當次送單拒絕原文。唯讀現行官方 Create-BWGQ0ONq.js 確認 order/diningTime Inertia error 會原頁 toast。Chrome 回歸可過，但真 Electron isolated world 的 inertia:start detail 因 visit 含不可跨世界資料而為 null，故撤回整組未驗證 refusal production／test 修改，未打包。初始公告不是這次訂單拒絕證據。後續若實作需有效跨 world 的限縮觀測／商家回應關聯；不能宣稱偵測已修。發票 radio 焦點、Main 結帳上下文等前節問題亦未在本包修復。

## 2026-11-19 09:17–09:35 現場最新結帳紀錄（僅唯讀檢查）

- 使用者正在測試，要求查看尤其發票被遮擋。唯讀近2小時999事件，DEV-908979兩段主要接待 `DFZcOd0ch8tnlG_2258B3`、`s3XiRWnzG-PwTgOesI6v_`。遮蔽通知資料的對話及操作證據留 `pb-test.local/checkout-review-20261119-am/evidence.json`，完整原始僅 `/tmp/nov19-checkout-recent-private.json`。未操作／重置／重送現場訂單，未改產品或發布。
- 09:22:21、09:22:29、09:23:25、09:23:51、09:32:10，`browser_checkout_prepare`「前往發票方式」step failed、無dispatch，約3.5秒；與前輪已正式PB重現的checked radio被同label裝飾span命中誤判一致。當前來源仍未修該input定位。兩次正確（09:22／09:32）各自同utteranceId，fast-path失敗再交Main而重記user_text，不應當成使用者說兩次。09:22 Main重試相同焦點失敗；09:32 Main改list_cart_items，結帳流程倒退成詢問查看／修改購物車。
- 09:23:46辨識原文「我選擇武仔劇」，Main未澄清，仍continue_checkout重試相同失敗。09:24:39「統一發票」直接choose_invoice_method tax；09:25:04donation原生選擇與欄位focus成功，09:26:30完成表單後產生最後摘要。09:33:12「我要捐贈發票」卻ask_customer_question option且無商品名，回要確認哪餐哪組選項；09:34:29同句才正確選donation。
- **09:27實際送出，不可宣稱沒有送單**：09:27:14 browser_order_submit開始，原生確認框completed，submit step dispatchMs1848，等location.pathname改變30秒未成立，09:27:45 state/effect unknown（總31.87秒）。現碼以path改變作等待條件，尚未證明商家成功／拒絕／同頁驗證；不可直接重送或以timeout當未送出。需取得該次PB結果頁／同頁validation或對應請求結果來確診。這是現有送單結果觀測缺口的新具體證據。

## 2026-11-19 全晚點餐紀錄／現行0.6.8逐項驗證（尚未實施新修正）

- 使用者要求11/18台北18:00起全部點餐紀錄，明確強調模擬測試也有價值；已唯讀匯出5760事件／60接待／25段有user_text，保留simulation來源及對話重複列。手機／載具等遮蔽後的HTML、435列對話CSV、5760列事件CSV在 `pb-test.local/ordering-records-20261118-19`；原完整資料只留 `/tmp/nov18-19-ordering-all-private.json`。最新原始事件03:08，本輪新驗證另存，不混入舊報告。
- 最新指示是「驗證是否已解，未解預計如何」，授權真Jev/Main；本輪無產品修改／build／部署／重包。`pb-test.local/ordering-verification-20261119-r1/verification.html`及JSON有16項狀態、證據、修法與交付邊界。正常Linux Electron0.6.8、LAN正式Host、正式PB、沿用自建DEV-722025獨立profile，僅此測試設備切純文字。14個真Main tasks及Jev trace留real-model-events/turns；未送正式訂單，結束已reset清空草稿、回選桌、關本輪Electron。
- 已實際通過：A3-1、A31→問→對、A3之二；直接水餃12顆=1份96元；手機載具自動focus後不重新定位直接keyboard `/ab12345`+Enter→`/AB12345`且不送單（非實體scanner）；虛構 `order:00000000-0000-4000-8000-000000000001` 明確reset清草稿／移標記／retired audit，下一位能進菜單加餐。35真Electron lifecycle、held-resource loading、405相關Kiosk unit、44Chrome checkout/controls、4共享桌名過；其他回歸有重疊不累加。
- **未解且重現**：`幫我推薦`仍選櫃台（Jev路徑過度信任選桌）；`A3的第二桌`被先截成A3判不存在；`洲式水餃`查不到；pending cart-target時open_cart被舊問題攔住；invoice數字仍可被Main導向推薦（本輪捐贈發票也錯到價格範圍）。水餃短答：`我想點周氏水餃`→問幾份→`來12顆`先回effect:none未完成且無native add；下一句`炸排骨便當一份`，Main實際先補加12顆水餃再加便當，cart226元，處理時序／失敗回覆不一致，不能只看直接12顆通過就稱全解。
- **已確診發票卡點**：正式PB checked radio input opacity0，上方同一label內的 `span.el-radio__inner` 擋住input中心；`pbCheckout.focus('invoice')`直接以input當命中目標誤判「前往發票方式被其他畫面遮住」。不是我們整區loading遮罩。需以可見同選項label做movement/hit-test再focus對應input，不能關閉hit-test或force click；此native PB bundle改動需新EXE。
- 用既有私有setup暫時附加歷史case，5個unit與1個Chrome最小重現均fail；測後逐byte恢復三個原測試檔，patch/log留stage，未留下紅測試於產品來源。推薦一份後補12顆也未帶完整顆數配置。下一步若授權實作，先把這些audit patch轉正式回歸，再修顆數／草稿生命周期、舊問題導航、發票焦點與結帳上下文；不要只調prompt。
- 證據不足：18:35舊送單click completed但結果未知，未有原結果頁受控payload，本輪不送真單，不能宣告根治；舊失敗後idle提醒宣稱已加入，現行reminder仍依歷史生成，grounded回覆單測不等於此整段已驗。完整修法及限制留verification報告。Windows物理語音／scanner／現場偶發白屏仍非本輪驗收。

## 2026-11-19 使用者要求真 Electron＋正式 PB，找到原生雙提示重置失敗（0.6.8 已整包）

- 使用者質疑只用自建測試頁。已實際啟動正常 Linux Electron46.0.0-alpha.2／Node24.22.1 的已建置0.6.7→0.6.8 app，DISPLAY=:1，LAN `http://172.17.69.17:5169/kiosk/`，不加no-sandbox／fake media／software GPU，不用Playwright launcher、不攔截商家請求。獨立profile `pb-test.local/pb-real-electron-20261119-r1/profile` 自己註冊DEV-722025；真正式PB `https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table`。不複製現場登入，不加餐/送單/付款。
- 正式PB實際A3-1、A3-2、櫃台Start三輪 menu完整load458/434/412ms，HTTP369/381/344ms；初始選桌cold1171ms。未重現現場長loading，因此不能聲稱已修該偶發卡頓。角色本輪啟動165ms，無物理Windows/音訊硬體驗收；其他模型不能據此歸因。
- **正式網站確實抓到fixture未涵蓋的失敗**：0.6.7無餐點新設備在「領券」＋「營業公告」同時存在時，Host reset先點下層公告，native hit-test拒絕；本機UI仍顯示operation-unconfirmed。唯讀只查DEV-722025，`/tmp/nov19-real-pb-native-private.json`，03:04 native步驟notice failed「關閉營業公告被其他畫面遮住」。手動只按「稍後再領」後，原0.6.7同一reset於03:06成功，證實是PB提示層級，非舊訂單/網路。
- `pbControls.dismissAnnouncement` 現先辨識唯一可見role=dialog（含「不再顯示此優惠」及「立即領取」），只按該dialog唯一的「稍後再領」，驗消失後再點公告。仍走operation真實可見性/單次dispatch/readback；不領券、不改checkbox偏好、不force click、不自動處理其他確認。正常PB提示仍呈現，只有工具操作/明確reset需要時處理。順帶修forReset工具描述仍說behind cover的過時字串。
- 先以正式網站重現，再新增對應Chrome最小回歸red（下層公告hit-test），修後30個controls browser tests過、scoped UI types、3檔lint、Desktop build過；未root types/commit。重開**實際0.6.8 app，同一獨立profile、真PB**，保留兩層提示，直接按Host reset；03:08 native completed依序「暫時關閉領券提示」→「關閉營業公告」→空搜尋，1343ms後回選桌（新頁236ms）。正式before/manual-control/after evidence及截圖、JSON報告留 `pb-real-electron-20261119-r1`；測完window.close關閉自建測試Electron/CDP9347。
- agent-browser安裝版較舊不支援skills get（已依skill嘗試，改讀--help）；tab list實際輸出numeric IDs，重開後Host/PB順序會換，必須重新識別URL。一次get attr參數順序錯誤和一次async dropdown snapshot stale是CLI操作失敗，未算成PB failure；其後實際[pressed]與Start均確認。
- 新Stage `pb-test.local/kiosk-pb-coupon-20261119-r1`。完整0.6.8 `windows/Webnavior-Kiosk-GPU-Windows-x64-20261119-030956.zip`，314464382B，SHA `e817f89f66b1127d8812f33976d90fb4673d045e0c1be6d3564fcb3f22dbede5`；3708 payload SHA/CRC及1263 source過，對0.6.7只有PB bundle/app version/guide三檔變；main/preload/settings/audio/models/runtime逐byte不變。修正需整包換EXE，改伺服器不能取得native PB peer。
- 網頁程式沿用load-diagnostics0.6.7，不重build/reload；僅已發布version.json.desktopVersion=0.6.8，metadata的frontend release仍0.6.7是正確的。stage publisher 4filesystem測及9 HTTP bytes過；API PID1435071不變、不restart；activation/backup/validation/READY留stage，勿重跑publish.py --activate。現單完成後退出舊EXE、整包解壓並沿用自訂settings/profile，無需sudo。往後fixture測試需搭配實際Electron/正式PB驗收，不能把兩者或Windows實體驗收混稱。

## 2026-11-19 PB 偶發慢載入／其他大型模型診斷（0.6.7 整包及配套已發布）

- 使用者要求程式自動記錄 PB Start 偶發長 loading，也查前端大型模型。已澄清重點不是 MediaPipe；正常相機在 Kiosk mount、初始麥克風權限 gate 後啟動，不等 PB 菜單；conditional Face 可稍後首次需要才載。PB Start 沒有直接模型初始化呼叫，尚未確診現場卡頓根因。
- 新 `apps/stage-kiosk-desktop/src/main/diagnostics.ts` 是 installation-local recorder，預設啟用，不需 diagnosticPort。Windows `%LOCALAPPDATA%\Webnavior\Kiosk-Pilot\diagnostics` 的 current/previous/older.jsonl 三個4MiB輪替檔，1s async bounded512-record flush、5s samples、256 pending requests。Host/PB navigation/DOM/full-load、network first-response/完成/失敗/未完成/cache、工具hashed correlation、renderer long tasks及probe pending、app CPU/RSS/system free RAM/Main timer lag共用runId與時間線；reset/reload不清檔，未自動上傳。
- 只存domain/受控resource kind，不存path/query/fragment/header/body/customer fields/audio/video/任意console。console僅接受固定numeric model envelope；private Session唯一觀測頁的無frame worker請求標為session attribution，不能假冒document歸屬。probe pending亦可能是未完成load，不能單獨判freeze；firstByte包含connection/network/server而非DNS/TLS細分；Electron metrics不含external Python/provider，GPU process CPU不是GPU利用率。磁碟錯誤或過載drop紀錄，不阻塞點餐；crash最多遺失最近未flush約1秒。
- KioskScene記avatar pending/loading/mounted及VAD init；既有vision composable記相機初始化和>=100ms inference（每model5s限一次）。Index記native GPU status/start/open及array connect耗時，不逐poll記音訊。Falcon/ASR/TTS/ordering走server/provider，不在瀏覽器載大模型。UL-UNAS/OpenVINO是native GPU首次非devices request（含status）載入/compile；capture-only LCMV不載這個模型。角色/模型/音訊設定變動可重建，非每次Start。來源審查與限制留stage/model-audit.json。
- 找到確實多餘的大項：shared Stage mount無條件getDb()只為future stub，之後無使用。移除此import/use/onMounted call；DuckDB公共模組及其原tests保留，未更換library或其他資料庫用途。舊build有31–36MiB各DuckDB WASM variant，新build已無DuckDB WASM（不是聲稱全部variant每次都下載，亦非已證明PB field freeze原因）。
- Stage `pb-test.local/kiosk-load-diagnostics-20261119-r1`：先真Electron red重現無常駐紀錄；new fixture用held HTTP＋real timer longtask驗pending/error/completed/model/process/privacy/仍可見。最初以CDP evaluate busy不產生可用longtask，改真正setTimeout task後過，是fixture修正。8 unit（diagnostic3/protocol2/DuckDB3）＋1 opt-in native integration skip；3真Chrome vision；35真Electron lifecycle＋diagnostic fixture；4publisher；Kiosk/Desktop/UI scoped types、8檔lint及build過。僅修randomUUID default的TS推斷，無runtime workaround。未root types/commit/正式商家寫入/Windows實體驗收。
- 完整0.6.7 ZIP `windows/Webnavior-Kiosk-GPU-Windows-x64-20261119-025649.zip`，314464226B，SHA `374af8a1eaa266896449f75245d21ba34287ba869029ed63f5c3bf6b0ebffb86`。3708 payload SHA/CRC；對0.6.6只有main/version/guide三檔變，PB service/preload/settings/audio/models/native runtime逐byte不變。1263 source freeze；Stage import僅LF whitespace修正發生build後，編譯行為不變且postverify source已核對。舊未交付draft ZIP已移除，勿使用較早025508包。
- 配套UTC2026-11-18T18:57:41（台北11/19 02:57）已發布491 changed/573 static；14 invariants、1263 sources、9 HTTP bytes過，API PID1435071及DB/Redis ready，不restart、不force reload；舊hashed assets保留。activation/backup/validation/postverify/READY及logs留stage，勿重跑publish.py --activate。現場完成現單、退出舊程式、完整解壓0.6.7並沿用自訂settings；無需sudo或刪profile。下次incident記時間並保留diagnostics資料夾，不能再只憑Host/PB混在一起的redacted timeout判原因。

## 2026-11-19 解除換頁／重置整區遮罩（0.6.6 整包完成、配套網頁已發布）

- 最新範圍由使用者澄清：「重新整理／重置也把整個菜單蓋住」才是要移除的卡死情況。移除 Host 自動準備／舊購物車整區遮罩、換頁 spinner／native visibility gate，以及 PB reset maintenance cover／input trap。正常點餐問答、電話／發票／付款、管理設定及 PB 原生提示維持；不要再擴張成介面重設計。工具仍守文件／cart ownership／uncertain-effect 邊界，沒有自動重播或取消正式訂單。
- 使用者已確認現場0.6.5。唯讀紀錄顯示02:11曾成功 retired old order marker；02:19–02:23重置反覆 `Invalid type: Expected true but received false`，native cart_get 的 notice click 失敗。原因是 reset preflight 的 forAdmission 在 menu 會點 PB 公告，與我們遮住 native view 的可見性檢查衝突。resetConversationService 改純讀 menu preflight／post-Start；只在 table 做 admission 私有讀取，並保留已知失敗訊息。先有 unit／真Chrome／真Electron red 再改產品。
- Surface 在 full navigation／resize／refresh／初始載入均依 desiredVisible 顯示，automation readiness 仍等完整 load。KioskScene 不再啟動會覆蓋菜單和全域停輸入的 cartPreparation；每次工具的 browserCartSession ownership 保留。NativeServiceSurface 不畫 loading spinner；ScenarioSurface 不因 transport loading inert。pbPresentation 移除 maintenance cover，保留正常 introduce 短暫鎖定；PB reset 仍驗空、去重，人工可見並可介入。
- 現場暫存仍在 `%LOCALAPPDATA%\Webnavior\Kiosk-Pilot`，不要刪整個 profile（會動配對／登入／音訊設定）。Host owner key `webnavior:browser-cart-owner:${origin}${journey.menuPath}`；native pending key `webnavior:pb:cart-pending:${baseUrl.pathname}`。既有明確 Restart 在操作 settle、fresh cart empty 後清掉目標 pending marker；retired kind 留在結束前 visitor 的後台 interaction entries，不傳給下一位。
- Stage `pb-test.local/kiosk-reception-reset-20261119-r1`：427 unit/7檔、真Chrome6 native-surface＋11 presentation、35真Electron＋held-image lifecycle、4 publisher、Kiosk/Desktop/UI scoped types、targeted lint及兩build通過。第一輪 Electron 唯一剩餘失敗是 guest Start 的舊「必須隱藏」測試預期，更新後全過；非新增產品故障。無 root types／commit／正式商家寫入／Windows實體或真人語音驗收。
- 配套已於UTC2026-11-18T18:37:30（台北11/19 02:37）發布98 changed/591 static；1260 source、14 invariants、四入口index/version＋公開JS共9 HTTP bytes過，DB/Redis ready，API PID1435071不變、不restart、不force reload。activation／backup／validation／post-activation-verification 保留；不要重跑publish.py --activate，無需sudo。
- 完整0.6.6 ZIP `windows/Webnavior-Kiosk-GPU-Windows-x64-20261119-023554.zip`，314459757B，SHA `1c557cd93c0d666cc795391ec6bb41eca1dc48011a5043413b16e2d3c7ae6e90`。3708 payload SHA／CRC過，對0.6.5只有 main/PB service/app version/guide四檔變；preload、設定、音訊、模型／native runtime逐byte不變。完整解除 native 換頁及 reset cover 需要換EXE；只更新網頁不夠。完成現單後完全退出舊程式、整包解壓新資料夾，保留自訂settings與既有profile。現場尚待實測。

## 2026-11-19 A31/A32 近似分桌確認（網頁已發布，沿用0.6.5 EXE）

- 使用者明確指示實施「近似候選→先問→確認後選桌」，不再換EXE。前端新 `services/tableSelection.ts` 僅把完整桌號需求缺分隔號（A31→A3-1）當候選；有實際A31（即使同義重複）優先原精確流程，不模糊取代。多候選問哪桌；拒絕不選；確認只select不Start，不繼承原句Start或購買。A3之一/之二精確比對保留；不是任意語音/拼字模糊匹配。
- BrowserDialogue持有visitor/doc/table-list/current-selection/120s expiry綁定的一次性table ticket，reset/navigation/manual/table refresh撤銷。FastPath供只提問候選，下一句Jev選issued answer ID；Main公開選桌/開始工具保留Host question，prepareBrowserQuestionAnswer只在canonical錄入後經原Host選桌executor消費；傳給native仍完整現有桌名。KioskScene只擴既有question validator目的清單；Dialogue table projection/validate先於必需cart的menu parser，防table頁讀cart錯誤。未改shared/native桌號解析或EXE bridge。
- Stage `pb-test.local/kiosk-table-confirmation-20261119-r1`：531 tests/6檔、4publisher、Kiosk scoped types、11檔lint/build過；red含原無確認、Main錯誤覆蓋問題與exact duplicate優先；Jev完整兩句模擬走實際Host task已驗（測試初次未await就release造成拒絕屬fixture，已改符合Scene生命週期）。1260 source freeze、591 static SHA、14 runtime/Admin/設定/既有修正不變量及9 HTTP bytes全部過。未root types/commit/正式商家寫入/Windows真人語音驗收。
- 已於UTC2026-11-18T18:19:32（台北11/19 02:19）發布99 changed/591static，API PID1435071不變、不restart、不force reload。0.6.5舊ZIP的main/preload/PB service與現out逐byte相同，Desktop來源未改，沒有重包。activation/backup/validation/unchanged-native及各logs留stage，勿重跑publish.py --activate。現場完成訂單後重開現有0.6.5載入新網頁即可；需人工驗A31→詢問→對只選A3-1，再說開始點餐，及不是/改桌。


## 2026-11-19 PB 舊警告跨客／錯誤購物車引導／A3-1 分桌（0.6.5 配套已啟用／驗證，待現場EXE確認）

- **最新部署狀態取代本節下方準備狀態**：使用者回報activate成功，已postverify API PID1435071、DB/Redis ready、1 API檔／591 static／13 invariants及四入口index/version＋公開JS共9 bytes核對全過。Stage有post-activation-verification.json與http-verification.json，validation/READY已更新。不要重跑activate.py。尚未確認現場換完整0.6.5 EXE或Windows實際分桌/重置/點餐驗收。

- 使用者授權查看最新紀錄；唯讀查DEV-908979最近接待，實際餐點需求已選對且Host允許，但native cart add在0.1–0.3ms、steps=[]被既存持久order/cart marker拒絕。頁面/購物車仍可讀，不能把這些案例說成PB掛掉。另實際Main `reply_to_customer`多出parameters被嚴格拒絕(effect:none)，Host漏接非cart拒絕而誤成未知操作；重置有after-table-entry缺cart的真失敗。未在近期原句找到「我想點餐」，勿宣稱新增語意規則或所有斷線已解。
- 使用者明確要求舊訂單待核對不得影響後人重置／新單。0.6.5 普通ordering/autorecovery仍不重播；明確Restart待接受操作settle後可清理目前editable draft、完整驗空後移除舊UUID/order:/reset:標記，回傳retiredOperation。Host把 `browser_previous_operation_retired` 保存到重置前接待的後台 `kiosk_interaction_entries.visitor_session_id`，新接待不繼承事件或同意；不是PB完整訂單備份。舊標記只UUID、沒有原接待/訂單內容，不能據此還原原單。當前uncertain write及真payment/result流程保護保留。
- known-none browser/host rejection現在進Host回覆窗；reply_to_customer參數在網站IO前safeParse，錯誤回INVALID_TOOL_ARGUMENTS/dataOnly，重用既有最多2批無副作用修正，未剝參數或做兼容。BrowserRecoveryBlocked把操作待核對與transport unavailable分開，不誤報菜單斷線。table admission支援after-table-entry，明確重置可用原選桌Start進菜單再清空。
- shared tableNames保留數字段分隔（A3-1≠A3≠A31），支援全形/之及每段leadingzero；FastPath抓完整分桌，真原生table picker核對A3-1/A3-2。0.6.5合併上一節0.6.4早顯示；要換完整EXE，單發網頁無法取得native修正。0.6.3音訊/preload/模型/設定payload完全相同。
- Stage `pb-test.local/kiosk-ordering-intent-20261119-r1` 有README/READY、release、activation dryrun、source freeze、validation、red/green/private查詢腳本及35PASS真Electron等logs。451 Kiosk unit、4 shared table、19真Chrome、35真Electron lifecycle＋早顯示、7publisher、Kiosk/UI/shared scoped types、targeted lint及兩build過。root types未跑、無commit、未正式商家寫入或Windows實體驗收。ZIP `windows/Webnavior-Kiosk-GPU-Windows-x64-20261119-015400.zip`，314459748B，SHA880109ac9934af81a7c736b18d140ffcc5fc8c621d00d3073c14892a1a2a27f4；3708 payload SHA/CRC、1258 frozen sources過，只4payload變(main/PB/version/guide)。
- **尚未發布/重啟**：live仍LCMV0.6.3 frontend＋voice-dumplings r2 API PID1312458。新activate.py預設唯讀；13 deployed invariants保留含4 voice/dumpling檔，防覆蓋新release/PID、API先ready→assets→index、備份回復。需操作者無人點餐時 `sudo python3 /home/aimax/webnavior/pb-test.local/kiosk-ordering-intent-20261119-r1/activate.py --activate`（需root restart，非一般escalated即可），再完全退出/解壓0.6.5，驗分桌/重置/新客。verifyHttp.py準備9 HTTP bytes比對，尚不可聲稱新版本線上已驗。若新發布改live，保護會先停；不要改guard或重跑舊activate。


## 2026-11-19 PB 選桌後白畫面／0.6.4 提前顯示（已整包，待現場換EXE）

- 使用者再次回報選桌→開始點餐→白畫面，詢問能否不遮擋；是人員回報，無法確認有無載入／錯誤文字。因此尚不能斷言每次現場白畫面同一根因。0.6.3 Surface 的 full navigation 會 setVisible(false)，等 did-finish-load 才復原。已用隔離真Electron46及loopback頁面重現：DOM ready、菜單已有內容，僅一張held image未完成，整個view仍不可見。
- 0.6.4 Surface 分開documentRenderable與documentLoading：dom-ready即可顯示商家頁，不必等load-blocking子資源；初始無DOM仍顯示Host載入提示。工具仍需完整load／原ownership與PB journey檢查，沒有宣布菜單業務資料已備妥；Host modal／settings occlusion、失敗與crash隱藏保留，未移除商家自己的遮罩或重播操作。這是EXE邏輯，僅更新後端／網頁不會取得。
- 新 `scripts/verifyKioskNativeLoading.mjs` 先red重現，再真Electron確認早顯示／resize／loading仍拒工具／host hide恢復／完整ready與hidden reload。既有verifyKioskDesktop 33 PASS，Desktop scoped types、targeted ESLint、build／diff check過；沒有root types／新依賴／commit／正式商家或登入／訂單操作。
- Stage `pb-test.local/kiosk-visible-navigation-20261119-r1`：完整ZIP `windows/Webnavior-Kiosk-GPU-Windows-x64-20261119-012548.zip`，314459139bytes，SHA e55af30a8c83357c420712084df2e57619d75839b87ed2b5da3238ba8a99022c。3708 payload SHA／ZIP CRC及1257 source freeze過。對0.6.3只有main JS、app version、quickstart三檔變；preload、PB service、設定、音訊、模型/native runtime逐byte不變。README／READY／validation及red/green等證據留stage。
- 沒有發布網頁／restart API／force reload／改現場設定。沿用目前LCMV 0.6.3前端及voice-dumplings r2後端；不需任何sudo。現場完成訂單、完全退出舊EXE，完整解壓0.6.4到新資料夾；自訂EXE旁settings可複製沿用。重測LAN選桌→Start→菜單。尚未Windows實體驗收；若PB HTML/JS本身失敗，仍需在實際重現期間取得診斷，不能宣稱網路或所有白畫面已解。

## 2026-11-19 0.6.3 原有 LCMV 原生八聲道修正（整包完成，配套已發布）

- 使用者轉向「先將原有LCMV流程修正，先確定這個流程沒有問題」。沿用原生八聲道／只動音訊且保留其他參數的授權；無新依賴／commit。先前LCMV卡在browser getUserMedia exact8，根本還沒進DSP；現只將desktop既有LCMV（含Falcon原本LCMV）擷取改PortAudio，普通browser／standard／Spatial Mask及native GPU選項維持既有路徑。顯式UMA-8可不靠browser枚舉；auto仍需既有可識別UMA標籤，勿強制把一般mic當陣列。
- 新shared `kiosk-array-input` v1 Eventa control＋generation-bound MessagePort；Main `ArrayInput`僅接受trusted Kiosk main frame，preload一次轉交port給browser DSP Worker。Worklet stereo384/8ms直達worker→Main→獨立capture-only Python→原worker AEC3 WASM／LCMV；UI只收最終PCM／telemetry，再走原gain／VAD/Falcon／ASR。沒有UI逐包轉發／GPU推論依賴；裝置枚舉獨立短命child，不能阻塞live input owner。navigation／close／replacement／stale generation、pending errors均清理。沒有放寬250ms／32pending或既有1s DSP/VAD界限。
- Python `--capture-only`選InputWorker，不建Frontend／載OpenVINO／ULUNAS／RTF模型；重用Capture真8mic＋實際stereo ref配對，保留100ms mic delay／±0.5% drift，rawOffset／renderOffset檢查連續。原worker與raw共用playback packet驗證。新raw open報captureDelayFrames，連線ready後扣除其延遲設定來源時間，避免把Python啟動算入語音時鐘。原LCMV／LcmvStream／AEC3 WASM實作／tuning／SpatialMask／ASR來源SHA與0.6.2一致。新native-lcmv-input偏好與GPU的map/gain/input互相獨立；原七通道map及LCMV參數保留。
- 重要接線驗證：Worklet在native LCMV等reference-port才開始offset0，避免port交接前丟開頭。Electron實際測試發現向MessagePortMain transfer ArrayBuffer附件會整包decode null（41實測）；只跨Main複製3KiB ref PCM、browser Worker/Worklet間仍transfer，46同版通過。NOTICE附官方port文件。原GPUWorklet預設啟動與250ms不變。暫時debug console已移除，不要恢復transfer到Main。
- stage `pb-test.local/kiosk-lcmv-native-20261119-r1`：Python46過2 opt-in skip；Chrome7檔31個distinct tests（含新rawLCMV真AEC3／非零16kPCM／source clock／真正ref／UI忙350ms仍續、native selector及standard切換），Desktop pipe/protocol3、publisher4、Kiosk/Desktop scoped types與targeted ESLint、兩build／diff check過。測試先red InputWorker缺失；原exact8邊界已有先前Electron重現。未root types。
- 真Linux Electron46.0.0-alpha.2＋正式preload／ArrayInput／NativeAudio／真Python Capture／AEC3 WASM／LCMV串接，只有外部PortAudio用合成8ch驅動。連續約28s、874 packets／447488@16k、非零且連續，browserCaptureCalls0、UI忙350ms與裝置枚舉350ms均不中斷；stop875 packets之後無late PCM。結果electron46-running/stopped/after-stop.json。此不是Windows實體8ch、聲學回音、真人VAD/ASR或完整接待驗收。audit harness／server全在stage；初次頂層await app.whenReady、middleware路由及Electron41資料transfer調查不代表產品缺陷。最後46同版整合過。
- 完整ZIP `pb-test.local/kiosk-lcmv-native-20261119-r1/windows/Webnavior-Kiosk-GPU-Windows-x64-20261119-005348.zip`，314458971bytes，SHA `af820e0193de2384310baf68e4a9f303ed59c01601112b3b7ffd2784bfdcf872`。3708 payload SHA／CRC、1256 source freeze及包內Python一致。較0.6.2只7 payload檔變（main/preload/appversion、worker、audio README/manifest、quickstart）；PB service、settings、weights／native runtime不變，沒把測試假硬體打包。
- 配套 `kiosk-lcmv-native-20261119-r1` 台北00:54:52啟用591檔／99變更，含0.6.3/nativeArrayInputVersion1/nativeGPUbridge3 metadata；4入口index/version＋public JS/Worklet10份bytes過。API PID338988未變，無API restart／Admin或PB發布／強制現場reload。publisher activation/backup保留勿重跑。validation／package-verification／source-hashes及logs在stage。
- 現場：完全退出舊EXE、整包解壓新資料夾，開一般Webnavior Kiosk.exe；設定→本機麥克風與喇叭→輸入模式UMA-8、處理管線既有收音方式、LCMV並套用（Falcon維持原本模式即LCMV）；選原生8ch input或唯一UMA自動，喇叭正常獨立選。無須Start Without UL-UNAS或五秒校正。勾管理員音訊測試，驗收音／辨識／播音及插話，再關管理模式驗接待。GPU候選自身舊ack/UI等待鏈尚未修，本輪不可稱GPU問題已解。

## 2026-11-19 語音15秒排隊丟棄／水餃總顆數與分份（r2後端已啟用，保留0.6.3前端）

- 使用者澄清：已辨識語音因前面Agent操作或ASR太久，後面被取消；不是要求移除250ms即時音訊保護。queue 先red重現，現移除default15s ASR watchdog及完整text ready後15s expiry；已接受句子依capture FIFO留存，不因等待超時丟掉。保留4 pending明示overload、reset世代隔離、實際ASR錯誤／Falcon明確provider deadline。未改錄音、視覺admission、idle15秒確認或送單consent。測試覆蓋前面操作60s及前面ASR60s，後句照序處理。
- 水餃沿shared pbMenuPresentation的既有8顆政策新增完整collection parser，bare10/12顆為一份、10顆2份／12顆3份保留份數；「一份十顆、一份12顆／一份正常」保留兩配置，正常=基本8。單一配置parser由Jev與Server共同使用；複合原句交Main，live quantity question可name-free完整承接並沿既有orders.collect／completeOrder執行。fresh question/cart/config仍核對、once消費；無品名綁定／別產品／詢價／否定／相對加顆不因數字自動購買。orderDrafts把總顆數換為每份extra，最新option/max/price仍executor核對。
- 後端order/common指引及shared orderingTools描述同步明示這個品項的bare-piece例外及分items；不是用單一固定話術覆蓋全部點餐。4 API overlay檔需restart（兩SKILL.md＋shared pbMenuPresentation.ts/orderingTools.ts），Kiosk前端配套一起切換。379 unit、shared22、Server27、三scoped types、11檔lint/build、publisher暫存filesystem6過；finalqueue14為子集。無root types／commit／真ASR或實單驗收。
- 不必重包EXE：隔離建置PB payload SHA669e8ef572e5be356bbcf474b39fa89722a3a2707ac34e5598e4e095d9860685，與現out及0.6.2 Windows ZIP內逐byte相同；未覆寫Desktop out／改任何音訊src／設定／模型。不要為本兩項發新Windows包，也不要把原250ms問題宣稱已修。
- r1 因線上已發布0.6.3，使用者sudo啟用時於static-before檢查拒絕；已核對無activation.json／before-activation，沒有寫入或重啟。不要重跑r1／解除guard。
- 改用 `pb-test.local/kiosk-voice-dumplings-20261119-r2`：逐SHA核對0.6.3 source manifest已含queue／dialogue／draft／shared parser與tools修正，591個live/artifact檔完全一致，因此沿用目前LCMV前端與metadata，所有static before=after、零預定靜態寫入；只補4 API overlay與restart。rebase-verification.json留來源證據；保留原PID／invariants／live-byte／reviewed source／備份與rollback防護。7 publisher測（新增API-only不寫static／不備份static）、dryrun及四入口加public JS共9 HTTP byte檢查過；既有379/22/27語義測試證據沿r1，未重跑root types。
- 使用者已sudo成功啟用r2：activation.json status=activated／restored=false，API新PID1312458；啟用後4 API SHA／591靜態SHA／invariants、9 HTTP bytes與readyz（db/redis ok）通過。無靜態改寫／強制reload，禁止重跑已啟用腳本。現場退出重開目前0.6.3 EXE後驗收長等待語音FIFO與水餃分份。本點餐修正不另重包EXE；0.6.3 LCMV既有配套需求保持。未真人語音或實單驗收。

## 2026-11-19 0.6.2仍250ms，整條錄音流程審視（僅調查／新增重現測試）

- 使用者重測0.6.2仍250ms，要求重新審視整條流程；async已明確回覆完整錯誤 `Native playback delivery exceeded 250 ms`。此精確字串唯一來自browser nativePlayback Worklet，offset-ack>=12000frames；不是Python捕捉queue／speakerqueue的另外兩個250ms，也不是五秒NPZ校正。0.6.2只改Capture配對／短ref缺口，完全未改Worklet確認往返，故不能認為修過配對就應消除這個訊息。
- 路徑：Worklet stereo384/8ms→renderer nativeCapture事件與bridge→preload Eventa→Electron Main NativeAudio binary stdin→Python main同步read_frame→Worker.poll入ref/read mic／48→16k／7AEC3／onlineRTF/MVDR／可選ULUNAS／AGC/VAD→stdout binary→Main解碼驗證→preload／renderer then→Worklet ack。ack表示整段DSP完成，不是ref已入列；傳輸與處理耦合。Worklet每8ms送塊，renderer或整段回覆停頓約256ms可積32塊觸發。模型略過只移除ULUNAS，此鏈其餘部分全在。
- 控制工作亦阻塞音訊：NativeMicrophoneSettings onMounted(refresh)先devices再status；devices同一Python同步stdin loop並進PortAudio query_hostapis/query_devices。新增test_worker.py真child/pipe重現，僅外部device query延遲350ms，不載模型、不跑mic callbacks或DSP，後續poll仍等待>300ms。這證實結構上可以阻塞，不是已量到現場裝置枚舉真的350ms。Eventa現有依賴source確認正常清理invoke listeners，未找到足以斷言其洩漏的證據。
- 真Chrome原有兩個repro再跑全過：純靜音ref＋外部native completion gate住會250；native快速立即回覆但renderer忙350ms也同訊息，均不需要GPU/AEC或硬體。worker檔9過（含新devices repro）。stage `pb-test.local/kiosk-recording-audit-20261119-r1`有worker-tests／browser-reproductions／validation。最初devices測試使用communicate與reader同讀stdout造成test race，已改單reader＋stdin write/close＋wait，修正後9過；不是產品缺陷。該初失敗log不當red產品證據。
- 追加問參考音是否模型需求／沒做五秒造成，已回答AEC3用browser實際喇叭PCM（無播放也送真靜音）消echo；ULUNAS只吃AEC/beam後單聲道頻譜及recurrent caches，無speaker ref input；五秒是舊anchor，現自動RTF不要求。再問能否鎖定AEC，已澄清不能鎖定AEC3演算法；可鎖定目前參考音與DSP/控制/UI共用等待鏈有缺陷，現場究竟哪段耗滿250ms仍需端到端量測。
- 下一個修復單元應處理獨立於renderer UI的參考音傳輸、分開入列確認與DSP完成、將devices等控制工作隔離／定義快照freshness，保留獨立DSP backlog上限與連續sample/generation；不能只把ack提前假稱處理完、放寬250ms、丟音、補假ref或默認CPU。尚未實施此架構變更／重包EXE／發布前端／重啟API／更動設定；本輪baseline1251來源只有test_worker.py改動。不要再把現場錯誤鎖成GPU或AEC單段。未root types／commit。

## 2026-11-19 0.6.2 reference 分批配對修正（整包完成，沿用現有前端）

- 現場用0.6.1略過UL-UNAS仍回報 `Browser playback reference underrun`，之後250ms；追問是否同步問題而非模型。已承認先前把GPU38ms/16ms說成現場主要原因過早。現證據支持兩個問題須分開驗：無模型也能觸發callback即時取ref缺口；原GPU報告仍確有超16ms，但僅3 hops不能當穩態／唯一根因。
- test-only先red重現：2400真ref後短暫100ms IPC停頓，原Capture._callback直接消耗40–50ms reservoir，即使read及無模型仍underflow，收音資料不能續處理。PortAudio/sounddevice官方說明非零blocksize可有host額外buffer，故不能假定10ms callback與browser8ms消息均勻交錯；未量到現場WASAPI回呼批次，不宣稱已證明唯一現場排程來源。
- 0.6.2 callback只copy借用的8ch mic buffer入有界queue；read在實際ref足夠時才依序配完整mic block，短暫缺ref保留未配mic／reference，不補假靜音／不丟sample。input累積與render各仍12000frames=250ms上限；原Worklet250ms／NativeAudio32pending限不動，真正UI長stall／模型持續過慢仍會停。保留100ms mic因果延遲、±0.5% clock resampling；drift控制減去待配mic frames，避免callback batch被當時鐘偏差。其餘device／gain／AEC／onlineRTF/MVDR／AGC/VAD／ASR／點餐、模型FP32及0.6.1process-local bypass均不變。
- ZIP `pb-test.local/kiosk-reference-queue-20261118-r1/windows/Webnavior-Kiosk-GPU-Windows-x64-20261119-000156.zip`，314456474bytes，SHA `5227bd575f4793b7cc6de2bcbabf416cb13d08a87352462e4843d4146fdf2f46`。3708 payload SHA／ZIP CRC、1251 source freeze／包內Python一致過。與0.6.1只5檔不同（app version、native_device、audio README/manifest、quickstart）；main/preload/PB、模型/runtime、settings及bypasslauncher全不變。未發布前端／Admin／PB／重啟API。stage留red／green／build／package-verification／validation證據。
- Python43過2 opt-in skip（GPU／stress），含100ms短ref暫停保留所有input、真Worker+bypass反覆100ms driver batch／8ms poll維持4秒PCM連續、±400ppm兩方向30秒drift、PortAudio借用buffer複用不改已存音、input超250ms確實fail、參考先於echo／無需喇叭等。外部PortAudio是假API，Windows實體／真ASR／長期雙講仍待現場。Desktop build與diff check過，無TypeScript／Vue／bridge變更，不需root types或新前端發布；沿用現行v3配套。0.6.0 source-pinnedpipeline probe仍不適用新來源。

## 2026-11-18 0.6.1 UL-UNAS 暫時略過測試（整包完成、配套已發布）

- 使用者要求先繞過小模型做測試；其餘流程設置不動。最新追問啟動無音是否模型太慢：依前節現場報告，GPU denoise 約38ms/16ms且獨立pipeline reference underrun，為當次主要瓶頸證據；僅3 hops不能判定GPU硬體故障或穩態效能，bypass實機結果仍待驗。
- 新增整包內 `Start Without UL-UNAS.cmd`：先完全退出舊EXE，整包解壓到新資料夾後執行。只在該次程序環境設 `WEBNAVIOR_TEST_BYPASS_ULUNAS=1`；Worker不載入／推論模型，status明示Bypass、gpu_verified=false。原生八聲道、AEC3、自動RTF/MVDR、gain/AGC/VAD、既有ASR/TTS／點餐及參考音傳輸／250ms門檻全維持。沒有存偏好；完全退出後一般EXE仍走原本FP32。未加CPU推論fallback、未改FP16或模型權重。既有處理方式選項需沿用native RTF/MVDR；此flag不會強制切backend。
- ZIP `pb-test.local/kiosk-denoise-bypass-20261118-r1/windows/Webnavior-Kiosk-GPU-Windows-x64-20261118-234632.zip`，314455657 bytes，SHA `b07a333af858544ef7a5a49d9725bdd68eece939166f0a7d11d0f01e0f393872`。3708 payload SHA／ZIP CRC、1251來源凍結與包內Python一致過。與0.6.0僅7個payload變更（新增launcher、app version、worker/denoise、audio README/manifest、quickstart）；main/preload/PB、連線設定、模型及native binaries全不變。
- 配套 `kiosk-denoise-bypass-20261118-r1` UTC15:47:28（台北23:47:28）啟用591檔／96變更，含version.json 0.6.1/v3；僅UI新增模型略過狀態。四入口index/version及公開JS/worklet共10份HTTP bytes過；API PID338988未變，未重啟API／發布Admin或PB／強制現場reload。publisher含activation guard與備份，不要重跑activate。
- Python39過2 opt-in skip、真Chrome3檔16過、Kiosk scoped types、2檔ESLint、publisher4、兩build、diff check過。red先重現Worker不接受bypass；新增測試驗missing model仍能bypass並輸出有限PCM、AEC/RTF/AGC保留、一般啟動仍fail closed、真child環境flag隔離／關閉後恢復、真Vue顯示Bypass而不冒稱GPU。不是Windows實體8ch／ASR驗收。stage留logs、validation、package-verification、source-hashes、activation及http-verification。未root types／commit。
- 現場：開launcher後設定頁應見「已略過UL-UNAS」。沿用native處理選項及既有input/map/gain，啟用管理員音訊測試，測持續收音／辨識／播音，再退出管理測接待。若仍250ms／underflow不能宣稱模型是唯一原因，需續查同步poll/IPC/UI。0.6.0 source-pinned獨立pipeline小包不適用0.6.1；一般原始8ch工具仍保留。此為可還原診斷，GPU效能尚未修復；LCMV browser exact8的OverconstrainedError仍另案未改。

## 2026-11-18 Windows管線JSON＋使用者追問RTD（推定RTF/MVDR；未改流程）

- User附 `/home/aimax/Documents/Native-Pipeline-Test.json`，首個cat成功讀取，之後路徑消失，故summary按已觀察數值轉錄，不宣稱保存原檔。summary在pipeline-probe stage/windows-pipeline-result-summary.json。success=false／stage native-pipeline-capture／browserIpcTested=false；OV2026.4.1 Iris Xe GPU.0 f32 gpu_verified=true、471GPU nodes、0CPU，WASAPI miniDSP input成功開啟，初始化2154ms。
- 0.2608秒就 reference underrun。processed/captured3840 @48k=80ms；output512@16k=32ms。AEC7次mean0.713ms/10ms；spatial3次mean0.665ms/16ms；GPU denoise3次mean38.044/p9538.802/max38.915ms/16ms（2.38倍預算）；frontend10ms mean17.518ms，poll max81.567ms，schedule max108.201ms，duty1.645。僅3 hops不能當穩態速度；但當次同步DSP停頓足以耗盡40–50ms ref queue，獨立無browserIPC亦失敗，不能把目前全歸UI。
- 全8ch RMS/peak0不是mic壞的證據：native capture預填100ms microphone_delay，此處只讀80ms尚在padding；前述raw工具已能收到8ch。RTF no_speech/updates0與此相符，不能當RTF追蹤成功／壞掉的驗收。
- 使用者打斷追問「那rtd的那條路線呢」。相關程式／CONTEXT無RTD命名，先明示按RTF/MVDR理解。這就是native-gpu管線：PortAudio8→AEC3→onlineRTF/MVDR(CPU)→ULUNAS/OpenVINO GPU→AGC/VAD→ASR；不是額外第三條獨立路線。RTF段確已執行，主要耗時在後段GPU，不能說RTF已完成真人追蹤。保留該路線，未切LCMV／停GPU／更改精度模型設定。
- 本輪僅報告分析／summary／handoff，無產品修改／重包／部署。後續需處理GPU實測效能及ref傳輸與同步DSP耦合，不只擴250ms、不丟capture／假ref／自動CPUfallback；LCMV的browser exact8另案仍未改。使用者限制其餘流程設置不動持續有效。

## 2026-11-18 現場LCMV亦OverconstrainedError，一般瀏覽器選項可收音（只核對，未改）

- 使用者新回報舊LCMV亦OverconstrainedError／無音，一般瀏覽器選項可收。程式確認KioskScene array && !native設getUserMedia exact8、48k ideal／AEC NS AGC off；LCMV/Mask仍走該browser raw擷取，取得stream後才createArrayCapture進LCMV。只有native-gpu走PortAudio。0.6.0前述原生化沒有包含LCMV；不能把其OverconstrainedError當LCMV演算法或OpenVINO錯誤，也不能聲稱LCMV已修。raw8失敗與native250ms是兩個邊界。
- 既有Linux合成Electron測試證據 pb-test.local/kiosk-deviceid-check-20261118-r1/electron-constraints.json：相同有效ID standard成功1ch、加exact8則deviceId constraint失敗、不指定ID exact8則channelCount失敗；非Windows實機能力量測。結合使用者原生8ch成功及browser standard成功，指向browser raw多聲道取得不相容，但現場完整constraint／實際caps仍無報告，勿斷言ID必有效或唯一硬體根因。
- 本輪唯讀核對與handoff，未動產品碼／演算法／增益／參數／EXE／前端或設定。若擴及修復LCMV，應在擷取入口改用原生真八聲道，保留LCMV與既有參數，不能降成mono偽多聲道。仍要處理native250ms／完整pipeline實測；不要因raw檢測成功宣稱後端管線已過。

## 2026-11-18 現場原生八聲道檢測可收音／完整管線診斷小包（未改EXE或前端）

- 使用者新增證據：「Test Native Eight Channel 可以收到8通道音」。可縮小為原生PortAudio硬體擷取基本路徑可用；該工具不跑AEC／RTF／GPU／browser IPC，不能因此認定完整即時管線可用。現場250ms error、啟動沒語音仍未解決。此次無產品碼更動／設定修改／重包EXE／發布前端或API restart，維持僅處理前述音訊兩項的範圍。
- 新增選用 `scripts/windows/probeNativePipeline.py`、`testNativePipeline.cmd` 與5項unittest，scripts/windows/README.md說明；小包 `pb-test.local/kiosk-pipeline-probe-20261118-r1/Webnavior-Native-Pipeline-Test-0.6.0.zip`，5893bytes，SHA `ac9af9e1c2de1b4620ea3d13f7d4c442079434243ed356d23427ace199794045`。3檔SHA／CRC／source一致過。解壓到0.6.0 EXE旁，先退出EXE／停止喇叭，再執行 Test Native Audio Pipeline.cmd；GPU準備後說15秒，回傳 Native-Pipeline-Test.json，非安裝校正。
- 工具核對已驗0.6.0十個Python來源SHA，沿用已安裝Worker／Capture／AEC／RTF／GPU.0及AGC/VAD，使用temporary state、explicit silent application reference，不存PCM／讀寫Kiosk profile／呼叫ASR或點餐。原封方法加計時observer量AEC10ms／spatial16ms／denoise16ms／frontend10ms／poll8ms與pollSchedulingDelay，報processed/captured/output／RMSpeak／speechSamples／segments／tracker／processingDutyRatio／原錯誤stage。預設channel0–6／gain30（不讀browser已存偏好，可明確CLI指定），不自動CPUfallback；supervisor子程序185+duration秒上限。
- 5測試過：真CPU Worker全DSP配合假外部PortAudio callback、真原生開啟錯誤stage、延遲真模型300ms會報reference underrun並保留timing、source mismatch阻擋、CLI parent保留child失敗。不是Windows實體GPU驗收。原apps／packages所有1250 snapshot對應來源核對無改；新增診斷與README不入目前0.6.0既有ZIP。無root types／commit；tools source-hashes及package-verification留stage。
- 下一步看現場完整JSON（不只success）：若pipeline本身慢或queue失敗，依stage/error/timing分辨GPU、AEC/RTF及排程；若獨立靜音流程成功且有餘裕，再縮小browser/UI/IPC。這不測browser播音／AEC double-talk／ASR，不可僅因success宣稱即時或完整接待通過。

## 2026-11-18 0.6.0 現場250ms delivery失敗（已重現觸發機制，未修／未發布新版本）

- 使用者回報 `native playback dilvery exceeded 250ms`；async澄清「目前開啟後台時出現，並且啟動後也沒有語音被收到」。沿用僅修音訊兩項、不動其餘流程的限制。此錯誤是 Worklet `offset-ack>=12000`，384frame/8ms，最多32個pending；不是原生喇叭host錯誤或校正。nativeCapture要等整個Worker.poll（AEC3／RTF／GPU都同步完成）才ack給Worklet，UI/IPC／DSP都可能阻塞確認；沉默時仍送zero reference。發生後dispose、Scene onError清audioInputStarted並abort，因此沒有ASR輸入合理。
- 新增 `apps/stage-kiosk/src/audio/nativeDelivery.browser.test.ts` 兩個真Chrome/Worklet測試均通過：外部native reply gate住，32個純靜音poll即可同訊息；native立即回覆先正常4次poll，再故意阻塞UI350ms，也同訊息。第二個不用GPU／實體mic，證明不能只因這錯就判定GPU太慢／mic壞。不是現場原因證明。管理面板v-if才顯示KioskVoiceDiagnostics，其error為持久audioStartupError；也可能只是顯示啟動早已失敗的訊息。devices/status和poll確實共用worker串行loop，但未量到現場枚舉慢或管理畫面實際耗時，不能斷言後台本身造成。
- stage `pb-test.local/kiosk-delivery-check-20261118-r1` 有reproduction.log／lint.log／validation.json；只有新增測試與handoff，產品碼／250ms門檻未改、未build／重包／部署／重啟／改設定。先前0.6.0包與配套仍現行。Windows完整管線timing／IPC/UI阻塞點待量測；GPU compile success不等於可即時。後續修正需處理即時參考傳輸與DSP完成確認耦合、取得具體耗時，不能只放寬門檻假裝解決或丟capture／假ref／自動CPUfallback。

## 2026-11-18 0.6.0 免五秒手動校正／正常獨立喇叭（整包完成、配套前端已發布）

- 使用者明確要求兩項：取消5秒錄音限制（前文澄清包含首次也免手動校正、自動持續學習），恢復麥克風與喇叭正常獨立設定；第3點空白。追加限制「只根據這兩項，其餘流程設置不要改動」。無新套件／其他功能；之前 Native calibration cancelled 是立即或幾秒內發生，非15s timeout，原硬體錯誤仍未知。**下列0.5.0強制anchor／同host雙向串流已被本節取代，不再要求現場重做五秒。**
- Worker Config automatic_rtf=True，start直接建Frontend，不讀寫target_rtf.npz；已移除native校正request／promise／UI／lease／preflight，bridge升v3、EXE0.6.0，舊EXE明確要求更新。NearFieldMvdr自動模式先用參考麥克風，短首句可直接出音；獨立VAD＋白化／優勢／連續候選品質檢查學RTF並持續更新，無anchor服務區限制，可重新學主要位置。播放／300ms尾音、混雜或弱證據凍結學習；不是顧客身份辨識。offline固定anchor對照預設仍保留，不影響其他DSP用法。每generation重新學，不保存錄音或方向。
- PortAudio只InputStream八聲道；不查預設喇叭／不開output／不要求stereo或samehost。NativeSettings僅input/map/gain；KioskMedia恢復正常browser喇叭選單與測試音，native outputDevice舊值不再用。WebAudio原本來源仍正常audible，silent Worklet鏡像應用PCM作AEC參考，不再silent sink或native DAC。捕捉延遲100ms＋40–50ms參考queue／±0.5%校時保持因果；250ms界限／xrun／primed參考underflow均終止，不能假裝browser已播的聲音是靜音。這是pre-DAC應用參考，不是硬體DAC回饋／系統或外站loopback；跨裝置AEC與實機延遲仍待驗。
- ZIP `pb-test.local/kiosk-auto-audio-20261118-r1/windows/Webnavior-Kiosk-GPU-Windows-x64-20261118-230254.zip`，314454064 bytes，SHA `65a14de695e85751b691f6c2d3bef1242ccb8ef3421f035c5241aab148171301`。3707 payload SHA／CRC、1250來源凍結／包內Python來源一致過；相較0.5.0只12 payload檔變更，PB service、連線settings、模型／200個native binaries均不變。scripts診斷取5s只是選用檢測，不是使用前校正；已改input-only。
- 配套前端 `kiosk-auto-audio-20261118-r1` UTC15:04:19（台北23:04:19）啟用590檔／95變更；建置未自動產生version.json，初次HTTP驗證因此失敗，已以stage/publishVersion.py單獨備份／原SHA與8invariants檢查後補齊0.6.0/v3 metadata，version-activation.json留證；不要重跑兩個發布script或刪guard。之後四入口index/version、公開JS/worklet共10 bytes比對全過。API PID338988保持不變，無API restart／Admin／PB站發布／強制現場reload。僅更新Kiosk配套。
- 驗證Python36過2 opt-in skip（stress／Intel GPU）；Chrome5檔26過（native3/settings8/media4/speech7/existingcapture4），真child/protocol3、Windows工具7過1skip、publisher4、Kiosk/Desktop scoped types、14檔lint、兩build／diff check過。red先重現無anchor／無output契約阻擋；自動追蹤、位置重學／播放及混雜凍結、真VAD樣本／segment、無output native實際worker、30s時鐘偏差、參考先於echo與underflow終止均過。外部PortAudio以假API測邊界，不能當Windows實機證據。未root types／commit；Windows／GPU即時／真UMA8／雙講／完整ASR仍待現場驗。
- 現場需退出舊EXE，整包解壓到新資料夾並開0.6.0；不能僅重開0.5.0。選既有native GPU方式、原生input/map/gain套用，喇叭用上方正常選單或系統預設；沒有五秒按鈕。管理面板「麥克風、語音回音與插話測試」勾「啟用管理員音訊測試」，按「播放語音並測試插話」，關面板回接待。預設處理方式與原設定未主動改。

## 2026-11-18 Native calibration cancelled 訊息遮蔽修正（網頁已發布，仍用0.5.0）

- 使用者最新回報 `native callibration cancelled`，先前「只看到一個可以選」尚未確認指哪個欄位。已用真 Vue 設定元件 red 重現：native poll 的實際錯誤先觸發 dispose，calibrated promise 被通用 cancellation 拒絕，之後 catch 把 onError 設定的原始訊息蓋掉；不能據此認定使用者手動取消或已查明硬體根因。nativeCapture 現先以實際 error settle，再清理；保留 AbortSignal.reason，start catch 同樣先 settle。
- 校正 UI 分開「正在準備 GPU 並開啟麥克風」與 capture ready 後「請在點餐位置自然說話」。ready 後15秒仍未完成，以明確逾時原因及 processedFrames/48000 秒數中止，不再蓋成取消。en／zh-Hant 與 Kiosk README 同步。未修改 Python／IPC／EXE；Windows 真正失敗原因仍待重試取得原始訊息。async 問立即／約5秒／15秒後失敗，尚無答案。
- `kiosk-native-calibration-error-20261118-r1` 於 UTC14:44:14（台北22:44:14）啟用，591檔／96變更、1250來源凍結、8 runtime/admin invariants；API PID338988不變、無API restart。四入口 index/version 與公開 JS/worklet 共10份 HTTP bytes核對過。activation／release／validation及red/green logs在stage，勿重跑 activate。沿用原0.5.0 ZIP，完整退出 EXE 再開取得新前端。
- Chrome3檔19過（settings10／native5／media4），涵蓋原錯誤保留、準備與說話階段、顯式 timeout reason；Kiosk scoped types、4檔lint、build、publisher4與diff check過。無root types／commit；未驗Windows實體／GPU即時／聲學品質，不能宣稱校正或收音已在現場通過。

## 2026-11-18 原生校正／喇叭 host 選單修正（網頁已發布，仍用0.5.0 EXE）

- 使用者先稱按5秒校正缺target_rtf.npz，後續async澄清完整錯誤其實是 `Select a stereo output using the same host API as the UMA-8 input`。目前已知現場問題為原生 input/output 配對不成立，**不能將前述缺檔當成已確診的校正失敗原因**。已明確向使用者說明兩者需同host（例如皆Windows WASAPI）。
- NativeMicrophoneSettings 原本列出所有host的喇叭，且套用未驗host。先red重現舊MME output搭WASAPI input仍被套用；現先選明確原生8ch input，speaker只列同host且>=2ch，apply／calibrate共用配對驗證與中文指引。自動input僅搭其host default output，要指定speaker需先明選input；改mic時不相容的speaker draft重設為明示default，仍須按套用才存。
- 另查證：實際calibrate:true指令原本就存在；孤立首次校正測試在無anchor時會成功，未誤修成補回不存在的旗標。正常start確會讀缺檔NPZ；已red重現該background listening路徑。nativeCapture現先status預檢，未校正回CalibrationRequiredError，由Scene顯示中文先5秒校正，而不進anchor-dependent DSP。校正用useKioskMicrophone共享runtime lease隔離普通監聽；保留enabled使用者偏好，finally／panel unmount釋放，Scene停舊generation、lease釋放後按偏好恢復。未修改Python／IPC／EXE，不必下載新ZIP。
- 使用者另問如何選管理員測試；已回答正確UI字串：「麥克風、語音回音與插話測試」→勾「啟用管理員音訊測試」→說話看辨識；「播放語音並測試插話」測TTS，關閉管理面板回接待。先完成安裝校正。
- 新前端 `kiosk-native-calibration-20261118-r1` 於UTC14:27:13（台北22:27:13）啟用；591 SHA／97變更、1250來源凍結、8 runtime/admin invariants、API PID338988不變；不重啟API／重包EXE／強制現場reload／發布Admin或PB站。Stage有activation／release／validation／publish-plan／source-hashes、兩個red及綠測試logs，勿重跑activate。
- 最新3檔Chrome17全過（native4／settings9／media4），先前未再改動capture4與speech7通過；真Python native boundary5（含無NPZ→5s真AEC校正→CPU Frontend）、Kiosk scoped types、6檔lint、publisher4與build／diff check過。無root types／commit。配套HTTP核對見stage/http-verification.json；Windows實體host可用性／GPU即時／聲學品質仍待現場，不保證每台都提供相容stereo host；若無同host輸出需取得實際native device清單，不可mono偽8ch或無參考假AEC。

## 2026-11-18 原生八聲道收音 0.5.0 候選（EXE＋配套前端已就緒；待 Windows 實測）

- 使用者已明確選擇沿用原始 sounddevice／PortAudio 原生八聲道。先前把原始原生擷取改為 renderer getUserMedia exact8，是額外相容性邊界；目前現場錯誤為 OverconstrainedError(deviceId/channelCount)。已向使用者承認未先驗證這個整合假設。使用者原先只要ZIP，後續在得知配套網頁必要性後明確要求「幫我修改正確，我要在kiosk上直接完整測試」，已授權並完成配套前端啟用。
- 0.5.0 source 改成 sounddevice0.5.6／PortAudio 48k float32 duplex(8 input,2 output)，原生 host/name 裝置身分、唯一 UMA-8 自動選取（優先 WASAPI）與同 host stereo output；拒絕少聲道／不明裝置，無 upmix 或 CPU 自動重試。Eventa audio v2；舊 EXE 明確要求更新。Renderer native 模式不再取得 browser mic，enabled 偏好由 native 監聽使用；切回既有管線恢復 browser ownership。start/calibrate 準備 DSP、open 開裝置、poll 傳 stereo render／取最終語音，世代隔離及 EOF／stop／校正完成清理。
- 應用 TTS／cue 走 Chromium silent sink，再由 PortAudio 真正播放；約40–50ms bounded buffer＋clock drift resampling，AEC 收到實際 clipped DAC output（含 underrun silence），不含系統／外站 loopback。混音 fullscale 限制作用於真播放與參考一起，解決 native 多來源1.5超界。Browser media lifecycle 通知可早於 DAC 尾音一個緩衝。捕捉／播放250ms backlog及 PortAudio status 錯誤會停止，不丟 capture 補速度。初次模型編譯180s／preload182s；失敗 owner 仍需整頁重載，未做自動復原。校正綁原生 input identity，舊 browser anchor 必須重做。
- ZIP：`pb-test.local/kiosk-native-device-20261118-r1/windows/Webnavior-Kiosk-GPU-Windows-x64-20261118-215921.zip`，314455575 bytes，SHA `281077c3015044a2a8ea94bdee3e3d4eebf80771a2cd468409cf1490a2ebc573`。3707 payload SHA／CRC、1250 source freeze、200 x64 native binaries過；sounddevice/CFFI2.1.1/pycparser3.12 官方 wheel hashes 固定，移除 wheel 中 x86／ARM／macOS binaries，保留 x64／ASIO 與 licenses。OpenVINO 第二版 denoise19aa4693及原 ONNX不變。
- 包內新增 `Test Native Eight Channel.cmd`／`probeNativeCapture.py`，用實際 Capture 邊界測5s native duplex、喇叭靜音、輸出每ch RMS／peak與 Native-Capture-Test.json，不開GPU、不存錄音／改基準；success只代表取樣成功。原 Test OpenVINO GPU.cmd 分開驗模型。可先跑ZIP內獨立原生檢測；**配套前端現已上線，完整退出舊程式並使用0.5.0 EXE即可測新管理頁流程**。完整解壓，不能直接ZIP內執行。
- 驗證：Python30過／2 opt-in skip（含 native callback5s真AEC／RTF校正後真CPU Frontend、世代stop、30s browser clock drift）；Chrome26（含真 constraint 失敗／native calibration UI／不呼叫gUM／切回browser／silent output混音）、real child/protocol3、shared store4、Windows tools7／1 skip、publisher4；Kiosk/Desktop scoped types、16檔lint、兩build及diff check過。Linux host缺PortAudio shared library，實際sounddevice載入只能回報OSError；PortAudio邊界使用假外部API，不能當Windows實機證據。Windows／Iris Xe timing／真UMA8／double talk／ASR未驗，仍無完整新GPU JSON，不能因success:true宣稱即時合格。
- 前端 stage591files／98差異、8 runtime/admin invariants與API PID338988 dry-run過。先前自動核准審核因缺少明確站台發布授權拒絕 activate；向使用者解釋後，使用者本輪要求可在Kiosk完整測試，已重新核對並獲准執行。`activation.json=activated`，UTC14:04:36（台北22:04:36），API PID338988不變；無API restart／強制現場reload／Admin或PB站台發布。四入口index+version與公開module／nativePlayback Worklet共10份HTTP bytes核對過。舊hashed assets保留，Windows現場先完成當前操作、退出舊EXE，再完整解壓0.5.0新資料夾使用。
- 「管理頁」指EXE載入的Kiosk頁面左上角設定，2秒內連點5下→輸入現場管理PIN→本機麥克風與喇叭；不是另外的完整網頁Admin後台，也不是需要重新打包EXE。選UMA-8多聲道／native GPU並套用、同host原生input/output、重新5秒校正；可開「啟用管理員語音測試」測ASR／TTS，再退出管理模式測真人接待。stage release已更新為frontend-activated-awaiting-physical-windows-capture-test；原ZIP SHA與來源不變，無須重包。實機Windows／GPU／8ch聲學驗收仍待使用者，無root types／commit／production latest更動。

## 2026-11-18 OpenVINO GPU 第二版修正（0.4.4 候選已包；目前卡八聲道取得）

- 最新使用者再次確認「一般瀏覽器沒有問題，轉8聲道就不行」。已核對原始v0.2包：`src/uma8_frontend/web.py:172-174`明確不用browser mic API，採sounddevice／PortAudio InputStream八聲道；`live.py`亦原生capture／duplex，`cli.py`在import前設SD_ENABLE_ASIO。目前EXE卻由renderer getUserMedia exact8先擷取再送Python，是新增的相容性邊界。原包`docs/LOCAL_WINDOWS.md`有舊v0.1的WASAPI48k／8ch成功紀錄，但不是目前Windows實機證據，不能據此斷言目前硬體或Chromium哪端必壞。
- 已查sounddevice官方InputStream／WASAPI設定文件；建議原生八聲道擷取先獨立驗證，再整合capture／真實播放參考的時鐘與生命週期，不能只把mono複製成8ch，也不能只換擷取而忽略renderer播放參考的時基。async已請使用者依AGENTS套件選擇規則選「沿用原檔sounddevice／PortAudio原生八聲道（建議）」或「保留瀏覽器先查八聲道」。此為先前狀態；使用者後續已選原生方案，0.5.0 source／ZIP已完成，見上節；舊0.4.x硬體收音仍經Chromium。先前所問mic名稱／Windows進階聲道格式也尚未回答。

- 使用者提供`/home/aimax/Downloads/OpenVINO-GPU-Test.json`：正確0.4.3 candidate SHA `609b6649…`，FP32／FP16皆在`ReduceFCDimensions`失敗，0 verified／0 budget passed，沒有開mic。`MatMul_22_rank3`再次接回4D `VariadicSplit` output1，證實rank-only workaround被GPU後續最佳化撤銷；0.4.3不是已修好的GPU包，不要再交付它當修復版。摘要已去除現場路徑，見r2/windows-r1-result-summary.json。
- 官方`releases/2026/4`的`reduce_fc_dimensions.cpp:27,39`遺失Output index；GPU pipeline在此之前執行`MoveFCReshapeToWeights`。原始碼在`/tmp/openvino-{reduce_fc_dimensions,transformations_pipeline,convert_matmul_to_fc}.cpp`。不能再只檢查compile_model之前沒有rank4，也不能改用錯誤output0或CPU自動fallback。
- 現在`denoise.py`移除rank-only方案，ConstantFolding先解析固定權重轉置，再將兩個末軸連續Slice＋MatMul改成完整來源tensor＋零列擴展權重：`x[...,start:stop] @ W == x @ pad_rows(W)`。原trained coefficients、輸出shape／tensor names、三組MakeStateful、ONNX SHA／OpenVINO2026.4.1／FP32／GPU.0均保留。GPU FC不再依賴該Slice被合成的多輸出Split。仍待Windows確認GPU optimizer與真執行，不能因CPU數值過就宣稱實機修好。
- 先red在0.4.3圖結構重現切片依賴；新版真compiler邊界確認兩投影讀257／129完整特徵。Python25過／2 opt-in skip，native真child/protocol3過；原始ONNX64+8段raw enhancement／postmask及reset過，另外包內候選真CPU64段fixture過，最大postmask誤差2.384e-6。無root types／commit／API restart／前端發布。
- 先交付小包`pb-test.local/kiosk-openvino-fc-fix-20261118-r2/Webnavior-OpenVINO-Slice-Fix-Test.zip`，8682 bytes，SHA `0278c815da10779c6c6099be5b44fb723160898e1e657f901cfb7b2eb36de341`；candidate SHA `19aa4693db577cafe41c174f57f986aac187299740e21cafb19973cd739e999d`。四檔CRC／source match過，7份來源凍結。關EXE、四檔解壓到完整0.4.3的EXE旁，跑`Test OpenVINO Slice Fix.cmd`，回傳`OpenVINO-Slice-Fix-Test.json`。只在獨立process載入候選，不覆蓋resources/audio/src、不改登入／設定／校正、不開mic。stage有validation／package-verification／packaged-cpu-probe／source-hashes。
- 使用者回覆小包看到`success:true`，但五秒校正仍失敗；async已明確確認當前錯誤為`OverconstrainedError（deviceId／channelCount）`，不是已確認GPU pass再失敗。新JSON／f32 timing／verified與budget尚未提供，不能只依success宣稱GPU可即時收音。小包本來不會升級舊EXE；0.4.3管理頁仍讀舊resources/audio/src。已另async詢問Kiosk選定mic名稱及Windows錄音裝置進階預設格式幾聲道，等待回覆。官方miniDSP手冊區分DSP2ch與RAW8ch；不得只依deviceId判定ID錯誤、擅自降成mono冒充陣列或改硬體韌體。
- 已準備完整0.4.4候選：`pb-test.local/kiosk-openvino-fc-fix-20261118-r3/windows/Webnavior-Kiosk-GPU-Windows-x64-20261118-213907.zip`，313816139bytes，SHA `d624f72788acace04fa7609e7134bac320305d6f031b54876d8ffcf6ff6271e4`。3647 payload SHA／CRC、30份source freeze過；與0.4.3只6檔不同（denoise、audioREADME、audio manifest、app version、quickstart、package manifest），候選denoise SHA與r2小包完全相同。main/preload/PB／三入口／模型／runtime binaries／reference不變，不需重發前端／重啟API。只把第二版GPU修正真正裝進完整EXE；**不修OverconstrainedError**。完整包可用於後續測試，尚無完整新Windows JSON及實體收音驗收，不改production latest。
- 功能source未再變動，沿用r2 Python25／native3／獨立原始ONNX+包內候選CPU數值與reset證據；未新增重複測試、root types或commit。stage有release／validation／source-hashes。後續先核對f32 GPU／parity／16ms mean+p95，再確認Windows到Chromium的真8ch路徑；五秒校正／持續收音／30s慢啟動恢復／播放混音超限均仍有未驗或未修項目。

## 2026-11-18 OpenVINO 收音相容性／流程排查（已重現兩項風險，未修／未發布）

- 使用者尚無現場錯誤／版本／GPU test JSON，要求先查相容性和流程。不可將本輪重現當成已確診 Windows 根因。Intel 官方列 Windows 11／Iris Xe／Python 3.13 為支援範圍，GPU 驅動仍為外部前提。
- 真 child 模擬慢啟動：`NativeAudio.request` 非 block 僅30s；超時殺 child 並保留 failure，後續 status／calibrate 立即失敗，同文件重新連線不會重建 owner；只有整頁導航／重開會重建。preload32s、獨立GPU probe180s，首次編譯時間預算不一致。沒有量到 Windows 真編譯耗時。
- 真 Chromium／Worklet＋實際 preload schema 重現：兩個合法0.75 playback source在 reference GainNode相加成1.5，`nativeAudioRequestSchema` 對包含render的PCM要求abs<=1.001，導致capture fail／dispose。未修改限制或繞過驗證；正式修正須處理實際播放與AEC參考的音量一致性。
- 真 OpenVINO CPU合成端到端：完成5s校正，再5s capture產生310個output hop／189個spatial speech hop／1個final segment；非實體mic／Windows GPU品質或效能驗收。另重現缺`target_rtf.npz`即start失敗、換channel map須重校，皆為既有必要前提。exact8ch取得亦先於OpenVINO；不能單憑deviceId錯誤認定ID失效。
- 既有native child/protocol3、nativeCapture Chrome2、上述兩項調查repro各1，共7 Vitest過。test-only檔已移出正式來源，重現source快照與結果在`pb-test.local/kiosk-openvino-flow-audit-20261118-r1/`；完整CPU流程另真跑過。無產品程式修改、EXE重包／部署／root typecheck／commit。
- 唯讀45筆限欄audio lifecycle（無對話／原始event內容）：近期DEV-945884（使用者未確認設備碼）最新台北19:40:34 enabled/listening=false、要求exact8ch、沒有保留此次error，不能當OpenVINO已啟動或故障原因。投影`/tmp/openvino-audio-lifecycle-private.json`為600，不提交。

## 2026-11-18 購物車簡短確認／發票選擇與掃碼焦點（0.4.2＋前端已完成）

- 使用者說 PB 已恢復正常；先前90秒診斷沒有操作，只有 Google Storage Fetch timeout，不能當 PB 空白根因或已修證據。本輪改處理購物車確認及發票／掃碼。
- 先 red 重現 Main 在「正確」後呼叫 open_cart 會重發 cart-review；現在先消費有效問題回答再執行 review，與 continue_checkout／誤選 invoice none 三路回歸通過。確認句集中 orderingMessages，僅「餐點、份數和金額正確嗎？」；仍先問真實發票方式、資料完成後獨立最終送單同意。既有未知寫入／送單復原保護未放寬，不能宣稱已確診每次現場 recovery。
- 先 red Chrome 重現從 contact 切換發票時焦點保留原欄位；pbInvoiceInput 保留所選 radio 至 Vue 真正渲染該欄位，僅一次轉移焦點，其他 mutation 不搶回；reset／leave／dispose 撤銷待聚焦，dispose 後 microtask 不復活。
- 真 Electron red：載具 DOM activeElement 正確，但 Host isFocused=true／native=false。Surface 現僅成功 invoice_select／checkout_prepare、有可編輯 PB input、同文件仍 approved、view 可見且 Kiosk window focused 時交接 native keyboard；普通 cart_get 不搶。最終實體 Electron（CDP focus emulation 關閉）兩種載具及 Enter 正規化過，fixture 0 submission／0 order；非 Windows HID 實機驗收。
- 前端 pb-checkout-focus-20261118-r1 台北18:41:41已啟用，589檔／96變更；另 sibling metadata stage 補 version.json，1檔變更。舊hashed assets保留、無強reload；API PID338988不變，8份runtime／admin invariants核對。四入口與真正 module HTTP9份比對通過。勿重跑兩份 activation；紀錄見 stage release／HTTP／metadata activation。
- 完整0.4.2 ZIP：pb-test.local/pb-checkout-focus-20261118-r1/windows/Webnavior-Kiosk-GPU-Windows-x64-20261118-183923.zip，313814201 bytes，SHA fc844df23b36b9861bb6d0caa8c78860c63b3ef4f496334866fcf501ae15f25e。3647 payload hash＋CRC過，與0.4.1僅 main／PB service／package version／quickstart 4檔不同；音訊／模型／preload／三入口設定相同。配套前端已發布，現場完成訂單後退出舊EXE、解壓新包測實體掃碼；勿宣稱0.4.1只重開即可取得native修正。
- 驗證376 unit、Chrome22（最終invoice8為子集）、Desktop38／1 opt-in skip、publisher4、Kiosk/UI/Desktop scoped types、6檔lint、兩build過。Stage verifyFocus.mjs 為隔離profile＋loopback PB lab 測試，不使用現場儲存／商家。無root typecheck／commit。

## 2026-11-18 PB 開始點餐後空白／載入失敗（仍待 Windows 錯誤碼）

- 使用者回報0.4.1現場172入口，澄清PB區域變空白或載入失敗，不是菜單可見但Agent讀不到。不能將本次症狀逕歸因於三入口變更或下面另一個彈窗問題。
- 唯讀固定診斷欄位：最近僅DEV-945884活躍（使用者未明確確認設備碼）；台北17:16:48、17:23:23有Start called未保留completed，後續17:35普通cart讀取resolved。這不證明Start未成功，換頁會清理diagnostic owner。未讀對話／訂單資料。已核對該session正式發布URL為app.esgpb.com/1kgJeql/internal_use/menu/select-table。browser_cart_preparation來源近2h無紀錄，不能當沒有失敗。
- 全新agent-browser及兩輪隔離真Electron／正式native payload都能選櫃台→Start→菜單，無did-fail-load／renderer crash、無加餐／送單／付款。另重現forAdmission讀取會因優惠「稍後再領／立即領取」窗蓋住營業公告而拒絕，錯誤「關閉營業公告被其他畫面遮住」；plain cart_get後續成功、13cards。此為另一已重現缺陷，**本輪未修／部署**，不能當已解使用者空白頁。
- Stage `pb-test.local/pb-entry-failure-20261118-r1` 有投影查詢、merchant-entry.json（600、QR遮蔽）、兩個重現腳本與investigation.json。CLI舊版不支援skills get，已依本機help使用agent-browser。相關runtime網頁根本載入錯誤碼現有事件只保留failed，需原Windows擷取。
- 已提供小包 `PB-Connection-Diagnostics.zip`，僅diagnosePb.cjs／Collect PB diagnostics.cmd／說明，不含EXE或設定。放EXE旁、diagnosticPort改9222重開，執行CMD後90秒內重現，再提供PB-Diagnostics.json，收集後改回0。工具用既有Electron_RUN_AS_NODE的內建WebSocket，只讀CDP網路／導航／crash事件，無Cookie／body／欄位／對話影音，QR／orderID／query遮蔽。真Electron Node＋CDP本機HTTP500及網路失敗回歸通過，識別碼均未入報告。Windows CMD實機仍待執行。
- 本輪沒有產品程式修改、EXE重包、前端/API部署、設備設定或登入更動。下一步先看現場JSON錯誤碼，勿猜DNS／TLS／GPU或重試商家寫入；若之後處理彈窗，僅可用原生「稍後再領」，不點領取或持久化不再顯示。

## 2026-11-18 OverconstrainedError(deviceId) 唯讀追查（8ch 條件已重現，Windows 原因未定）

- 使用者說 EXE 麥克風皆報 deviceId、Firefox 其他網頁可用，要求先自行確認。隔離既有0.4.1 Linux packaged Electron（相同main／權限政策、172入口攔截fixture、獨立/tmp profile、合成media）真 getUserMedia 比較：system standard成功、指定有效實體ID standard成功；同一有效ID加 exact8ch即 OverconstrainedError/constraint=deviceId；不存在ID也是deviceId；不指定ID要求8ch則channelCount。合成裝置caps1–2ch。證據 `pb-test.local/kiosk-deviceid-check-20261118-r1/electron-constraints.json`。不能把此Linux合成重現當已量到Windows UMA8能力；只證實deviceId文字不能單獨判定ID失效。
- 程式依useKioskMicrophone.inputMode=uma8（或auto辨識UMA8標籤）在Scene設定exact8ch／48k ideal／關AEC/NS/AGC；指定deviceId為exact，這是取得音軌前的限制，尚未進OpenVINO／RTF／VAD。manual uma8模式套用所有被選取麥克風，因此若換其他mono仍留此模式，也會全部失敗。現場目前是否已試「一般＋系統預設」未回覆，入口／版本亦未確認，勿斷言8ch就是唯一根因。Firefox普通收音成功不等同Chromium能提供8ch RAW。
- 唯讀DEV-757106僅固定欄位投影：最後audio_runtime是UTC07:07:12（台北15:07），browser-vad／listening true／permission granted，沒有這次失敗。原始e.content查詢被auto-review拒絕，已安全改為SQL內只取error name／constraint／enabled／listening／processing／permission／channelCount，不取訊息或顧客文字，通過後30筆投影保存在 `/tmp/kiosk-deviceid-runtime-private.json` 600。腳本stage/readRuntime.py；原先另一個查詢呼叫審核逾時，未執行、沒有資料修改。
- 本輪無產品原始碼修改、EXE重包、前端發布、設定寫入或API重啟；測試Electron已關閉。後續需Windows實際channelCount capabilities／一般vsRAW取得結果或新的失敗診斷，才可判定驅動／裝置ID／模式何者所致。不要只因Firefox成功就放寬8ch或將mono當陣列。

## 2026-11-18 0.4.1 三入口 EXE（成品完成，API 已啟用）

- 使用者要求基於最新 0.4.0 調整：新增現場 `172.17.69.17:5169`，保留 Tailscale `100.92.1.80:5169` 與公開 HTTPS。新版0.4.1的 `connections`（label/url）與預選 `kioskUrl` 均可由EXE旁JSON修改；預設現場入口。新格式要求 connections，不直接搬舊JSON。HTTP來源於ready前同步讀檔後精確授權；商家網站不繼承。不同origin仍須各自配對、點餐不自動切線。
- Server新增 `KIOSK_TRUSTED_ORIGINS`，預設上述兩HTTP origin；串接Kiosk CORS、PIN／POS與設備／PIN Cookie政策，公開HTTPS仍Secure。換IP需改EXE與Server清單、重啟API。完整網頁管理捷徑仍公開HTTPS，未宣稱一般HTTP管理登入／瀏覽器影音已支援。
- 新包：`pb-test.local/kiosk-connections-20261118-r1/windows/Webnavior-Kiosk-GPU-Windows-x64-20261118-155552.zip`；SHA `2fb0f66e25b54748433569445837727d098481980f37018949db997d68d0f69c`，313813554 bytes、3647 payload hash及ZIP CRC通過。與0.4.0僅6檔不同（main、version、2設定、說明、後台捷徑）；OpenVINO／模型／reference／preload／PB程式皆不變。Windows／Iris Xe實機驗收狀態沿用0.4.0待驗，不冒稱GPU已合格。未改 latest production。
- 先red重現新來源PIN 403與settings拒絕；Desktop38過／1 opt-in skip，Server4檔187過、最新origin/env27過，兩套件types、14檔lint、Desktop build／diff check通過。Linux真packaged Electron三入口及修改IP共4輪、合成影音／secureContext／AudioWorklet／bridge通過；未授權origin仍不安全。此為自動化Linux fixture（Playwright預設launch flags），非Windows實體硬體或sandbox獨立驗收。
- Stage `pb-test.local/kiosk-connections-20261118-r1` 含ZIP、verification、logs、5檔runtime overlay、deployment-plan及activate.py；已核對patch可套用現有runtime，dry-run成功。API仍PID4435，**尚未寫入／重啟／發布前端／改server.env**。sudo -n要求密碼，不是自動approval review拒絕。使用者需在無未決訂單時執行 `sudo python3 /home/aimax/webnavior/pb-test.local/kiosk-connections-20261118-r1/activate.py --activate`。其備份、鎖、PID／來源／設定hash檢查、ready與無憑證POS401／錯來源403驗證及失敗回復已備妥。
- 後續先看activation.json；若尚未啟用，不得宣稱172入口PIN／POS可用。172入口首頁及ready曾從伺服器本機200，其他機器路由／防火牆仍待現場確認。無root typecheck／commit。

- **啟用完成**：使用者台北16:23執行sudo；activation.json=activated、previous4435→PID338988。已核對5檔部署SHA及兩前端invariants；loopback／172／Tailscale的readyz與Kiosk皆200；公開curl兩者200、DB/Redis ready。Python UA在Cloudflare回1010，不能誤判API壞掉。三來源無憑證POS401、非信任172.17.69.18為403是預期。不要重跑activate.py；其他機器／Windows實體驗收仍待使用者。

## 2026-11-18 使用者指定 OpenVINO（0.4.0 候選已包，待 Windows Iris Xe 驗證）

- 使用者明確更正「我是要用 OpenVINO」。已將 Electron 原生降噪從 ORT/DirectML 換成直接 OpenVINO 2026.4.1，固定 GPU.0／LATENCY／單 stream／FP32；保留原 ONNX SHA c01acec2…、AEC3／online RTF/MVDR／AGC／VAD／ASR queue。MakeStateful 將三組 cache input/output 交給 InferRequest，逐段同步執行、capture reset 清三組 state。無 DirectML runtime／AUTO／HETERO／自動 CPU retry；CPU 僅開發者明確測試。啟動真 infer＋EXECUTION_DEVICES 僅 GPU.0＋executed profiling 才報 gpu_verified，operation count 不可直接和舊 ORT node count 比較。
- 完整可攜包：`pb-test.local/kiosk-openvino-20261118-r1/windows/Webnavior-Kiosk-GPU-Windows-x64-20261118-144058.zip`，313812335 bytes，SHA `5f5d68cf4adcfc77499874733d9f0ddf1f305fcd9c6d4d0b9254a2abb571a21d`，版本0.4.0。官方 Windows cp313 wheel／Python／VC／Electron SHA、197 x64 native binaries、3647 payload SHA／source／ZIP CRC皆過；模型不變、登入／校正不入包。不是已驗收的實機版本，勿改 latest production 或自動切選單。正式候選用 f32，f16 僅診斷比較，尚未有這台 Windows 的 OpenVINO 速度。
- 下一步：Windows 關 EXE，解壓到新資料夾，先雙擊 `Test OpenVINO GPU.cmd`，回傳 `OpenVINO-GPU-Test.json`；不先拿來全天候收音。兩種精度各獨立 child／180s timeout，64段獨立 ORT CPU raw enhancement＋postmask fixture 比較，再1024段變化音訊測速；GPU＋數值＋mean/p95<16ms 才可進實體capture，完整AEC／RTF負載／RAW8ch／回音仍另驗。工具不開mic／不改profile／不自動套用f16。根目錄含 diagnoseAudio.py／reference／CMD，可直接跑，不再使用舊DML六case小包。
- Python24過、2 opt-in skip（長stress／實體Intel GPU）；與未修改ONNX ORT reference 64+8段及reset一致，另fixture64段raw/postmask真CPU過（AMD開發機，不能當Iris Xe證據）。fake compile故障無CPU重試、實際CPU compiled冒充GPU先red後拒絕。Desktop真child／protocol3、Chrome設定／Worklet8、Windows工具8、publisher4過；Desktop／Kiosk scoped types、lint、兩端build／diff check過；未root types／commit。stage source1244凍結、release／validation／package-verification留證據。
- 配套前端 `kiosk-openvino-20261118-r1` UTC06:42:53（台北14:42:53）已啟用，590SHA／97差異；只補實際runtime／GPU名稱、改中性GPU標籤與diagnostic key，原招呼r2及一般／既有收音流程保留。本機選項未改、未強reload／Admin／PB publish。API先前於台北12:43:21由外部重啟，已唯讀核對ready／原3檔invariants並固定當前PID4435；本輪沒有重啟。publication-boundary-check記錄，勿沿用舊PID2308012。activation已存在，不可重跑 --activate／刪guard。
- 先前招呼r2現場是否完整播完仍未回覆；若續查請讓機器取得目前新前端再看 greeting_delivery，別把引擎顯示發布誤當已修GPU速度或已驗實機招呼。一般麥克風已由使用者確認可用，仍作目前日常選項。

## 2026-11-18 招呼 presence-expired 誤取消（r2 已發布，待現場驗收）

- 使用者回覆 r1 招呼仍抖一下就停。新版11:48:41.948（台北）terminal為 cancelled／presence-expired、presenceState=ENGAGED、interruption=idle，當時一般mic live/unmuted/listening且permission granted。因此確認該次為存在分支取消，不是已證實本地VAD打斷或mic斷線；未取得現場逐幀landmarks，勿把下述重現說成已量到該人的髖部／臉座標。私密時序 `/tmp/kiosk-greeting-r1-terminal-private.json` 600；同接待後續正常回覆有完整speech completed，另一次較早一般回覆TTS failed不是本輪已解根因。
- 真Chrome＋可控外部MediaPipe結果重現：近距離無髖部時Pose五anchor score<.5；原 Face forehead→Pose torso centre 距離比對失敗，清楚同人臉不能補足presence。改用既有 nose→nose association，要求一張唯一匹配且Pose座標在1.5s內；matchedFace可提升存在可信度，保留Pose位置／scale。不相關／多張模糊匹配／stalePose皆不提升；Falcon原嘴部crop條件保留，freshness只用在新presence提升。
- VoicePresence保留兩個時間：lastSeen（>=.5）控制原新語音／新招呼資格，lastLocated（in-zone有限弱geometry亦可）僅保留已成立proactive turn。shouldCancelProactive使用原1.5s grace、要求曾有可信presence；missing／out-of-zone不刷新lastLocated，弱影格後單次missing不立即切音，frozen／stopped camera／reset仍撤銷。Scene另以allowsObservedVoice(false)保留operator／service／reception限制，沒有放寬顧客活動／結帳取消，r1的3次／20s retry未增加。greeting_delivery另記匿名presenceCandidate，僅voice diagnostics開啟時。
- **kiosk-audio-greeting-20261118-r2** 於UTC04:00:50（台北12:00:50）已啟用；stage同名，1239來源凍結前後一致、590SHA／97差異、7HTTP通過。API PID2308012未變，不重包EXE／restart／Admin／PB publish／強reload／改設定。使用者需訂單結束完整退出重開、確認r2，再測招呼；async問題已提出，回覆待接續。一般mic可用狀態沿用。
- 先red近身face不能續presence；另red弱frame後single miss即cancel。最終25 unit（voicePresence/fixedGreetings/turn）、Chrome10（vision3＋真播音7）、publisher4，Kiosk scoped types、5檔lint、build／diff check過；未root types／commit。stage validation／activation／HTTP／READY留證據。實機招呼未確認成功；若仍中斷先看r2 greeting_delivery reason／presenceCandidate／interruption／attemptId，別再只加retry或逕改ASR／RTF。

## 2026-11-18 DEV-757106 無音軌／招呼短暫播放中斷（r1 已發布，現場仍中斷後接續r2）

- 使用者回報收不到音、招呼有時抖一下就停。唯讀查該設備：11:16–11:24（台北）多次 enabled=true 後迅速 false、tracks=[]、VAD未載入，舊錯誤欄位空白；不是已證實 ASR／RTF 處理後丟音。使用者先說一般模式也失敗，隨後**更正一般麥克風可以收音**；後查11:41:00 audio_runtime確為browser-vad、enabled/listening=true、live且unmuted音軌，後續亦有recognition timing。先保留其一般模式；未直接寫設備／本機設定。UMA-8 8ch 取得失敗的現場 constraint 仍待新版錯誤文字，勿宣稱硬體已修好或全域麥克風權限故障。
- Shared settings audio store 新增 inputError（name/message/constraint），Chromium 空 message 仍保留名稱／限制，停止不清除、重試／reset清除；權限 denied/prompt 亦保留原因。管理頁顯示並提供明確「改用一般麥克風並重新連線」；不偷偷把少聲道當陣列。活 input 不再額外開 speaker enumeration 的 mic probe。audio_runtime 記 inputFailure／constraints／permission，不含 PCM。
- 招呼實際播放 completed 才算送達；取消／failed／blocked 分開。fixedGreetings 新增 reception delivery budget：同接待20s內最多3次、間隔至少1.5s，顧客活動／reset永久關閉該次 budget，舊 attempt 不影響新 attempt。每次再查 presence／browser phase；speech candidate／ASR／queue／Agent 顧客工作優先；不清 cart／不建替代接待。固定歡迎音訊 wait 可隨 turn 取消，單次10s timeout，cache synthesis仍可重用。voice diagnostics 開啟時 greeting_delivery 存 attempt/reception/result/reason/interruption；只記原 visitor。
- 相機所有 reactive 啟動也等 mic preparation gate；相機重啟依實際 camera/model/capture settings，無關 device settings 不重啟，proactive settings／greeting phrases 依內容判定，減少錯切招呼。未證實現場每次抖動的單一根因，需看新版 terminal reason；未放寬 presence 或取消顧客／結帳保護。
- 前端 **kiosk-audio-greeting-20261118-r1** UTC03:44:23（台北11:44:23）已啟用；stage同名。1239來源凍結、590成品SHA、97變更、7HTTP（loopback/LAN/public entry+version及public JS）過。CF僅已知analytics+newline注入。API PID2308012未變；不重包EXE／重啟API／發布Admin或PB／強reload。使用者回覆仍抖停，已依新terminal接續上節r2，勿將本節當實機修好。
- 先red重現空 constraint message UI消失；Chrome真假的 media input 拒絕及一般模式重連過。Kiosk6檔114 unit＋新增greeting diagnostic lane case1、shared store4、Chrome5檔21、publisher4過；Kiosk／Stage UI scoped types、13檔lint＋最終Scene lint、Vite、diff check過，未root types／commit。隔離真Electron46＋合成mic/camera，現有permission policy保持granted／owned track live，不能當Windows或RAW驗收。stage validation／activation／HTTP有證據；查詢原始資料 `/tmp/kiosk-757106-audio-private.json` 600不提交。

## 2026-11-18 UMA-8 既有收音備用選項（已發布）

- 使用者要求 GPU 不足時保留舊方式。新增本機 `kiosk/audio/array-backend`：預設 `existing`，另選 `native-gpu` 需按套用；Desktop 管理頁「本機麥克風與喇叭 → UMA-8 收音處理 → UMA-8 處理管線」。既有 legacy ASR 可選 LCMV／Spatial Mask，Falcon 維持原 AEC／LCMV＋獨立輸入增益；各管線設定保留。既有模式不掛載 GPU 設定頁、不呼叫 native status。
- Scene 的 nativeArrayMicrophone 另需 nativeSelected；切換同步停止舊 generation、abort 未完成辨識，若正在講話則丟至下一個靜音邊界。非 GPU inference 自動 CPU fallback；GPU 啟動失敗仍可由 selector 切回。GPU 的 30.5ms／16ms hop 實機結果仍未符合連續收音要求，未推進安裝候選 EXE。
- 前端 `kiosk-audio-backup-20261118-r1` 於 UTC03:11:55 啟用，stage `pb-test.local/kiosk-audio-backup-20261118-r1`。1239 來源凍結、590 成品 SHA、97 差異；API PID2308012 未變，舊 assets 保留；未發布 Admin／PB、未重包 EXE／改設備設定／強 reload。已裝 0.3.0／0.3.1 可沿用；等訂單結束完整退出重開取得新頁。勿重跑該 stage 的 --activate 或刪 activation.json。
- 先 red 重現 Desktop 無 selector；最後 Chrome 11 項（GPU 失敗切回／設定保留／重開、LCMV／Mask／native 真 Worklet 清理）、Kiosk scoped types、6 檔 lint、Vite build、4 項發布隔離測試通過。7 個 HTTP 檢查覆蓋 loopback／LAN／公開 entry+version 與公開主 JS；Cloudflare 僅額外注入 analytics script/newline，精確移除該注入後 entry bytes 相同。證據在 stage validation／http-verification.json／activation.json。未 root types／commit；Windows 實體麥克風切換仍待現場驗收。後續效能六 case 小包不受影響。

## 2026-11-18 主動招呼間歇未完成（唯讀調查，未修改產品／部署）

- 使用者確認人站到機器前未自動招呼，尚未提供設備碼。最新活躍DEV-757106台北09:56–10:12共7筆`proactive_greeting`，僅09:56:46有`fixed_greeting`文字；09:59:20、10:02:23／36、10:09:46、10:11:59、10:12:27無固定招呼文字。文字存在不等於Windows播音；此比例不是相機召回率，設備亦未由使用者確認。
- 相鄰`browser_cart_get`有resolved紀錄，但metrics不含回傳page／phase，不能當招呼資格通過。同時段UTC01:55–02:14 API共35次speech response均200，僅服務整體可用證據，未逐筆關聯設備／招呼，不能保證本機播音。
- 程式先`customerSession.begin()`改active，再記觸發與準備招呼；`sendAssistantAction`重讀phase及presence／turn資格，取消／失敗只complete turn，無未送達retry；後續招呼仍限standby。因此撤銷可留下active但未招呼的接待，尚未證明現場各次的確切return／取消分支。Presence gate寬限1500ms，不是mouth／target的250ms；勿沿用ASR分析斷言單幀漏偵測即取消。另delivered只看turn.signal，未採speechPlayer的failed結果；blocksPlayback直接return亦可能被視為delivered。
- 線上`kiosk-gpu-20261118-r1`manifest的Scene、fixedGreetings、voicePresence、kioskSpeech、customer-session五檔均與本機一致；聚焦四檔26項測試過，未新增repro／root types。下一步先補招呼terminal stage/reason與真實playback outcome，再設計同接待且無顧客操作的有限retry，保留checkout／顧客操作優先，勿直接放寬相機或重設訂單。
- 私密原始資料僅`/tmp/kiosk-greeting-analysis{,-detail}-private.json`（600），不提交；未改設備／服務／部署。

## 2026-11-18 Kiosk GPU 效能調校（非融合實機GPU成功／速度未過）

- 使用者已回傳0.3.2非融合試跑：candidate SHA4b05324…吻合、原模型SHA吻合；Iris Xe真GPU709 nodes／CPU0，mean30.47099ms、p95 31.0971ms、max31.3187ms，超過16ms hop且未含AEC／RTF。**啟動已解、速度未解，勿安裝0.3.2作連續收音／勿聲稱完成**。r3/windows-model-result.json記原數據，release及 `/tmp/latest-windows-gpu-candidate.json`改rejected-for-realtime-throughput，標準latest仍0.3.1。未發布／安裝／切設定。
- 已交付下一步一次六種GPU設定小包：`pb-test.local/kiosk-gpu-tuning-20261118-r1/Webnavior-Kiosk-GPU-Performance-Test.zip`，103243bytes，SHA `bc25b8d73b03d6191cd3d6baa16431f7fc4f2a39eb8388894d11921b5e618c46`。關EXE、五檔解壓至原EXE旁，跑 `Test GPU Performance.cmd`，回貼 `GPU-Performance-Test.json`。各case獨立child／60s timeout，原始錯誤與native log在同目錄gpu-tuning-*；不覆蓋已安裝程式／manifest／登入／校正、不開mic、不CPU retry／自動套用。
- 六種：nonfused-host、nonfused-device、fused-portable、fused-portable-device、fused-basic-device、fused-basic-portable-device；調整DML fusion／metacommands／ORT basic及GPU resident caches。UlUnas新增明確qualification kwargs，既有worker預設未改。IObinding雙套互不alias的cache交替、固定device mix每hop update_inplace、CPU enh讀前synchronize；reset清兩套。ORT IOBinding::BindInput可在bind時copyCPU輸入，所以不能只改已綁CPU ndarray；已依原始碼避免stale GPU input。
- 新增真CPU bound/host 48幀等價＋reset回歸、native初始化options回歸先red後green；Python25過1opt-in skip、Desktop32真child過、diagnostic/archive8過。包內24幀harmonic合成CPU參考與原模型SHA綁定（2447/6168 bins高於floor+.02，避免純雜訊floor遮住差異），各case先比postmask頻譜rtol2e-3/atol1e-4再測64幀模型時間。這不是語音品質驗證。6case打包後CPU數值過且不推薦CPU為GPU，6case缺DML拒絕過；Win/DML buffer與新效能均待實機，未root types／stress／重包EXE／commit。manifest／source-hashes／validation有證據。
- 下一步看Windows六case結果，僅GPU真通過、數值一致且mean及p95皆<16ms者可建議實體capture trial；這仍沒含AEC／RTF負載，需有餘裕並另驗full pipeline。沒有case通過時，繼續評估GPU執行策略／模型或不同Intel GPU runtime，勿偷偷轉CPU／丟幀／放寬時間預算。

## 2026-11-18 Kiosk GPU 0.3.2 非融合候選（GPU已試跑／效能未過）

- 使用者已回傳原始bytes：`DmlGraphFusionHelper.cpp(588)`／`0x80070057 參數錯誤`，發生於ORT `initialize_session`，UTF8問題是CP950 native exception文字轉換的遮蔽。尚未知道特定op／driver原因。截圖確認Iris Xe、driver32.0.101.7088、DirectX12 FL12.1；Task Manager 0%不代表模型可用或不支援。
- 依ORT v1.24.4 `core/providers/dml/dml_session_options_config_keys.h`，候選在DirectML SessionOptions設 `ep.dml.disable_graph_fusion=1`，避開融合路徑，仍GPU個別kernels／真warmup placement／禁止自動CPU retry，未改模型或RTF。Windows是否能初始化及是否夠快仍待實測，不可把Linux測試當修好。
- **先交付小包** `pb-test.local/kiosk-gpu-20261118-r3/Webnavior-Kiosk-GPU-Fusion-Test.zip`（6403bytes；SHA `f33f4af5c5ec4b4d803e50c26642285d679d2e79e478570905def84f832a0855`）。關EXE、四檔解壓至目前0.3.1 EXE旁，跑 `Test GPU Fusion Fix.cmd`，回傳 `GPU-Fusion-Test.json`，看success／diagnostics.gpu_verified／timing／error。腳本`--candidate-denoiser`只在自己的process載入相同候選denoise.py，不覆蓋已安裝source／manifest／登入／校正，不開mic。64幀timing對16ms hop只計模型，非完整pipeline效能。候選SHA `4b05324ed743e0a8b884536879fd9a5e60aa339b43ac6e12feae6a25c70c530a`。
- 完整候選0.3.2同時備妥：r3/windows/`Webnavior-Kiosk-GPU-Windows-x64-20261118-104544.zip`，260696223bytes／4730檔，SHA `f8c89edf65aa55681f1267f54e589786290bd17ea793d1218b08042b25dc33ae`。173PE／CRC／全payloadSHA／33凍結檔前後通過，與0.3.1只5檔不同（denoise、audioREADME、version、兩manifest），main/preload/PB未變，full與小包候選逐byte同源。標準latest仍0.3.1，另 `/tmp/latest-windows-gpu-candidate.json`記候選；未部署／force reload／API restart／前端發布。不需跑publish.py。
- focused設定測試先red；Python23過1opt-in skip、Desktop32真CPU child過、diagnostic/archive8過。封包後candidate真CPU ONNX及缺DirectML拒絕檢查過，不是實機GPU證據。未重跑stress／root types／commit。r3/{release,qualification,verification,source-hashes}.json／validation／READY完整證據。下一步等待Windows試跑；若GPU真過且模型耗時有餘裕，再裝完整0.3.2測校正／實體capture／連續點餐。

## 2026-11-18 Kiosk GPU 0.3.1 封包修正（已重包／Windows 待更換驗收）

- **最新現場已取得stack、根因仍待原bytes**：按「重新偵測並建立連線」出現UTF8 byte0xb0/position285；使用者回報Windows11 build26100／CPython3.13.17／ORT1.24.4／cp950，Dml與CPU provider可列舉。stack確認`denoise.py:39 → ort.InferenceSession → sess.initialize_session`先UnicodeDecodeError；非profile.read_text／mic。r1診斷TempDirectory清理又WinError32鎖profiling JSON，覆蓋頂層error，造成未保存原UnicodeDecodeError.object；列出provider不代表GPU kernel通過，不能斷言驅動或模型特定op。
- 新診斷r2：`pb-test.local/kiosk-gpu-diagnostics-20261118-r2/Webnavior-Kiosk-GPU-Diagnostic-r2.zip`（3248bytes，SHA `07d95c2c44eb4c9bc952d3bed85df417c9251a1a5ac1d266b4f7ecc387cbebfb`）。同EXE資料夾覆蓋舊診斷檔、關EXE再跑CMD，回貼JSON的`error.decodeFailure.windowsAnsiText`，缺欄位看error／traceback。初始化先catch存原bytes，再釋放model／cleanup；cleanupError獨立，describe_error遍歷chainedErrors。先red3錯誤，5項測試全過，含真CPU成功／缺DirectML失敗兩種結果在鎖檔fault下不變；ZIP CRC/source match。未改production／重包EXE／部署，Windows新診斷仍待執行。**不要再交付舊r1診斷包**。
- 已交付 `pb-test.local/kiosk-gpu-diagnostics-20261118-r1/Webnavior-Kiosk-GPU-Diagnostic.zip`（2822bytes；SHA `495938c2146467fc91a0c432bccf3f4089cb91a84083c2a359f30c16e53c4ba0`）。關EXE，解壓到EXE同目錄，雙擊 `Diagnose GPU Audio.cmd`；回貼 `GPU-Audio-Diagnostic.json` 的error／traceback，若無JSON看GPU-Audio-Native.log。腳本`scripts/windows/diagnoseAudio.py`用包內模型／DirectML，保留UnicodeDecodeError原bytes hex及Windows mbcs文字，明確UTF8寫報告；不改model/profile JSON、不繞過GPU驗證、不開mic／改登入／校正。3unit過（重現同byte／position及cp950文字），真CPU ONNX probe過、無DirectML時失敗並完整報告、ZIP CRC/source match過；這些不代表Windows GPU成功。README已補用法；未發布／commit。
- 使用者現場回報「尚未取得麥克風串流」，按重新連接後為 `Invalid native audio envelope size`。尚未取得現場原始provider錯誤，不可直接斷言驅動或麥克風故障。三項測試先red：真child在ORT import時注入Python／fd1診斷可重現封包毀損、ORT真constructor會先retry CPU（事後disable太晚）、初始化失敗無correlated response。
- entry.py在任何模型／native import前保留binary response pipe，Python／CRT stdout轉stderr，Windows另SetStdHandle；worker延後至首個request初始化，失敗回原始錯誤並終止；ORT constructor enable_fallback=0。無跳過壞封包／自動CPU。Python22過1 opt-in skip、Desktop32真CPU child過、archive3過；未重跑stress／root types，Win32 handle分支與Iris Xe實機未驗收。
- 新包0.3.1在 `pb-test.local/kiosk-gpu-20261118-r2/windows/Webnavior-Kiosk-GPU-Windows-x64-20261118-101205.zip`，260695658 bytes／4730檔，SHA256 `2787f2696e0882c26ed7dc3ec4156fd0bb6bc30f305aecfccd1c5f391cad7cbc`。173 PE／CRC／全檔SHA通過，31份來源封存前後一致；與r1僅7檔不同（三Python、audioREADME、兩manifest、app package version）。main/preload/PB bytes及Desktop/IPC source均與r1一致，未重建或混入其他chat修改。
- `/tmp/latest-windows-portable.json`已指0.3.1，desktop deployed=false，Kiosk仍已發布r1。**這次不需前端發布／API restart，也不要再跑r1 publish.py --activate**。請現場完整退出EXE、整包解壓新版、同Windows帳號開啟，保留LOCALAPPDATA profile／校正。若仍失敗，取新版較具體原始錯誤；不可把Linux回歸當Windows GPU成功。證據r2/{release,verification,source-hashes}.json、validation及READY.md；未commit。

## 2026-11-18 Kiosk GPU 音訊 0.3.0（Kiosk 前端已發布／Windows 待驗收）

- **使用者已明確確認 Windows 更換0.3.0 EXE；已發布配套Kiosk前端**。沿stage/publish.py --activate，590檔SHA／97份變更成功、保留backup／舊hashed assets、index最後切換；API PID2308012保持不變，沒有API restart／force reload／DB或商家改動。僅 `/var/www/airi/kiosk`，Admin Web與公開PB未發布。stage/activation.json與post-activation-verification.json為準；`/tmp/latest-windows-portable.json`標記Kiosk已發布、PB未發布，physical仍false。
- 發布後LAN/public版本、public entry、真正module、新GPU設定chunk、capture Worklet共6項通過。HTML初始檢查誤把CF beacon type=module視為第二個app module；逐字diff只多既有CF script及newline，最終扣除該次觀察到的完整精確block後其餘byte一致；JS/version/Worklet均raw byte一致。證據stage/http與verification-note；沒有放寬產品來源政策。發布工具4個隔離FS check-only／成功／回復／變動拒絕測試過；未root types／commit。
- 目前請現場訂單完成後完整退出／重開新版EXE，進管理模式→本機麥克風與喇叭→UMA-8收音處理→選UMA-8多聲道；應見「本機GPU音訊處理」。開頁自動初始化、確認「GPU模型節點執行已確認」、核對聲道與gain後套用，再「建立5秒安裝位置基準」。Iris Xe真實GPU／聲道／回音／真人連續點餐仍待使用者實機驗收，不能用此HTTP發布成功當GPU通過。暫不進行普通瀏覽器WebGPU移植。
- 使用者確認 Intel Iris Xe，要求內建 Electron 並開始 GPU 打包。本輪已實作新管線，不再只是下節獨立 Python ZIP：`apps/stage-kiosk-desktop/audio` 擁有 AEC3→共同增益→online RTF/MVDR→UL-UNAS/DirectML→AGC→空間/WebRTC 分段；`apps/stage-kiosk/src/audio/nativeCapture.ts` 供48k八聲道＋真實雙聲道播放參考，最後mono片段走既有ASR queue。Desktop UMA不再走舊LCMV/Mask/Falcon分流／第二次Silero；普通browser及mono保留原路徑。
- Eventa中立契約 `packages/stage-shared/src/kioskNativeAudio.ts`；main僅授權可信Host main frame，`NativeAudio` supervises binary pipes並限制pending32。capture UUID隔離；重載／關閉殺子程序、丟棄未完成語句。真child回歸先red發現stale block可清掉新generation，已改只清除同owner失敗block，green。沒有額外HTTP服務或機台pip/system Python安裝。GPU僅UL-UNAS；RTF/MVDR/AEC/VAD為CPU，ASR/TTS/LLM仍Server。正式包指定DirectML，無自動CPU inference fallback；啟動真warmup+ORT profiling見GPU kernel才報gpu_verified。
- 麥克風設定新增native聲道、gain與五秒安裝校正。正常點餐位置單人持續說話、喇叭須靜音；userData/audio/target_rtf.npz為固定anchor。持續追蹤仍有服務區限制，不是身分辨認。搬陣列或改聲道重校。校正不持久化錄音。新EXE必須配套新前端；舊EXE讀新UMA前端會提示更新，不能先全域切前端後才換EXE。
- 正式建置來源凍結1239檔前後一致；stage `pb-test.local/kiosk-gpu-20261118-r1` 含Kiosk590檔、公開PB14檔、Desktop與目前另一chat數量事件／modal／發票修正同版編譯、source-hashes/release/READY及驗證logs。Windows ZIP `windows/Webnavior-Kiosk-GPU-Windows-x64-20261118-023855.zip`，260694604 bytes，SHA256 `058de22907b702d38f959ee15769738d1343acfb117875c5d928daf0ad3cc9f6`，4730檔。`/tmp/latest-windows-portable.json`已指向此包，明記requiresFrontendRelease；後續已更新Kiosk deployed=true／PB=false，physical=false。
- `scripts/windows/prepareAudio.py`＋audio/windowsRuntime.json固定CPython3.13.17 embedded、ORT DirectML1.24.4 cp313、NumPy/SciPy/AEC/VAD及官方VC redist14.44.35211 SHA。官方PyPI wheel SHA逐一核對；bsdtar抽必要x64 CRT DLL與license，無系統安裝。173個PE native binaries／DLL imports核對只餘Windows系統DLL；packagePortable.py必須傳--audio-runtime-dir，驗manifest及現行Python source再封。內含license/model SHA、排除env、校正及錄音。
- 驗證：Python19過1 opt-in skip，另120秒真AEC3/ONNX合成stress1過；Desktop32、Chrome收音／設定6、ordering255、archive邊界3過；Desktop/Kiosk/Shared scoped types、changed-file lint、diff check過，未root types／commit。獨立虛擬螢幕Electron46.0.0-alpha.2＋CPU dev真preload/IPC/Python：校正627blocks、48k input→15360 output samples、Float32保留、stale拒絕；reload舊PID退出／校正仍在、normal close新PID退出，全過。agent-browser版本無skills子命令，實際讀help再操作專用session並關閉；臨時server/profile已清。沒有商家／正式資料操作。
- Kiosk配套前端已發布，公開PB artifact仍未發布；沒有重啟現場設備。下一步是現場重開新版EXE並實測校正；勿強reload進行中訂單，勿重啟公開PB記憶體server清掉session。Iris Xe實際kernel、效能、UMA實體聲道／回音／真人移動及完整語音點餐都未驗收。正式設計 `docs/plans/2026-11-18-kiosk-native-gpu-audio.md` 與audio/README.md。

## 2026-11-18 UMA-8 獨立 Python 線上 RTF v0.2.0（已交付套件，未接入 Kiosk）

- 使用者提供 `/home/aimax/Downloads/uma8_frontend.zip`，要求更新版本並詢問重包。新版來源在 `pb-test.local/uma8-online-rtf-v0.2/uma8_frontend/`；這是獨立 Python 工具，不是已部署的 Kiosk／EXE 新音訊管線。舊 LCMV／Spatial Mask／Falcon 分流未在本輪修改或移除；未改正式服務／設備設定／其他 thread 的點餐程式。
- v0.2.0 加入噪音白化候選 RTF、獨立前置 VAD、兩次候選一致／品質檢查、平滑更新、播放及尾端300ms凍結學習、未知服務區語音不進噪音統計、最多2秒重新取得緩衝。仍需一次安裝位置校正作不可漂移基準；只追蹤其聲學範圍，不能保證顧客身分或任意多人分離。網頁可比較固定／線上 RTF；CLI live沿用同一Frontend，預設不存整場RAW，完整診斷需 `--save-continuous-audio`；timing保留最近10000blocks。網頁仍最長60秒測試台，不是全天營運介面。
- 隔離 Linux/Python3.13.9：原套件＋新增測試59過、stress預設skip1；另明確啟用120秒合成串流（真AEC3／ONNX）1過，樣本數守恆／更新／受測狀態容量通過。Windows／實體UMA／真人移動混音／ASR正確率未驗收。PortAudio/JACK只下載解至/tmp供測試，沒有改系統；沒有全倉typecheck／commit。
- 成品 `pb-test.local/uma8-online-rtf-v0.2/uma8_frontend/dist/uma8_frontend_windows_v0.2.0.zip`，789383bytes，SHA256 `e939df836230aecf05c99369cf6a3d38d00825a32651b864c236674df739dacc`。61檔CRC／payload manifest／模型SHA、乾淨解壓CLI自檢及15項RTF測試（stress另跑）過；包含啟動cmd／TTS素材，不含環境、錄音或校正NPZ。`bundle-verification.json`在stage根目錄；新版README／docs/validation.json詳述範圍。原Windows鎖檔保留，未新增Python依賴。
- 若下一步要讓Windows點餐EXE內建這個Python服務，仍需設計原生串流／播放參考／程序生命週期與前端接線，並重新打包含依賴的EXE；不能只把本ZIP放旁邊或更新遠端網頁就宣稱替換成功。

## 2026-11-18 自建PB加減互動對齊（已實作／建置，未發布）

- 使用者要求調整自建站，避免click型假按鈕讓商家事件問題漏測。沿既有JS與Playwright，不新增套件。`test-sites/pb-order-lab/quantityControls.js`擁有單一長按lifecycle：左鍵mousedown即時增減、600ms後每100ms重複、document mouseup／blur／hidden／dialog或route更換停止；Enter可操作，單獨click不變更。span加上Element Plus增加／減少class及aria-disabled／is-disabled，商品／加量草稿microtask更新合計。
- cart quantity共用`changeCartQuantity`：每line一個pending，真實模擬PUT期間禁用input及本行控制項，回應後替換DOM；舊row已離頁不重新渲染新頁。事件／同步邊界依Element Plus官方repeat-click及本機真API，不假造網路耗時，不宣稱完整複製商家目前版本。README已記錄範圍及命令。
- 先red兩項：原站單click仍加量／cart等待回應時input未disabled。最終新Chromium4項通過（含長按release/removal、Enter、min、pending不重送、正式executor排骨2/260→3/390→1/130→2/260及modal close→navigate）；既有domain26＋啟用server5通過。初次domain server未配env的5skip未計通過；初次browser module序列化SSR helper錯誤改既有nativeCheckout的browser-owned import方式，有NOTICE，未mock import。整合首次另一次手勢失效留原報告，停止來源編輯後完整4項通過，未確診該瞬態根因。
- 真agent-browser新session再次A/B：HEAD原版controls在**更新後**lab重現「兩份逾時仍1份」，同一dialog新版press/release成功2份。其後正式createPbService＋Host完整10checks通過（含上述兩個A/B、cart加減、商品close、先發票再手機、orders0）。`/tmp/pb-lab-fidelity-report.json`全回執、`/tmp/pb-lab-fidelity-cart.png`、`/tmp/pb-lab-fidelity-{red,green-final,domain,server,lint-final,build}.log`。只loopback自建站、沒有Jev/Main/ASR或商家操作；新增browser session已關閉，既有5188服務未重啟。
- 公開參數建置產物 `/tmp/pb-lab-fidelity-public-dist` 成功；尚未修改公開5198/static／重啟／部署，也未重包EXE、commit或root types。使用者已問是否需更新EXE，已說明native PB payload封裝在EXE，必須與自建站事件更新配套發布；舊EXE只有click會刻意失敗，不可單獨切公開站。既有公開service仍讀`pb-test.local/public-pb-20261117-142344/dist`。本輪未授權或實作重包／發布。

## 2026-11-18 PB 數量事件／商品視窗導頁／發票預設修正（已實作，未部署）

- 現場 DEV-647276 台北01:06與01:13–01:14「炸排骨便當兩份」的 intent／Main quantity=2 正確；browser journal 在 quantity dispatch 後讀回等待5秒失敗，沒有走到加購物車。01:15–01:16結帳則直接navigate，被仍開著的商品dialog遮住。唯讀原始事件 `/tmp/kiosk-silent-investigation-events-private.json` 為600私密資料，不提交。非已證明網路故障。
- `pbControls`數量操作原只`.click()`，Element Plus `v-repeat-click`官方實作監聽mousedown；新增共用press/release/click於商品／選項與cart quantity，每步仍核對值，立即mouseup終止長按，移除節點時釋放至document。官方事件契約與測試已重現差異，尚未核對現場PB實際bundle版本或Windows實機成功，不可宣稱所有讀取失敗均同根因。
- `navigate`跨route先關商品dialog再找cart link；同route仍保留配置中的draft。`executeBrowserCheckout`從已開cart直接continue亦先問發票方式，不把原站預選none當顧客選擇；沿既有checkoutStep續填，不重選已進入資料填寫的發票。選none後問通知手機，其他方法先補專用欄位，最終送單同意仍獨立。三個原final-summary測試改先明確選none，保留reject/unknown/expiry驗證。
- 先red：invoice default跳步1項、Chrome數量mousedown與modal導頁2項；browser初次EPERM／缺預設Chromium不是功能red，改正常escalation＋已裝Chrome無頭後才真正重現。修正中完整回歸抓到same-route誤關draft，已修且最後通過。最終Kiosk ordering/dialogue255、Chrome controls/operation/checkout52項通過；兩package scoped types、4檔lint及diff check通過。log `/tmp/pb-nov18-{invoice-red,controls-red,checkout-green,controls-final,kiosk-types,ui-types,lint}.log`。
- 兩份README已更新。未commit、root types、正式站／設備設定／商家購物車改動，未build／重包／部署；現場仍需協調發佈Kiosk frontend與嵌入PB payload/EXE後驗收，不能只更新前端就說數量事件已生效。
- 同chat追加真瀏覽器操作：agent-browser獨立`pb-nov18` session載入5188既有Vite站與當前正式`createPbService`／Host checkout模組，無mock executor；A1空cart→炸排骨2份260→cart3份390→1份130→2份260，全步驟readback成功並錄下mousedown/mouseup/click。開商品後review journal確為close-product再navigate；原預選none仍列五種發票、明確none後問手機，orders=0。8checks通過；`/tmp/pb-nov18-browser-report.json`完整call/step/event證據、`/tmp/pb-nov18-browser-cart.png`截圖。此輪直接呼叫正式工具與Host，不含真Jev/Main分類或麥克風ASR；fixture仍為click型stepper，不能冒充商家Element元件實測。已裝agent-browser不支援skills get，讀本機help後使用。
- 商家另開無登入session唯讀對照：直接menu回403／請掃QR，正常select-table可開但顯示「準備中! 未正式營運 敬請期待」，combobox click遭遮擋未成功；沒有force／繞過、加商家cart、送單、付款。`/tmp/pb-nov18-merchant-entry.png`。實站事件差異仍待營業可操作時驗證；本輪沒有部署或重啟既有5188（啟動嘗試只回port in use）。
- 使用者追問自建站是否同樣會失敗後，再開全新session作實際A/B：將HEAD原版pbControls用Node stripTypeScriptTypes轉譯至/tmp，與當前新版共用真實lab DOM、production pbOperation/pbPresentation。原版prepare1→2成功，證實lab click型stepper不重現Element的mousedown事件差異，勿宣稱此前lab通過已證明商家加減修好。原版modal-open navigate明確重現「被其他畫面遮住」；新版2→1→2及先close再navigate成功。再跑正式createPbService加排骨2/260、cart3/390→1/130→2/260、商品open→review全部通過，未送單。9checks含1個預期原版失敗，`/tmp/pb-nov18-browser-ab-report.json`與`/tmp/pb-nov18-browser-ab-cart.png`；未改lab事件模擬或部署。

## 2026-11-18 嘴型輔助語音偵測開關（實作／成品完成，等待使用者sudo啟用）

- 使用者明確要求MediaPipe嘴型輔助做成可設定開關。新增共享`DeviceSettingsValues.mouthDetectionEnabled`、allowlist／Server validator及雙語標籤說明，預設false；共用deviceSettingsEditor在本機管理及後台皆可開／關、保存及重新載入。無新套件、DB migration或EXE重包，沒有直接寫設備override。
- Legacy off：mouthActivity的onset／complete略過視覺條件，Scene的11處語音資格檢查以`visualSpeechRequired`控制presence，captureRecognitionSignal不含target controller。mouthTracking僅on時啟動。迎賓仍用原allowsObservedVoice()視覺預設，不隨語音開關放寬；背景音模式獨立。Falcon effective mouthAssistance=false，但visualSpeechRequired=true，維持原嘴部影像／presence路徑。切換設定沿用audio policy watcher重建未提交capture並丟尾至下一次靜音，不取消已dispatch商家工具。
- 驗證：先red重現mouth gate off仍拒絕／Server新欄位default不存在；實作後Kiosk6檔44、policy6檔25、localAdmin API7過，真Chromium新switch兩模式2過。Kiosk／Server／Web scoped types及8檔lint、Kiosk18.26秒／Web build過，未root types／commit。完整既有editor Chromium為14過1失敗：舊text-only case預期背景音combobox不存在，現有generic editor原已提供，未修該無關預期；保留mouth-switch-browser.log。初次browser sandbox localhost bind EPERM後以正常escalation重跑，不是測到功能red。
- Stage `pb-test.local/mouth-assistance-switch-20261118-r1` **尚未部署**。696來源前後hash一致；API overlay只有runtime/apps/server/src/services/domain/kiosk/deviceSettings.ts與runtime/packages/kiosk-proactive/src/deviceSettings.ts兩檔，diff僅本開關；雙入口1143成品、447差異，其中125同名.js.map僅在配對JS與線上完全相同時容許更新，並完整backup；執行用hashed assets不覆寫。其他6份runtime API/shared＋PB入口invariants不變。
- activate.py沿用先前root發布流程：預設僅核對來源／成品／當前PID／runtime依賴，已實際dry-run成功；`--activate`才備份2 API與變更static、restart API／ready後發布web及kiosk entries，失敗回復。全域deploy flock避免競態。沒有Cloudflare／Nginx／Tailscale／DB／強reload改動。成品含release.json、source-hashes、各驗證log、READY.md與啟用腳本。
- 使用者首次sudo啟用在取得`/tmp/webnavior-tool-policy-deploy.lock`時PermissionError，尚無backup／activation.json或live變動。鎖為aimax所有664、protected_regular=2，原`open('w')`的O_CREAT觸發sticky /tmp跨使用者保護。activate.py已改既有鎖read-only開啟，缺檔exclusive create＋競態重開，保留同inode／flock，不刪鎖、不改權限或sysctl；3項Python回歸（readonly既有鎖、缺檔重用、互斥及例外釋放）通過，完整dry-run再過。sudo下實際啟用仍待使用者重跑下列指令。
- system API User=aimax，Restart=on-failure；sudo -n true曾回password required。不可用kill等方式規避服務管理、不可宣稱已生效；不是自動approval review拒絕。使用者需完成當前測試後在Ubuntu執行 `sudo python3 /home/aimax/webnavior/pb-test.local/mouth-assistance-switch-20261118-r1/activate.py --activate`。之後先查activation.json及public version／module／shared field bytes、API ready，再通知EXE完整退出重開並確認release。Windows真人嘴型off/on驗收尚未做。

## 2026-11-18 語音流程／前端攔截審查（規則未修改或重新部署）

- 使用者要求描述現行架構並審慎檢查疑似前端過濾。比對公開latency-r1的source manifest，Scene／vision／target／mouth／presence／interruption／queue／fast-path 8檔皆匹配；runtime direct decision與repo一致。唯讀查device.settings.overrides（前次直接settings第一層的null不能當真設定）：DEV-647276與DEV-170131皆backgroundSpeechMode=off、observationEnabled=true、faceConfidence=.6；VAD threshold=.5、minSpeech250ms、silence250ms、pad2000ms、maxSpeech9999s。尚未由此證實每次漏答的個別原因。
- **明確行為／高誤擋風險**：legacy mouthTrackingRequired／canStartSpeech不依backgroundSpeechMode，off僅關語意background／recipient veto，仍強制嘴動與視覺資格。customerTarget在>250ms觀測間隔、單次missing或ambiguous即撤銷revision；mouthActivity亦250ms freshness、單次無mouth即撤銷lease。背景音off不能解除這些前端限制。
- 前一批target切換功能的resetVisualSpeech abort controller綁進整個captureRecognitionSignal；錄音已完成、ASR仍等網路時也會因target revision取消，catch只標ignored。這是已存在的程式路徑，非已證明現場每次都由此觸發；真換人保護與同人暫時漏偵測需要區別，不能逕行全關。
- ASR前後、FIFO出隊、fast-path IO後／進Main前反覆用當下allowsObservedVoice核對（含管理頁、準備／重設及觀測freshness）；已完整辨識語句可能在等待期間因後來的視覺／UI狀態被丟棄或DEFER。queue另有ready後15秒到出隊的有效期、最多4個pending；onDrop主要更新UI，未逐筆持久化原因。
- speakAssistantReply在off／observe且speechInterruption.blocksPlayback時直接return，沒有pending/resume；新capture誤觸打斷後，舊回覆若剛好在ASR等待期間完成可能只有文字沒有TTS，新capture最後空白／取消也不補播。此路徑在tts-start之前返回，故缺speech timing不能直接當模型沒答。部分ASR取消／local presence return亦缺精確持久化原因。
- 重新跑現行7檔112項通過：customerTarget、mouthActivity、voicePresence、speechInterruption、kioskUtteranceQueue、kiosk-fast-path、useKioskInteractionTurn；`/tmp/voice-admission-audit-unit.log`。其中測試刻意肯定嚴格撤銷行為，不能當真人不會誤擋的驗收。這輪無產品修改／放寬設定／部署，沒有root types／commit。建議後續先補逐句terminal stage/reason，再區分錄音期證據與ASR等待期，設計同人短暫失蹤與TTS延後／撤銷政策；保留接待重設、真換人、過期工具／送單保護，不增Jev過濾模型。

## 2026-11-18 公開網域回覆等待修正（已發布，現場載入後耗時待觀察）

- 使用者要求先處理公開網域，Tailscale端暫不追問／調整。已確認程式瓶頸：`useKioskInteractionRecording.append`原以同一FIFO串行保存browser/runtime/timing診斷與顧客／操作證據；Main finally等待metrics、Scene presentation也await metrics，公開RTT會讓非授權用診斷阻塞後續保存／回覆。沒有證據將20–70秒整段等待全歸此處或Cloudflare。
- 先以兩個test-only案例red重現blocked diagnostic擋ASR evidence及completed Main等待metric acknowledgement（root vitest不含Kiosk，後改package-scoped才真正跑到2個失敗）。現改僅六種已知service_event source走獨立診斷FIFO：browser_tool_metrics、voice_recognition_timing、utterance_timing、audio_runtime、main_task_metrics、main_presentation_metrics；Main／presentation不await metrics。顧客文字、工具回執、操作claim、問題及其他service_event保持原durable FIFO，不略過寫入前授權／新狀態核對。診斷metadata新增observedAt，server sequence仍是抵達順序；不得用它推定跨lane事件發生先後。Server現有atomic sequence increment已核對，可處理同接待並行紀錄。
- 兩lane各自串行、沿用15秒API timeout與原session捕獲／end隔離，不增加新套件／API／語意模型。新增4項回歸涵蓋診斷不阻顧客、Main不等metrics、兩lane內順序／tool_result不得冒充診斷、舊診斷失敗不污染新接待；完整recorder80項通過、Kiosk scopedtype與3檔lint過、production build16.99秒。未跑root types，無實際Windows語音／現場提速定量驗收，未commit。README為source-of-truth已更新。
- 已發布 **public-reply-latency-20261118-r1**，台北00:38:45啟用。Stage `pb-test.local/public-reply-latency-20261118-r1`：557來源建置前凍結／後一致，與上一frontend manifest差異僅Scene、recorder、recorder tests；590成品逐檔核對、97變更，固定路徑僅index/version，其餘新hashed assets，保留舊資產及backup。API PID2055500未重啟，原6份API/shared runtime、PB／admin入口invariants一致，未改Cloudflare／Nginx／Tailscale／DB／設備設定，未重包EXE或強reload。entry SHA `9867bee2aaf51f4aa6756c679b715250c34645857d8bd32d0f20596d2a0729ee`。
- 發布後8項LAN／public HTTP通過：entry、version、真正module `/kiosk/assets/index-DYD2qKkG.js`、release chunk `use-analytics-Bv9yUISK.js`、capture worker、CSS、PB。HTML僅容許先前確認的單一CF beacon＋換行，其餘raw bytes一致。stage含release／activation／post-activation-verification、來源hash及red/unit/type/lint/build log。已通知現場完成當前訂單後完整退出／重開既有225156包並核對嵌入release；持續監測只對載入後資料評估，不能宣稱現場已變快。

## 2026-11-18 偶發沒有回應（唯讀調查，未修改或部署）

- **Cloudflare／Tailscale實測補充**：使用者確認現場Windows為`DESKTOP-NJ358FS / 100.111.63.86`；100.92.1.80是伺服器。伺服器→Windows八次tailscale ping全為DERP(hkg)，105–135ms，未升direct；後續status CurAddr空、Relay=hkg，TSMP可達。伺服器netcheck UDP=true、MappingVariesByDestIP=false、Health空、未用exitnode／RouteAll=false／ShieldsUp=false。不能據此判定Windows端NAT／公司防火牆或本機設定哪個有錯；已async請使用者在Windows跑`tailscale netcheck`，待回覆。
- 同程序重用連線的公開readyz／HTTP1 readyz／version各6次共18次全200，warm median約189／190／185ms（各組首次403／417／487ms）；本機6次約1ms。這是伺服器出發的小GET，未量Windows端HTTP／音訊上傳／SSE。Tunnel容器`cloudflared-tunnel`目前4條連線，觀測未重連；45分鐘error以context canceled為主，20筆request含18 ASR／2 TTS，可能為程式取消，未能判定發起端。約觀測首段總請求+300、request_errors+6；較長取樣QUIC lost packet+1、packet-too-big仍0、heartbeat retry0。累積計數不可當本次錯誤。`/tmp/kiosk-network-check-20261118/summary.json`與private metrics/log均600。
- 發布225156 ZIP內kiosk.settings.json入口正確`http://100.92.1.80:5169/kiosk/`（windowed=true、diagnosticPort=0），目前無法直接讀現場Windows那份。Nginx site API仍proxy到127.0.0.1:5168；已部署Main SSE有X-Accel-Buffering:no。nginx -T無root檢查失敗，改唯讀site檔，未修改或重啟服務。官方Cloudflare未解決事件列Replicate／Turnstile／Workers subscriptions，未據此聲稱本站Tunnel故障。
- 使用者要求持續觀察，已建立本chat每5分鐘heartbeat「觀察點餐現場測試」（automationId `automation`），僅有新異常／有意義變化回報；state `/tmp/kiosk-live-test-watch-state.json` 去重。使用者確認目前EXE選**公開HTTPS入口**。已發布bundle以globalThis.location.origin決定API，因此此入口的API也經公開反向代理。唯讀readyz四次：本機0.8–1.7ms、伺服器自己的Tailscale地址0.7–2.1ms、公開HTTPS306–747ms；公開回應server=cloudflare、cf-cache-status=DYNAMIC。這僅是伺服器出發的小請求，非現場端到端或音訊／SSE比較，不能據此定案Cloudflare故障或將全部差值歸它。現場Tailscale對照尚未進行，不在點餐中強切換。
- 使用者回報偶發完全無回應；目前尚未提供確切語句／時間。最近紀錄以 DEV-170131 為主，勿沿用先前 DEV-647276 的 ASR 或 context-unavailable 原因直接定案。私密事件 `/tmp/kiosk-silent-investigation-events-private.json`（第二次讀取771筆）、API journal `/tmp/kiosk-silent-investigation-api.log`；不可提交原始顧客紀錄。
- 11/18 台北00:13:35–36，ASR已辨識「給我一份」「我要吃三杯雞便當」，submitted=true，但後續沒有這兩句對應user_text／Main task／assistant；其後其他語句仍正常操作，不能歸因Main模型未回答。現有持久化紀錄未涵蓋所有queue drop／presence gate／target cancellation原因，精確中斷點待補，不能僅憑缺事件判定是哪個gate。
- 00:14:58「炸雞腿來一份」後續確有加入1份並回覆；ASR約9.05秒，完整文字後約24.9秒才first-audio，Main兩次模型單輪約689／410ms。另一句00:07「它會動耶」first-audio在admission後約69.6秒；整段慢不能全算模型延遲。此批Main round約0.4–1.2秒，需分拆讀取／排隊／工具／presentation等待。
- 多筆speech-finished=cancelled（如00:07:12、00:09:45、00:10:01、00:12:11）；證明有生成後播報取消，未記錄足以區分新插話／目標或接待切換／其他stop的原因。現有本地打斷不自動續播，仍不可宣稱此次已確診VAD誤判。
- 該次journal已完成的ASR44、TTS48、decisions52、messages7請求皆HTTP200，沒有先前Missing speech detect model／timeout／error字樣；SSE messages HTTP200不等於每個turn成功。尚未改程式、設備設定或部署，未執行測試。

## 2026-11-17／18 主要點餐者切換＋依背景音模式打斷TTS＋可拖曳診斷（已部署並核對）

- 使用者授權實作；補充診斷必須沿用既有開關、可拖拉浮窗，並更正TTS是否等待Jev應隨backgroundSpeechMode，而非永遠略過。沿用現有MediaPipe／VueUse，未新增套件／模型、改設備設定、commit或重包EXE。正式行為見stage-kiosk README的legacy visual admission段。
- Legacy camera改用既有bounded多臉lane選主目標，不再由單Pose／face[0]決定。customerTarget按觀測區域篩選，以interaction ROI／中央位置／朝向／scale排序，明顯更佳候選持續400ms才切換；array重排不換人，ambiguous／缺失／250ms以上中斷撤銷幾何continuity。revision變更取消未提交capture／ASR、撤銷嘴部lease，不重置接待／車、不取消已接納訂單工具。這是匿名幾何追蹤，不是身分／聲源驗證；constrained仍最多2臉、其他依原budget。Falcon維持原target／收音／打斷路徑。
- useVAD新增每次inference的onSpeechProbability callback，包含重複相同score及silence；新speechInterruption以capture id隔離。off／observe且同目標視覺資格有效，連續高於設定threshold達250ms就只stop播放器，無須等ASR／語意模型；100ms以上inference gap或低分重算，silence tail不算語音。enforce保留既有ASR後語意admission再打斷。停止聲音不abort Agent／已dispatch工具；錄音／ASR未完前抑制新播報，沒有自動續播。250ms是局部條件，不保證實體端到端反應時間。
- Voice／Presence診斷共用kioskDiagnosticWindow，沿用原開關與已授權管理頁顯示條件；header以useDraggable拖曳、reset位置、parent resize clamp、內容可捲動，voice仍限Host hero範圍避免native menu遮住。新增目標revision／候選數／切換原因及background mode／打斷狀態。並未改成顧客頁永遠顯示，也沒有新增native popup權限。
- 先red真Chromium重現2項（舊Pose占人、診斷不能拖）。最終Kiosk聚焦6檔43unit＋UI VAD2檔3unit過；Chromium不同案例共27過（vision2、speech6、real worklet1、diagnostics3、既有conversation15，分批執行不重複計）。TTS off／observe／enforce真AudioElement驗證僅停止播放，原using-tool turn與voice candidate不abort。Kiosk scopedtype、限定14檔lint、隔離Vite build過，未root types。截圖／wrapper尺寸修正途中失敗保留；沒有改Vite fs限制放行/tmp，而改用既有允許的__screenshots__目錄。
- 證據 `/tmp/customer-target-{red,unit,vad,browser,diagnostics,diagnostics-callers,types-final,lint-final,build-final}.log`；成品 `/tmp/customer-target-build`。人工看過 `apps/stage-kiosk/src/components/__screenshots__/customer-target-diagnostics.png`，無顧客媒體。未Windows／真人／實體回音驗收，未另測Falcon完整旅程。

- **已部署**：使用者明確要求部署後，發布 `customer-target-vad-20261118-r1`（stage `pb-test.local/customer-target-vad-20261118-r1`）。557份來源SHA於建置前凍結、建置後一致；嵌入VITE_RELEASE_ID。原r1來源比對僅9份既有檔變更，皆本批，加上新helpers／window及UI VAD callback。只切換Kiosk前端，590份成品全部核對，99份變更（固定路徑僅index／version）；保留舊hashed assets及backup。API MainPID2055500／ready，6份API/shared runtime與PB／admin入口invariants完全不變；不需新版EXE、未force reload、未重啟API／改DB或設備設定。
- 發布後8項LAN／public HTTP核對通過（入口、fresh version、真正module entry、含release chunk、capture Worker、CSS、未變PB）。公開Kiosk及PB HTML被Cloudflare注入1段beacon＋1換行，逐字diff確認後僅移除這個精確注入再比對，其餘字元完全一致；JS／CSS／Worker／version為raw byte一致。初次module regex誤取Core SDK已改核對type=module入口，沒有放寬資產SHA。證據stage/{activation,post-activation-verification}.json，現場請當前訂單完成後完整退出重開225156包並看管理頁嵌入版號；Windows／真人選人與插話仍待驗收。

## 2026-11-17 重複現場人員備援提示：Main前狀態讀取失敗（未修，精確原因待補）

- 使用者回報一直出現「您可以先在畫面繼續點餐；如果畫面也無法操作，請洽現場人員」。此句來自 `orderingMessages.ts` 的 `recovery.unavailable`，由Host `browserRecoveryReply` 在無可用page／回執時產生，非Main模型自行回答。
- 唯讀查最近資料：DEV-647276三個接待182筆事件，10次 `main_task_metrics` 全是 `context-unavailable`／failureStage=context／modelRounds=0／requestedToolCount=0；9次回覆為service_recovery_guidance，presentation標記read-failed。語音已有成功辨識／送出；與先前ASR missing speech detect model分開。原始資料 `/tmp/kiosk-fallback-investigation-events-private.json`（600，不入庫）。
- 工具紀錄有browser_cart_get及browser_recovery_context成功，未見browser_state_get。新版Main reader強制state_get；缺descriptor、task失效及execute前拒絕都可能在無called事件前失敗，現有send catch吞掉原始cause，不能僅憑缺事件斷言缺工具或舊EXE。retryContext.capture失敗會自行降級undefined，不應單獨歸咎於其canRetry=false。
- 使用者明確確認已完整更換225156新ZIP；已核對該ZIP的resources/app/out/service/pb.js確有browser_state_get（4處）。不可再直接歸因舊EXE。仍需取得現場實際discovery工具清單與prepareRound原始錯誤／task狀態，分清descriptor／載入版本／生命週期問題。此輪未改產品、部署、清車或設定，未宣稱修好。

## 2026-11-17 前端語音失敗已定位為ASR上游缺speech_detect_model（調查，未改設定）

- 使用者問頻繁「本次語音無法辨識」是ASR還是Tailscale。讀目前APIjournal90分鐘：legacy `/api/kiosk/audio/transcriptions` 200共124（台北22:00:29–22:26:49）、503共93（22:28:27–23:15:24）；93次全部是上游 `mcjijz33kp.aikcitri.qzz.io/audio/transcriptions` HTTP400，body `{"detail":"Missing speech detect model: ''"}`。這批是上游已收到請求後拒絕，不是Tailscale連不上；不憑此排除其他未觀察的網路故障。查詢是服務總量，未歸屬單一設備。
- 前端 `KioskScene.vue` processVoiceCandidate catch只將413獨立，其餘皆audio-failed「這次語音未能完整辨識，尚未執行，請再說一次」；空text另走unrecognized，不是這條catch。Gateway收到上游400統一轉503，故顧客看不到真正原因。當前forward只傳file/model。
- 已唯讀讀取服務OpenAPI（whisper runtime0.4.0）與GET/models：schema有可選speech_detect_model（須在/models）、chunking_strategy預設auto；model清單5個transcription名稱，metadata未標示可用detect預設，不能自選某個就當正確。用1秒synthetic silence，直接上游對照預設及chunking_strategy=none，兩者都400同missing-model；故不能宣稱加none已修好或只是雙重VAD。沒有用顧客錄音、改模型／key／部署／Tailscale。
- 證據 `/tmp/asr-investigation-{api-90min.log,journal.jsonl,openapi.json,models.json,default-result.json,no-chunking-result.json}`。需後續檢查上游speech-detection預設／請求契約及22:28前後ASR設定變更；未取得ASR主機程式／設定，不能斷言是模型檔案遺失還是預設名／請求欄位問題。前端錯誤分類亦待改善，本輪未修程式。

## 2026-11-17 點餐＋另一thread麥克風合併更新已部署並核對

- 使用者要求一起更新另一thread麥克風。透過Codex read_thread確認「Find November 6 stable audio capture」已實作Spatial Mask／AEC3／0–80dB，先前使用者因本thread仍在修改而中止單獨部署；本輪改為合併準備。未切換任何設備演算法，LCMV仍初始預設。
- 合併release `ordering-microphone-20261117-r1`，stage `pb-test.local/ordering-microphone-20261117-r1/`：Kiosk、公開PB bridge、Desktop原生bundle與WindowsZIP均已建好。`source-hashes.json`凍結549份來源，建置後核對未變。`release.json`記錄603靜態檔before/after與6份API/shared overlay；不提交這些ignored artifacts。
- API目前為system `webnavior-api.service`，WorkingDirectory `pb-test.local/main-fallback-20261116-153654/runtime/apps/server`。Prepared僅routes/kiosk/index、Jev index及shared browserConversation/pbCheckout/pbJourney/orderingTools六份。routes中的Falcon response保持現行格式，未順便部署不相干的telemetry變更；麥克風新Mask是前端功能。
- 合併驗證：unit78（另stress skip1不算）＋明確opt-in120秒synthetic stress1、Chromium microphone/capture/worker/settings/diagnostics12過。打包後Worker off/on各22個512PCM，reference0／38400；不代表實體AEC驗收。既有本thread443／24／22及scopedtypes證據保留，未重跑全倉。Kiosk/PB/Desktop build、Windows pinnedSHA／PE／CRC／81檔manifest通過；warnings有既有兩個en diagnostic i18n key缺失，未擴修。
- WindowsZIP：`pb-test.local/ordering-microphone-20261117-r1/windows/Webnavior-Kiosk-Windows-x64-20261117-225156.zip`，163746724bytes，SHA256 `edbaad42e15abec92803f62f064864228de6160289987dcd4a7930d2bb7fb6ac`。相鄰sha256及READY.md已備；伺服器切換及HTTP核對完成後已更新全域latest索引。
- **已部署**：使用者已執行stage內的sudo activate.py。activation.json為activated，API ready；6份runtime API/shared、603份靜態檔SHA全部匹配。先前sudo密碼限制已由使用者完成管理員操作解除；非automatic approval review拒絕。未改DB、強reload、切換設備演算法或commit。
- activate.py預設只check，實際check通過；加--activate要求root。核對全部原檔／成品SHA與runtime links，備份覆寫檔，先API overlay／restart／ready，再PB資產／entry、Kiosk資產／entry，核實loopback兩入口；失敗回復舊檔及API，舊hashedassets保留。已準備失敗備份／activation.json，沒有實際演練正式rollback。檢查初版誤掃hidden .bin已修，沒有跳過真實package link檢查。
- 發布後7個HTTP核對通過：LAN Kiosk入口、公開Kiosk/PB入口、兩者entry JS、capture Worker與含release ID的chunk；精確byte/SHA匹配。證據stage/post-activation-verification.json，/tmp/latest-windows-portable.json已更新指向225156新包。Python browser UA曾因Cloudflare插入beacon使HTML原字節不同，diff僅beacon；改用已觀察無改寫的curl representation核對，沒有改產品或放寬資產SHA。Windows須完整退出舊EXE、解壓整包使用，保留LOCALAPPDATA／登入；實體Windows／UMA回音與完整真模型語音仍待驗收。

## 2026-11-17 P3付款結果頁新訂單／重新開始已實作（子批，未部署）

- 使用者明確要求實作付款頁新訂單／重新開始；本批僅此P3子單位，不宣稱付款入口語音／FAQ／設定17已解。正式行為與驗證見 `docs/plans/2026-10-28-windows-kiosk-electron.md` 最上方P3子批；未commit、部署、重啟正式服務或操作商家／付款，其他chat既有音訊等變更保留。
- `pbBrowserService`結果頁fresh state新增readonly `restart` decision，shared擁有 `pbOrderReceptionSchema`。有marker或其他pending操作→operation-pending，付款pending／unknown各自拒絕，只有paid／cancelled且無barrier才allowed。不新增結果頁工具、清marker或取消前單，Desktop／iframe仍只允許state reader。
- `resetConversationService`在舊menu reset／fallback前驗證fresh結果、document及契約。terminal只回reload給既有customer lifecycle；該流程重新載入設定的選桌入口、撤binding、end visitor、清Host問答，新文件重新discovery與接納。pending請先畫面完成付款／明確放棄，unknown先核對；讀失敗／stale／缺契約不默認reload。`BrowserRestartBlocked`給Kiosk兩個入口可安全顯示的具體原因，其他內部錯誤仍泛用。
- 先有5項Host red重現。最終Kiosk八檔443、UI client22、真Chromium三檔24（17＋6＋1）通過；Shared／UI／Kiosk scopedtypes、修改檔lint、native PB bundle build通過。新增四組production Host＋native：paid／cancelled可進新document並點新cart，前單完全保留；uncertain／paid帶order barrier拒絕且重載後保持；每組先驗兩次pending拒絕。composable另驗結果只讀descriptor仍完成接待撤銷。最初新瀏覽器測試未等待付款導航完成，讀到redirect而拒絕；保留debug證據，改等實際結果URL後通過，沒有放寬reader。
- 瀏覽器測的是production reset policy＋native，入口navigation由test驅動；visitor/reload順序用composable單元驗證，未執行整個Kiosk真模型／Windows／語音UI旅程。fixture自身單獨history/new按鈕不等同Host Restart。本批pending不會直接開新單，必須先付款或在網站放棄並確認；unknown不以重開消除鎖定。證據 `/tmp/pb-p3-*.txt`。
- 公開HTTPS與現用EXE仍是舊部署；新Host＋native payload須一起協調發布。P3其餘付款FAQ／入口及繼續點餐語意、設定17、P4數量／複合與P5推薦仍待處理；原句真Jev／Main回歸仍受isolated API未啟動限制。未root types、未重包EXE。

## 2026-11-17 本次回報＋舊例句再次確認（驗證與清單完成，真模型待驗）

- 使用者要求「這些問題加上過去例句儘量都要再次確認」。已在既有 `docs/plans/2026-10-28-windows-kiosk-electron.md` 最上方增加逐題驗收狀態：1–20（14／18重複）、PDF001–008、33組PB完整原句序列；逐項區分程式邊界通過與尚未完成整句模型旅程。沒有改產品、模型配置、部署、商家資料或commit。
- 從manifest指定commit `b1a7f5b8ddcb1a5785ebe67d1b307a6347c32bd2`取回master `apps/order-menu/src/evaluation/conversationMatrix.ts`，實數核對112個case ID、286個text；副本 `/tmp/pb-report-recheck-master-matrix.ts`。尚未移植／執行完整112組，不以現有33組代替；R01／R02／R06原證據仍缺。C01／C02及P3–P5保持未解。
- 本輪重跑：Kiosk16檔622、歷史5檔54（另skip1）、Shared四檔29、native cart/product兩檔64、Chromium三檔20過（13＋6＋1）。Server限定回覆9、fresh PB隱私摘要1過；stages7過1失敗。skip／未匹配檔名不算過。本輪沒有重現前兩次Chromium偶發，仍未確診其根因。
- stages失敗：unscored測試未指定backgroundSpeechMode=enforce，預期admission＋其他共6 checkpoint；現行off政策跳過admission得到5。定位 `stages.test.ts:23`／`routing.ts:212`。不把既有預期改成5或改產品預設來洗綠。Server較大擴跑中止／55秒超時，無完整結果不計通過；loopback fixture窄測完成。證據 `/tmp/pb-report-recheck-*.txt`。
- 原句真Jev／Main端到端目前受既有isolated API `127.0.0.1:15169/readyz`無法連線阻擋，live replay環境變數未配置。未自行啟動或切版操作者服務／借用商家登入。無Windows、真人語音、公開站修正版驗收；沒有改產品故未typecheck／重建。下一步仍P3；之後需用同版隔離API＋Host／native與已配置模型跑逐句，保留首次失敗與未完成需求，不把邊界通過當完整驗收。

## 2026-11-17 第二批P2發票續填／效果恢復核心已實作（未部署）

- 使用者要求接續實作；本批完成P2核心，詳細行為見 `docs/plans/2026-10-28-windows-kiosk-electron.md` 最上方第二批。未commit、部署、正式服務重啟、商家訂單或Windows驗收；其他chat音訊等變更保留。
- `browserDialogue`分離同接待／同文件的checkout progress與短效question；過期／cart revision可fresh重建填寫問題，不恢復手機片段、token或同意。Jev僅收到bounded step。說「好了」沿真實步驟續填，Main誤叫invoice亦不重選；非法非空發票碼明示格式錯誤。reset／換客／換document隔離。
- 最終question加checkout fingerprint，表單改動需新摘要。Native preflight拒絕回rejected／effect:none；Host只有證明未dispatch才重新準備摘要等新同意，當輪不重送。execution malformed／order dispatch／unknown仍不恢復。`questionPresentation`按none／applied／partial／unknown累積，缺回執不被早先none蓋過；pending submission回核對訂單。KioskScene掛executing／receipt與hint；cart／checkout排除Server一般serviceReply自由成功路徑。
- 驗證：Kiosk八檔499、Shared20、Server路由3／Jev摘要2過；Shared／UI／Kiosk scopedtypes、限定lint過，未root types。真Chromium三檔20過（nativeCheckout13、nativeReset6、iframe bridge1），含production Host＋native捐贈續填、手動cart變更、stale token拒絕renew、改通知欄位renew，全程該案例零訂單。Native PB bundle已重建；沒有重包EXE或發布。證據 `/tmp/pb-workflow-*.txt`。
- 完整首次回歸19過1失敗：nativeReset after-dispatch案例第二個read遇binding changed；未確診，獨立重跑與停止產品編輯後完整20項均過。不得宣稱已修其根因。前次P1也有未確診整合波動，現場穩定性仍待驗收。
- 下一獨立單位P3：付款引導及待付／已付／取消／不明頁的新訂單／重新開始。P4數量／複合要求與P5推薦／套餐未修；選桌help20、設定17及實際Jev／Main全原話矩陣未完成。本批僅active checkout成功回覆治理，不宣稱所有無工具成功路徑已覆蓋。公開HTTPS及現用EXE仍舊部署，發布時Host／API／前端／PB payload須協調。

## 2026-11-17 第一批跨頁／發票狀態核心已實作（未部署）

- 本輪使用者授權開始實作；完成P0／P1的狀態基礎，全部計畫並未完成。正式紀錄在 `docs/plans/2026-10-28-windows-kiosk-electron.md` 最上方「第一批跨頁狀態讀取」。沒有部署／正式服務重啟、商家訂單、模型提供者整段語音驗收或commit；其他chat既有變更保留。
- `browser_state_get`是Host-only跨頁reader，接入Jev前及Main每輪；editor重用既有cart/catalog＋DOM表單，結果頁fresh Inertia核對店／flow／URL／order。共享pbCheckout增加order state與不含個資的form progress，Jev收到發票方式／是否填寫／有效性，Main仍有fresh checkout。未取代持續步驟，P2「好了」重問仍待修。
- Native surface對結果頁僅允許discover／inspect／state_get；service結果頁只發布state descriptor，不建立menu-only controls，不放寬cart/reset/submit。語音送單後client只重綁reader；手動SPA送單即使留舊descriptors，Main按task.orderReference再讀本單回覆，換單拒絕。Kiosk結果頁排除serviceReply自由文字成功路徑，仍不能語音選付款入口／自動支付。
- `readPbStateJourney`僅解析已審查同店結果路徑，editor權限維持readPbJourney。付款狀態pending／paid／cancelled／unknown；未核實失敗與不明維持unknown。Jev及Main仍檢查既有cart owner，避免新接待看到前客order。
- 驗證：Shared20、Kiosk相關七檔461、UI client22、Desktop29、Server定向4；真Chromium production adapter nativeCheckout12與iframe bridge1通過。Shared/UI/Kiosk/Desktop scopedtypes、修改檔lint、原生PB bundle build通過；未全倉typecheck。並行整合一次捐贈填寫後改cart無成功回執，獨立與完整重跑通過但未確診根因，保留為穩定性待查。報告 `/tmp/pb-state-*.txt`。
- 公開HTTPS及現用EXE仍是舊部署。本批新Host＋payload需一起重建EXE，再與API、Kiosk前端和模擬bridge資產協調發布，不能只更新網頁。下一批P2：保留發票填寫步驟／一次性確認分離、effect恢復與其他無工具成功宣稱；P3新訂單、P4數量複合需求、P5推薦仍未修。設定17、Windows實機及全部原話自動化矩陣未完成。

## 2026-11-17 新增 Spatial Mask＋可選 AEC3（已實作，未部署）

- 使用者確認約11/6穩定版唯一明確缺點為TTS回音，授權實作可選方式。正式計畫與驗證：`docs/plans/2026-11-17-kiosk-spatial-mask-input.md`。取回`f616ca4`數值核心及oracle；保留現有LCMV為初始預設。
- legacy UMA-8 Admin新增Spatial Mask、獨立AEC3開關（預設開）與gain（初值15dB／0–80dB）；明確套用後才替換capture。獨立local keys，不改舊JSON。Falcon強制原AEC3／LCMV、一般mic保留browser，嘴部政策不改，並非完整歷史行為回退。
- 重用Eventa／capture lifecycle／現有七路AEC3。AEC off不建立WASM或reference；Mask內建48→16k，不串第二次decimator或LCMV的1024sample補償。停止／切換取消未完成capture與ASR、晚回隔離，不重播已接受點餐。新增active管線／AEC、lag／reference／RMS／limiting診斷。
- 核心／LCMV／嘴部25unit、120秒synthetic stress1、Chromium12個不同案例通過；changed-file lint、production build及built Worker off/on smoke通過（各22個512PCM packets，reference0／38400）。Kiosk scopedtypes僅報其他chat的`browserQuestionWindow.test.ts:161,163 checkoutVersion`兩錯，未擴修。證據`/tmp/spatial-*`，build `/tmp/kiosk-spatial-mask-build`。
- 未部署、未切換設備、未commit／root types；Windows真UMA-8的回音／插話／短答與30分鐘現場運行仍待驗收，不能用reference有資料當AEC有效證據。來源README及audio README已更新，現場不得宣稱已啟用新方式。

## 2026-11-17 全部實際回報修正規劃（文件完成，未實作）

- 使用者本輪要求先規劃；完整計畫已置於 `docs/plans/2026-10-28-windows-kiosk-electron.md` 最上方「實際回報整體修正計畫」，涵蓋1–20（14／18重複）、PDF001–008、公開HTTPS跨地點測試。只改計畫／交接，未改產品、prompt、部署或訂單。
- 批次：P0固定基準／唯讀補付款頁資料；P1共同跨頁fresh snapshot接入既有Jev前與Main每輪reader；P2持續步驟與一次性確認分離、按實際dispatch/effect恢復；P3付款引導／新接待；P4數量／複合要求；P5語義候選／套餐／回覆。原規劃的下一單位為P0＋P1；目前第一批實作見上節。
- 擬新增Host內部跨頁state reader（暫名browser_state_get），不是要求模型再多叫查車工具；菜單／cart沿用唯讀資料、表單核實DOM、付款資料需先驗證實際頁面契約。結果頁只增明列唯讀能力，不放寬所有寫入工具；native與公開模擬bridge同契約。未知送單不重送、不以重載清鎖。
- 保留選桌／開始兩步，合併需另作產品決策；付款成功後重開、設定畫面17仍需精確重現。公開模擬HTTPS已存在，計畫為回歸其他電腦可用，不應再描述成尚未公開；商家仍用EXE。不預設新依賴／DB schema；共享契約發布須核對前端/API/prompt/native payload一致，未決交易不得強制換版。

## 2026-11-17 實際點餐19項＋補充題歸因（唯讀調查，未修復）

- 使用者提供19項實際回報（14／18重複）、補充湯推薦語氣與選桌「我可以幹嘛」，及12頁8題PDF。完整逐項責任、證據等級、PDF獨立情境與驗收條件已加在 `docs/plans/2026-10-28-windows-kiosk-electron.md` 最上方「19項實際點餐回報」。本次沒有修改產品程式、模型／prompt、部署、設備或訂單。
- DB唯讀定位160筆相關原話／51接待，深入15接待；私密原文在 `/tmp/kiosk-order-report-review/*-private.json`，不可提交／打包。PDF文字完整抽取至同目錄report.txt；RustDesk原暫存檔渲染時消失，僅前3頁完成畫面檢查，不宣稱全截圖驗證。
- 已確證：湯推薦是Jev選錯含套餐／排骨的批次，當回合無Main；麵查詢是Main搜「麵」命中雞腿description「麵衣」，Main後續已只列牛肉麵但程式合併搜尋回執又帶回雞腿；豬肉literal搜尋漏掉豬里肌。捐贈是Jev GENERAL_QUESTION＋Main無工具宣稱已選；「我可以幹嘛」Main greeting工具被Host table gate換成預設櫃台提示，沒有真的table_select。
- 「好了」再問發票：已有填寫問題後，下一筆Jev context卻無waitingFor→NEW_REQUEST→Main choose_invoice_method→Host generic affirmative改成invoice-options；不是只改Jev字詞可解。兩份水餃則是Main point_to_menu_items(recommendation)丟失2份，接固定一份問題。
- 付款頁信用卡／繼續點餐：context rejected，Main modelRounds=0／context-unavailable；同接待restart expected true received false→preparation control journey unavailable。付款結果雖可辨認，菜單／cart執行範圍沒有它；需獨立只讀付款階段與新接待生命週期，不直接開放所有工具或自動付款。
- 20顆其中一筆fresh cart是基本8＋extra12／160元，總20，屬加量顯示歧義；另一筆確有澄清／加購中斷。20顆＋5顆被Main拆成一份20及一份5（低於8拒絕），effect=none也顯示核對剛才調整，另有部分完成後拒絕。不能把所有錯誤當未知寫入，也不能否認其他數量錯誤。C01/C02保持未修。
- 現有程式已於Jev前及Main每輪prepareRound做內部fresh read；應延伸讀取頁面範圍、分開持續業務步驟與一次性同意、以實際dispatch/effect分類恢復、成功措辭只認回執。不是另加一個模型查車工具。4項現況邊界自動檢查通過，位於 `pb-test.local/order-report-audit-20261117`；不是修復驗收，未全倉typecheck／commit。


## 2026-11-17 Windows EXE 整體回歸（基本流程通過，C01／C02仍失敗）

- 使用者要求整體檢查Windows EXE並排除潛在問題。本輪是完整稽核，**不能宣稱整套
  或Windows實機已通過**。沒有Windows／Wine／PowerShell執行環境；以同版Linux
  Electron、現用0.2.0 ZIP payload與已發布covered-cart前端交叉驗證。
- ZIP SHA／CRC／81檔manifest／Windows x64 PE／三payload與現有out一致。單元及
  Chromium共1188過（Kiosk933、Desktop29、UI核心79、UI瀏覽器93、Kiosk流程35、
  legacy音訊19；skip不算通過）；原生smoke34組檢查、Desktop/Kiosk scopedtypes與
  限定lint過。未root typecheck／commit／更動正式點餐程式／再發布或重包。
- 現行前端＋獨立API／Jev/Main＋既有native payload的19步旅程通過：一次故障注入
  後自動讀回恢復、只有1份餐點、載具／手機片段／最後確認、fixture只提交1次建立1單
  0重複、手動restart後下一位可點。detailsVerified=false，未操作付款或正式商家。
  `/tmp/windows-audit-checkout-recheck.json`；stage `pb-test.local/windows-audit-20261117`
  收錄summary、原失敗與修正後報告。隔離TTS共19次HTTP503，無實體mic，不能算有聲驗收。
- 補正三類測試邊界：ServiceRecovery定位限定顧客region（浮動console重複status）；
  verifyKioskDesktop fixture實作現用數量0的change移除；verifyKioskOrdering對local
  partition真正注入nullable/readback fault，並在native/CDP模擬merchant代理中將自有
  fixture絕對page.url的loopback origin投影到模擬origin，保留path/query錯誤讓正式
  ownership檢查拒絕。先有失敗證據再修測試，未繞過正式來源核對。
- **C01-repeated-edits實際失敗**：雞腿1→2成功，「兩份雞腿都換成一份炸排骨便當」
  實際剩排骨2。Main發出replace_item_in_cart(target雞腿,replaceQuantity=2,
  replacement排骨)，目前工具契約一換一；後續沒有補成原句要求的新總數。屬規劃／
  完成範圍問題，不能修fixture gold成2或以原生執行成功當整句成功。
- **C02-dense-request實際失敗**：水餃價格64確已由get_menu_item_details讀回，但
  add_items_to_cart的note被Main設成「不要湯」，最終只說加入雞腿1／排骨2，漏查價
  且再問結帳（原句先別結帳）。相關位置：shared orderingTools、browserCartTask、
  questionPresentation（操作回執取代資訊）、KioskScene.offerCheckout與Main workflow。
  未修這兩項；保留C01/C02-recheck.json和真實工具參數。不是新發現的Windows安裝故障。
- 隔離API/Web原先停止，本輪啟動並使用loopback15269送現用資產，對所有merchant
  請求攔截至5188 fixture。已關閉本輪gateway及隔離API/Web，DB/Redis資料保留，
  正式API未重啟、設備未修改。334570本輪讀到的準備錯誤最後在19:28，早於19:30
  covered-cart發布；較後有其他事件，不能據此證明其已載新版本或已完成點餐。

## 2026-11-17 DEV-334570 隱藏畫面與公告造成準備死結（已確診、修正發布）

- 新版診斷捕捉到實際現場原因：19:21:12–19:21:22，session
  `yfyg8sjR6F4mGr2ZIwWBw`、menu document `2a41d5e2-2d41-42f6-91cc-7ed5cd849635`
  的四次準備皆拒絕「操作畫面已隱藏，尚未派送下一步」。Start後換document，
  Kiosk準備cover隱藏native view；menu的 `browser_cart_get(forAdmission=true)`
  卻呼叫 `dismissAnnouncement`，pbOperation要求visible，故準備與重試同樣卡住。
  這次有具體證據，取代前節「第一個讀取原因未知」的狀態；不是已證明的PB API斷線。
- `browserCartSession.prepare`先讀普通context/cart；僅實際回報approved table時
  再用Host-only forAdmission讀前客cart。menu不請求公告按鈕操作，KioskScene傳遞
  此模組選定的input。保留前客非空cart review與未知寫入保護；公告在顯示後由下一次
  可見PB操作／使用者關閉。原EXE的native payload即可用，無需換包。
- 新回歸先red重現hidden錯誤，四檔51項green；Kiosk scopedtypes、changed-filelint、
  production build及限定diff-check過。未全倉typecheck／commit。其他chat檔案有既存
  whitespace，不在此任務修。使用175004 Windows ZIP內原生pb.js＋新版gate，在同版
  Linux Electron的隔離profile／本機fixture、實際WebContentsView隱藏狀態對照：
  舊input同錯、新input ready、reveal後原browser_search關公告成功、cart維持0。
  測試加入可見公告按鈕，無正式商家連線／真人Windows語音驗收。
- 已發布 `covered-cart-admission-20261117-r1`，stage／backup／588檔hash與HTTP核對
  位於 `pb-test.local/covered-cart-admission-20261117-r1`；入口SHA
  `c40ec27fa18e707de0f9959837f0100b32bc16b8ef88734bc2c4ed1f87c052ef`。
  Native證據／probe留同stage。未重啟API／強reload／清cart／改設備設定；現場需完整
  關閉重開EXE載入新前端，這次334570現場修後結果仍待核對。

## 2026-11-17 DEV-334570 正式 PB 準備／重開卡住（恢復修正已發布，現場待複測）

- 使用者回報 Windows EXE＋正式 PB，幾句後出現「點餐尚未準備完成」及「尚未確認
  前一筆點餐操作」。已唯讀核對指定 DEV-334570；最近幾個文件主要是 cart_get／
  recovery／present，沒有足夠證據判定有未知商家寫入。舊metrics只有phase，未保留
  準備讀取的拒絕原因，**第一個正式站讀取失敗的原因仍未確診**，勿宣稱現場已修復。
- 已重現並修兩個恢復缺口：ready transport上的 rejected cart admission 未進入自動
  恢復／不會重跑準備；未進PB journal的純cart/recovery read被當成未知寫入永久鎖住。
  新 `useKioskCartPreparation`擁有可取消準備／重試，離頁釋放pending、遲到結果失權；
  先核對原document journal及fresh recovery，再 bounded retry準備，不重播商家操作。
  client只對已核准PB頁的固定兩種read＋readOnlyHint允許missing journal；pending、
  不同document、未知cart write／submission都仍阻擋。沒有清空資料或解除現場marker。
- 保留原始read拒絕文字；新增 `browser_cart_preparation` 來源的準備／重開失敗原因，
  metrics的transport failed也記error（最多500字，不含cart內容）。下次334570重現可查
  這些事件，不能再只依一般提示猜測。私密既有事件 `/tmp/kiosk-device-334570-private.json`。
- 發布release `cart-preparation-recovery-20261117-r1`，stage／backup／逐檔hash在
  `pb-test.local/cart-preparation-recovery-20261117-r1`；入口SHA
  `b874f4322d3acd10989771560b4976ff5ec5420ab62bde977640a6babc52f7ea`。
  LAN實際入口與主程式SHA成功；公開HTTPS urllib曾HTTPError，但curl入口及主程式200
  且SHA匹配（見兩份http/curl verification）。未重啟API／改DB／強reload／重包EXE；
  0.2.0完整關閉重開載入，管理面板核對release。保留現有嘴部／提示音修正。
- 驗證：UI client Node21、Kiosk四檔48、真Chromium client19，共88通過；Kiosk/UI
  scopedtypes、限定lint及production build過，未全倉typecheck／commit。正式PB全新
  隔離guest的readonly table→menu/cart JSON目前可讀；沒有加餐、送單或讀使用者cookie。
  此探測不代表DEV-334570原有PB session／購物車狀態已通過。

## 2026-11-17 Kiosk EXE 0.2.0 雙入口與自建 PB 網頁備援

- 使用者同意換新版 EXE；啟動前選 Tailscale `http://100.92.1.80:5169/kiosk/`
  或公開 `https://webnavior.aikcitri.qzz.io/kiosk/`。設定的 kioskUrl 決定預選，其他
  部署保留第三選項；取消離開，不在點餐途中自動切線。來源配對各自保存，不搬 cookie。
- 普通瀏覽器備援**僅自建 PB**，走公開 HTTPS Kiosk。新增 stage-ui
  `pbSimulatorBridge`，沿用 Eventa 的真 parent/source/origin、PB document journal；
  單獨測試站與 EXE native 不啟動此橋接。ScenarioSurface 對正式 PB／不相容瀏覽器
  來源顯示提示，不嘗試錯誤 iframe discovery。Tailscale HTTP 普通瀏覽器沒有 EXE
  secure-context 特例，也不能沿用公開 simulator 的 Strict cookie；備援請用 HTTPS。
- 已發布 `/var/www/airi/kiosk` 與公開 PB dist 新資產／入口；舊資產保留，API與fixture
  程序未重啟、未改 DB/設備指派、未操作正式商家。備份與檔案前後SHA在
  `pb-test.local/dual-entry-20261117/frontend-release.json`；既有 public-pb frozen dist
  此次已作為發布目標更新，舊入口在同release backup/pb，勿再視其為原14:25快照。
- Windows ZIP `pb-test.local/dual-entry-20261117/windows/Webnavior-Kiosk-Windows-x64-20261117-175004.zip`，
  version0.2.0、SHA256 `181eff840054bc8574dc37a74ee3aef99a8002237a023b6593cf60309a1b8131`；
  pinned runtime、81檔manifest/CRC、三payload與build逐檔匹配。未強關現場／未實體Windows驗收。
- 驗證：desktop29、shared journey8、ScenarioSurface Chromium2、fixture26過/22 opt-in skip；
  另local及`PB_PUBLIC_LIVE=1`的browserBridge整合各1過，真Kiosk client透過iframe
  選A1→Start→魚丸湯1份50元→重載新document。Live測試只攔截測試parent harness，
  child/資產/API用真公開部署；不是已配對完整Kiosk＋Main/Jev/實體ASR的全流程驗收。
  Screenshot `/tmp/pb-public-kiosk-bridge.png`。Desktop/Shared/Kiosk/StageUI scopedtypes、
  三build通過；未全倉typecheck／commit。正式PB選桌後初始化錯誤仍未修。

## 2026-11-17 舊 ASR 被忽略仍播放提示音（已發布）

- 使用者確認重開後無辨識文字，但背景聲仍不斷播放偵測音。根因：
  `processVoiceCandidate`在ASR請求前就呼叫 `processingCue.acknowledge`，空白ASR
  或後續IGNORE已來不及收回音效。會走到此處表示程式mouth gate曾放行，不能據此
  宣稱真人嘴型辨識正確；本輪修的是回饋時機，沒有證明嘴部誤判已消失。
- 只改舊ASR：capture/transcription/pending分類保持靜音；既有服務放行checkpoint、
  有效最終結果、有效Main補充才開回饋。`useKioskProcessingCue`以正式數字utteranceId
  依接待期去重，避免checkpoint與final重複響；reset撤銷播放並清去重集合。
  Falcon與模擬文字維持原回饋，未跑Falcon測試／改其錄音流程。
- 先用真Chromium回歸重現過早響音，修後音效18項通過；Kiosk scoped typecheck、
  限定ESLint、production build過。未全倉typecheck／commit／Windows真人驗收。
- 前端release `legacy-mouth-quiet-20261117-r1` 已發布 `/var/www/airi/kiosk`；
  備份與deployment/HTTP驗證在同名 `pb-test.local/` 目錄。index SHA
  `30084dee9cebc456384c1ab2555370ef4554769a096da3fbfadb9701426a7712`。
  EXE仍0.2.0，於無未決點餐時完整關閉重開、管理面板核對此release。未強制reload、
  重啟API、改DB或模式；本輪只核對LAN入口，未宣稱公開HTTPS遠端驗證完成。

## 2026-11-17 舊 ASR 閉嘴仍觸發旁人辨識（修正已發布）

- 使用者回報的是實際辨識文字／AI回答，不只是音量條。前一版確有漏洞：閉嘴
  也刷新600ms onset；已錄音只檢查幾何連續，持續閉嘴仍可被背景VAD延長。
  回歸測試先重現失敗，再修正 `mouthActivity`；勿將先前22項通過當作真人驗收。
- 新句要求當前aperture>0.04及有效變化>=0.02；閉嘴立即禁止新句，閉合不更新
  motion。已錄音在無有效開口變化達max(1000ms,VAD silence+350ms)後永久撤銷，
  之後張嘴不能復活舊lease。保留短暫閉嘴／正常靜音尾段；超限整句丟棄不送ASR。
- 伺服器Redis唯讀確認目前 mode=legacy。只改舊ASR；Falcon沒改／沒測。
  13項嘴部與presence單元、2項真Chromium camera/AudioWorklet測試、Kiosk scoped
  typecheck、限定lint、production build過。無全倉typecheck或commit。
- 前端release `legacy-mouth-20261117-1812` 已發布 `/var/www/airi/kiosk`，管理面板
  data-build-info顯示此嵌入版號。EXE仍0.2.0，不需重包。現有視窗需於點餐結束後
  關閉重開才能載入；不能遠端證明使用者Windows當下已載入哪版。
  備份/資產manifest/HTTP核對在 `pb-test.local/legacy-mouth-20261117-1812`，index SHA
  `5aeb0d1540119bbc8df253e043e03230fe0bc6e30251797795c9af667c5090fe`。
  LAN HTTP入口及其module逐檔核對成功；公開HTTPS本次回應不一致／403，未完成
  遠端內容驗證，勿宣稱公開入口已核實。請依管理面板嵌入release確認機台版本。
  未強關現場／重啟API／更改DB或模式。仍需Windows真人閉嘴＋旁人講話驗收；這是
  幾何活動門檻，不是聲源辨識，不能保證同時開口時排除旁人。

## 2026-11-17 舊 ASR 嘴部活動先行（已發布；Falcon維持原流程）

- 使用者確認舊模式採「MediaPipe嘴部活動→VAD→完整句→舊ASR」，後來明確縮限
  **只改舊ASR、Falcon保持原流程、Falcon不用再測試**。請勿重新把前置門檻套到Falcon。
- `services/mouthActivity.ts`以單一ROI嘴部幾何的連續變化放行，不裁圖。0.02 aperture
  變化且開口>0.025、250ms freshness、600ms onset window；位置/比例突變、缺臉、
  多臉、停格、相機／接待重置撤銷原capture lease。這是幾何連續性，不是身分／聲源證明。
- `useKioskProactiveVision`重用Face/Pose單lane，舊ASR只輸出新解碼影格的geometry；
  舊模式沒有mouth images。Falcon仍原VAD與capture檢查、裁圖25fps、原padding。
- `BaseVAD.processAudio`新增可選第四參數allowSpeechStart；`useVAD.canStartSpeech`
  對普通AudioWorklet與外部UMA PCM都生效。關閉時不推論、只留bounded pre-roll，
  已開始的句子繼續到正常靜音。整個PCM狀態更新與推論序列化；跳過音訊後清除RNN舊狀態。
  Kiosk僅舊ASR採至少400ms pre-roll與送ASR前lease驗證；截斷整句丟棄，尾段只找靜音，
  不建立客戶操作。Falcon/admin測試不套此新gate，padding原值保留。
- 舊ASR顧客語音現在需要相機與有效嘴部；文字輸入與admin麥克風測試保留原行為。
  README/UI共享契約與zh-Hant/en失敗訊息已更新；沒有新增依賴、後端改動、模型權限或UI設定。
- 使用者縮限後的限定驗證：舊ASR嘴部/原presence 11項、VAD含external PCM接線9項、
  真Chromium camera/Canvas/AudioWorklet 2項，共22項；Kiosk/UI scoped types、lint、
  production build過。未再跑Falcon測試／全倉typecheck／commit。未做Windows真人嘴型驗收。
- 已發布現用 `/var/www/airi/kiosk`，先資產後原子index，保留舊hashed資產供開著的頁面。
  備份與manifest/deployment/HTTP核對紀錄：`pb-test.local/legacy-mouth-gate-20261117-172423`。
  入口index SHA `64a44e12583bb4e4f59e54dcf5d13fe7d20ae253e5a8166bec48973d750abcce`。
  首次copy碰到三個同內容唯讀舊asset，index已回復；改為核對同hash略過後成功發布。
  API DB/Redis ready、未重啟／未強制reload／未換包／未操作設備或商家訂單。現用修正版EXE
  在無未決點餐時關閉重開即可載入新前端；不需再次執行LAN activation腳本。


## 2026-11-17 Windows EXE randomUUID 啟動競態修正

- 使用者在新版Windows EXE回報 `crypto.randomUUID is not a function`，位於
  interactiveServiceClient.activateTransport。打包版先await設定讀檔，LAN安全origin
  Chromium開關可能晚於ready；原Linux未打包驗證沒有這個await分支，未覆蓋此錯誤。
- 先用真Electron生命週期重現：晚設開關時secureContext=false、randomUUID與mediaDevices
  undefined；早設時全部恢復。將精確LAN origin開關移到main同步頂層、所有await之前。
  不改API／不重啟後端／不加crypto polyfill／不擴大其他HTTP origin權限。
- 另組同版真正packaged Linux resources/app與kiosk.settings.json啟動（既有AppArmor
  profile、獨立XDG_CONFIG_HOME）；randomUUID實際產生UUID、mediaDevices/AudioWorklet/
  native bridge有效、API readyz200/DB與Redis ready、無頁面執行錯誤。測試視窗已關閉。
  證據在 `pb-test.local/lan-startup-regression/{late,early,packaged-fixed}.json`。
  未做實體Windows驗收／配對設備／操作商家購物車。
- 最新修正版Windows ZIP：
  `pb-test.local/lan-connection-20261117/windows/Webnavior-Kiosk-Windows-x64-20261117-161811.zip`，
  SHA256 `150adc930a0117e7c2d9350bb8d2cad4d6c260725e61c257364f5aac440c83d8`。
  取代先前154821包；19項desktop測試、scoped types/build/lint與81檔manifest核對過。

## 2026-11-17 Electron 區域網路入口與可攜包（已啟用／重新打包）

- 使用者指定服務主機 `100.92.1.80`；正確入口
  `http://100.92.1.80:5169/kiosk/`，Nginx5169代理本機API5168。實測入口200、
  `/readyz` DB/Redis ready；80 port的 `/kiosk/`是404。
- Desktop預設、Ubuntu共用啟動器、新Windows包皆採此入口。僅此origin的
  `/kiosk/`有HTTP例外；啟動前精確origin的Chromium開關使media/AudioWorklet可用，
  原host權限與sandbox保留。Production Kiosk API/Server URL隨入口origin，
  公開HTTPS與LAN共用同一bundle；dev env保留。改origin需新設備配對，不搬cookie。
- 後端僅對精確LAN origin放行PIN/POS及HTTP設備/管理員cookie；公開HTTPS仍Secure。
  使用者重試activate.py後已啟用：實際runtime兩個route檔SHA匹配prepared，
  HTTP入口index匹配LAN建置，API Active/running且NRestarts=0。
- 首次啟用失敗源於fallback runtime兩個Eventa連結指向已移除的pnpm peer目錄。
  已將runtime的 `apps/server`與 `packages/server-sdk-shared`內Eventa連結改指repo相應
  套件的穩定node_modules連結（同beta.8）。修復紀錄與保留備份位於
  `pb-test.local/lan-connection-20261117/`。activate.py會重啟前檢查依賴、
  驗證完整回復後才封存舊備份供重試；三項腳本回歸通過。已成功啟用請勿再次執行。
- 本輪重建Desktop並重新打包：
  `pb-test.local/lan-connection-20261117/windows/Webnavior-Kiosk-Windows-x64-20261117-154821.zip`，
  SHA256 `7e35f14785b05b5e830ee683105cf52a7a7f66c41dfb32387550e6381966f9b3`。
  81檔manifest雜湊、三個compiled payload與LAN設定核對過；快速使用說明同步LAN網址。
- 真Linux同版Electron以獨立profile載入實際LAN入口：native bridge、secureContext、
  mediaDevices與AudioWorklet均有效，無頁面執行錯誤；bootstrap實際送
  `http://100.92.1.80:5169/api/kiosk/bootstrap`回401（未配對的預期結果），
  同頁readyz回200/DB與Redis ready。未建立設備／下商家訂單／拷貝憑證；自己的測試
  Electron user service與瀏覽器已關閉。證據 `electron-api-verification.json`及
  `package-verification.json`在同staging目錄。未做Windows硬體／登入後點餐驗收。
- 本輪Desktop19項、scoped typecheck/build過；前輪PIN6項、POS聚焦1項、
  manager19項與相關lint過。未執行全倉typecheck／commit。

## 2026-11-17 點餐流程整理與跨地點 PB 測試站（公開入口已驗證，Windows待複測）

- 使用者澄清整理範圍為今天的「點餐過程與流程」，不是收音／Falcon；要求 PB 自建測試頁可從不同地點的電腦瀏覽器使用，並同意沿用既有 uuid。當日完整旅程與失敗逐項核對已整理至 `docs/plans/2026-10-28-windows-kiosk-electron.md` 最上方，保留 C01/C02 未完成、19 步中手動換客、`detailsVerified=false`、讀回失敗雖自動恢復仍先請顧客核對，以及現場未知單未核實等界線。未修改點餐同意政策。
- PB fixture 納入 workspace（uuid／Vite／Vitest，無新套件版本）；手動頁面以 uuid 取代安全 context 限制的 randomUUID。Vite 支援明確 origin、公開 base `/pb-test/`、preview middleware 與歷史路由；資產全部打包且不 inline SVG，以符合既有 self-only CSP。API 依明確 Host 與同源 Origin 驗證，付款 URL 採實際 origin，不回 loopback。Shared 僅新增精確公開部署，保留商家／測試 binding 隔離；舊 EXE 內的允許清單尚未換包。
- 已建置並啟用獨立 user service `webnavior-pb-public-site.service`，僅監聽 127.0.0.1:5198。使用已凍結 `pb-test.local/public-pb-20261117-142344/dist`；本機既有 5188 與新公開服務 session 分開。公開入口 `https://webnavior.aikcitri.qzz.io/pb-test/`，提供 PB 手動頁及執行器相容檢查，不是另一套 AI／語音 Kiosk。
- 17:12–17:18 續查：Nginx 設定已含公開測試站片段、user service active，實際 HTTPS 已回 fixture（先前 17:02 仍回管理 Web）。本輪未執行 sudo／改 Nginx／重啟服務。唯讀確認共用場域最新 release 38 的 `orderingSites[pb-local-test]` 已使用公開 select-table URL（79 台設備指派 revision 38，另有舊版指派）；本輪未發布設定或切設備。Windows 還顯示 127.0.0.1 時需關閉重開，若仍舊需依設備指派追查。161811 ZIP 中 main 與 native pb.js 都包含精確公開部署，不需因這次網址切換再重包。
- 驗證：本機 fixture 7 檔47項、Shared journey7項、Shared scoped types、限定 lint、shell 語法與 production build 過。隔離瀏覽器使用公開 origin 映射至新 loopback preview，選桌→加魚丸湯→發票通知→只送1筆→模擬付款→重載保留→第二個瀏覽器0訂單，公開 prefix 與同源付款連結過；`/tmp/pb-public-preview-verification.json`。本輪另用實際 HTTPS 瀏覽器完成 A1→魚丸湯1份50元→假Email→1筆TEST單→同源模擬LINE Pay成功→重載保留，截圖 `/tmp/pb-public-paid-verification.png`。17:16–17:17同站內建PB執行器九項相容檢查全部通過（含跨列部分換餐、加量保留、測試後購物車歸零），`/tmp/pb-public-compatibility-verification.png`。fixture單元／網路26過、需local opt-in的21項skip；sandbox listen EPERM後在host重跑通過。這不是Windows EXE或實體語音驗收；正式PB選桌後購物車初始化錯誤仍待查，本輪未處理。本次無全倉 typecheck／commit／商家寫入。


## 2026-11-17 現場九項問題：招呼／公告／提示音／發票回圈／送單與重置（已發布，現場未知單仍鎖定）

- 使用者強調九項為真實現場狀況；目前EXE版本回答「不確定／其他版本」，09:50 A1桌130元那筆回答「還沒核對／無法確認」是否成立。不能宣稱現場九項已驗收或直接清掉該單。未重送、未清空、未遠端重啟現場。
- 唯讀DEV-642583：greetingEnabled=true、observationEnabled=false、triggerMode=mixed、VLM0，所以人物觸發招呼根本不會進入。Scene新增無觀察且招呼開啟時、mic listening＋service ready＋standby＋cart admission通過的一次welcome，singleflight；保留觀察關閉，不借Falcon偷偷開偵測。未實體現場聲音驗收。
- 實際上一筆接待`l-Lxfkcx7mpADeqGPe_iv` seq710（09:50:28）最後submit步驟已dispatch，5秒沒route變化→unknown。後續`DQAI2z-9p1MyOjBL-x7eC`／`p_pn5KHrSpOfbacJEvCb8`僅cart_get/present/recovery_context，沒有customer_reset呼叫，order marker確實擋住重置。這不是已證明的網路斷線或未送單；不能把未知單當未成立。私密`/tmp/field-{nine-issues,order-errors}-private.jsonl`勿打包。
- Native order effect的單次驗證等待由5秒改30秒，普通UI仍5秒，從不重按；slow6s red→green。無法證明現場那筆已成立或未成立。recovery_context新增optional blockedBy(order/reset/cart/operation)，Host在table/cart都先核對reset barrier，order明確要求人員核對PB紀錄。仍不解除order/reset未知鎖。Main與Jev兩條failure路徑皆保留order unknown證據，不再叫顧客反覆打開購物車；已知no-effect拒絕保留具體欄位提示。
- Start後Host讀menu加forAdmission，Native在fresh cart讀回後以既有controls.dismissAnnouncement按唯一原生「我知道了，開始點餐」。僅關店家公告，不碰商品/送單dialog；readOnlyHint仍代表無merchant cart/order effect。完整audit新增公告已關斷言。
- processingCue每次accepted capture重開receipt，正在等待音樂時可插提示音；TTS仍互斥，期間新capture延後到TTS結束。等待music缺檔或fetch失敗不再連帶禁掉chime；manifestdisabled維持靜音。17 Chromium過，既有兩個「多句不再beep」預期隨明確契約更新。正式音訊資產另作唯讀核對。
- 通知手機本來支援語音分段與覆誦同意後填入；載具掃描後「好了」只續讀draft不送單。完整隔離19步現在用「好了」（取代ok）＋實wheel/點手機/鍵盤＋0912/345/678→正確→最後好，1提交/1訂單/0重送、下一位A03可點。其不是現場ASR/Windows實機驗收。證據`/tmp/field-nine-journey.{json,log}`；同時注入nullable pickup/一次readback failure，auto recovery無觸控通過。現場6/7仍需確認確實換新版後複測；Email仍須畫面輸入。
- 驗證：native checkout/controls Chromium41、cue Chromium17、flow/dialogue/retry/greeting unit273，Kiosk/StageUI/StageShared scopedtypes、scopedlint及兩origin build過；無全倉typecheck/commit。`/tmp/field-*.log`。新Main未知單轉譯只再跑unit，未重複happyflow；前一輪19步在同一native與發票碼通過。
- 已發布本機／正式，備份`pb-test.local/field-{local,public}-kiosk-20261117-101645`；正式entry`/kiosk/assets/index-BSjPu6TQ.js`、indexSHA`aa50b41369821c84496ddc4b895495c75575d48417925805ab4ed13e014ce0a2`，HTTPS入口/UMA worker/worklet/notices/APIready核對`/tmp/field-public-verification.json`。build`/tmp/field-{local,public}-kiosk`；未改Server/DB/provider/PIN。
- 新Windows`/tmp/Webnavior-Kiosk-Windows-x64-20261117-101409.zip`，163743149 bytes，SHA`4ae300af980e303d96a5762ffffad0512be92289d1847bc4d78601bc60ec969c`。runtime固定SHA/PE/CRC/manifest、native三payload逐檔比對過，latest-windows-portable.json已更新。原生30s/公告/recovery新增欄位要換整包；公開前端更新不會改舊EXE的pb.js。換包也不會自行清掉現場那筆order未知鎖；實際核對仍待現場。

## 2026-11-17 正式同步、語音接收回饋與管理者即時監看（已發布）

- 使用者明確要求先正式更新，並強調營運中管理者要知道狀況、技術診斷不能給顧客看。先發布已驗證的恢復/鍵盤/站別修正（備份`pb-test.local/ordering-release-public-kiosk-20261117-095407`），再發布本輪語音＋管理後台。無強制reload/restart現場機台，無DB/Server/provider/PIN變更。
- 確認`KioskScene`的`falconRequestActive`在上一句HTTP未回時直接丟下一句；已移除。每句先freeze獨立影音packet，沿用既有有界utterance FIFO（最多active1+pending4）收音順序；ASR可重疊，決策/網頁操作仍串行。captured packet不受後續ring改寫，timeout/reset照既有signal取消，不能重放訂單。新增多packet＋晚句先回可立即顯示而執行仍FIFO的測試；未實體mic/遠端Falcon並發驗收。
- 顧客端只新增「已收到語音，正在辨識…」與「已辨識，等待處理」；完整ASR文字回來即顯示，不等Main/工具。`recordTranscript`既有dedup邊界也在ASR回來時先記錄，讓管理者不必等前一項操作完才看得到。`voice_recognition_started`與`voice_recognition_timing`只存服務事件（utteranceId、mode、requestMs、elapsedMs、audioMs、packetBytes、submitted），後者不加原始影音/文字。elapsed是端到端ASR請求，不能當模型compute；既有utterance_timing仍是後續判斷/工具clock。
- 語音/decision/idle/presence診斷及數字執行耗時現在須`adminPanelOpen && isKioskAdminSessionActive`才顯示；顧客頁不露技術overlay。開本機設定會取消接待work（既有行為），因此營運中監看應用另一台電腦的`/admin/kiosk/history`。
- 管理後台歷程新增「即時監看」checkbox，每次完成後3秒再refresh，無重疊、關閉/離頁abort。只GET清單與目前選定接待，保留畫面，錯誤保留舊資料並顯示重試；site/session/generation隔離遲到response，選別筆/刪除時不覆寫。沒有自動切走管理者所選接待；新接待要選新row。ASR開始/耗時以人可讀文字顯示，其他原始服務事件維持原行為。新細項要機台載入新前端後才產生，不補造舊資料。
- 現場唯讀DEV-642583接待`l-Lxfkcx7mpADeqGPe_iv`17筆task timing：進判斷前median5.14s/max31.97s（ASR+排隊混合，無法拆）、Jev median1.07s/max1.88s；admission後最終文字median15.85s/max23.27s含工具，不能直接說模型慢。私密原始`/tmp/field-speech-latency-private.jsonl`0600勿打包，read script `/tmp/read-field-speech-latency.py`。
- 驗證：KioskConversation Chromium15、Falcon/FIFO unit19、後台refresh/record顯示Chromium3過；Kiosk/Web scopedtypes與scopedlint、兩個production build過。一次Kiosk typecheck抓metadata不允許recognitionMode，改現有source欄；lint處理closure前定義與imports。無全倉typecheck/commit。主要紀錄`/tmp/speech-{receipt-tests,fifo-tests,admin-tests,release-kiosk-types,release-web-types,release-lint,release-final-lint}.log`。
- 最終正式Kiosk備份`pb-test.local/speech-release-public-kiosk-20261117-100016`，entry`/kiosk/assets/index-Cvo_Az2S.js`，indexSHA`fb24399a5a6443c98fb9a02849d1d74626ce4b3fcfc831950ed063c03913a662`；管理Web備份`pb-test.local/speech-release-public-web-20261117-100016`，entry`/assets/index-CQTcR7OY.js`。HTTPS入口、UMA Worker/Worklet/notices SHA、APIready與history route/entry SHA過，證據`/tmp/speech-release-{public,admin}-verification.json`。先前Python預設UA查公開曾403；deployment UA與curl後續均200。無本機443 listener，直接loopback443失敗並非公開故障。本輪build`/tmp/speech-release-public-{kiosk,web}`；本機static仍前節site-select，源碼dev可載入新行為。
- 新Windows整包`/tmp/Webnavior-Kiosk-Windows-x64-20261117-095228.zip`，163742949 bytes，SHA`3047054f3cece516245db4e0cd3404312c93d4b49939fb41d7274cbc6477b31f`。fixed runtime SHA、PE、CRC、manifest與三payload逐檔比對現在native build過；`/tmp/latest-windows-portable.json`已更新。此包內含前輪native恢復/浮動鍵盤，語音及監看從公開網頁載入。使用者營運中未強關機台，待訂單結束後完整退出、解壓新版整包啟動；091109舊包仍缺native修正。無Windows實機驗收。

## 2026-11-17 正式／測試站選項標示與白底選單文字（本機已更新）

- `deviceSettingsEditor.vue`原生select先前透明底＋繼承管理面板白字，展開成系統白底時文字看不見。所有該editor的native select/option明確light color-scheme、白底深字。依既有`readPbJourney`目的地識別PB正式／商家測試／自建測試，選項含名稱＋origin，預設選項明示解析的第一站，下方列完整URL及環境說明；不改site ID／設定值／進行中訂單切站門檻。i18n zh-Hant/en新增標示。
- 已說明招呼可由「互動體驗→開場招呼→固定歡迎詞」修改、儲存發布後reload；VLM方式用開場指引。PB選桌標題/提示仍`orderingMessages.ts`固定文案，沒有獨立後台欄位。未新增schema/config或擅改使用者台詞。
- red→green Chromium新增站別/未hover對比測試過；整檔12過1失敗，失敗為原有`背景音判斷`預期不顯示，但修改前genericSettingKeys已顯示該欄（既有過時assert，未擴大修理）。針對本次test單獨1過；Kiosk scopedtype、scopedlint及build過，無全倉typecheck/commit。紀錄`/tmp/site-select-{red,tests,targeted,types,lint,build}.log`。
- 本機靜態build `/tmp/site-select-local-kiosk`已發布，備份`pb-test.local/site-select-local-kiosk-*`；未更新公開/Windows。上一節native pb.js仍有效。本輪只有前端變更，重新載入本機Kiosk取得；未強關程式、未改DB或訂單。

## 2026-11-17 本機自動恢復、浮動手機鍵盤、測試橫幅（本機已更新）

- 使用者明確要求客人不應按恢復；本機DEV-477391在09:18加炸排骨便當後讀回報`Expected string but received null`，結果未知被鎖，後續語音重複SERVICE_UNAVAILABLE。私密唯讀紀錄`/tmp/local-reconnect-private.jsonl`勿打包。並未證明真正斷網或確切nullable欄；商家既存JS容許pickup date/time空值。本次parser接納明確null、採同頁fresh menu defaults，其他錯誤型別仍拒絕。
- `pbCart`保留單次add/edit的完整預期結果；同document fresh cart精確吻合才解除自己的UUID marker，從不重送。不解除order/reset/foreign marker；跨reload遺失預期驗證的舊未知單仍保護。`interactiveServiceClient`可在首次discovery失敗後重連。Kiosk由`useKioskServiceRecovery`等操作settled後最多3次只讀恢復，接待/document generation隔離遲到回應；不重複顯示相同fallback。客人無恢復按鈕，管理面板才有；失敗明確請現場人員核對。
- 手機鍵盤改native manual popover浮動、可關閉/重開，不撐開商家表單；對側放置，真實欄位input/change，無隱式submit。完整流程先抓到浮層遮住送單的回歸，已補red→green：draft ready或submit前`invoiceInput.leave()`收合且保留值，抑制focus restoration自動重開。舊失敗證據`/tmp/reconnect-keypad-obstruction-before.{json,log}`。
- 自建pb-order-lab原本有橫幅但會捲走，現固定sticky，顯示「自建測試環境｜非商家正式網站／不會扣款或傳送店家訂單」，header/cover明示測試站；menu捲動及cart瀏覽器測試過。
- 驗證：pbCart56、native keypad/checkout Chromium19、interactiveClient Chromium19、KioskConversation Chromium14、recovery/retry unit30、banner1通過；Kiosk與StageUI scopedtypes、scoped lint、Kiosk/native build通過，無全倉typecheck/commit。原生完整19步`/tmp/reconnect-nov17-journey.{json,log}`同時注入nullable pickup及一次無效readback，`automaticRecovery.recoveredWithoutTouch=true`、原餐點1份、最後fixture ledger 1提交/1訂單/0重複/0付款，重啟下一位A03可點。僅隔離fixture，無商家實單；真mic未接與TTS upstream503仍見測試log，不代表語音實機驗收。
- 本次只發布本機Kiosk（使用者說本機），備份`pb-test.local/reconnect-local-kiosk-20261117-094302`，entry `/kiosk/assets/index-BIy4Fyxu.js`，index SHA `3cb7f86122713ccaf402fc3f048f67217a5c020f390240abc5cb1c9106b80bee`，HTTP主入口/資產核對`/tmp/reconnect-local-verification.json`。build在`/tmp/reconnect-local-kiosk`，native `apps/stage-kiosk-desktop/out/service/pb.js`已重建；本機Electron須完整退出再開才載入native。未強關使用者程式、未清他的購物車/登入、未改API/DB。公開及Windows ZIP仍下節舊版，尚未帶本輪修正。
- 曾提議複製browser Cookies唯讀查商家，但自動審核因credential reuse拒絕，命令未執行；改採本機紀錄與自有隔離fixture，勿重試該憑證方案。

## 2026-11-17 三點結帳卡住／通知手機觸控鍵盤（已發布，Windows需換包）

- 使用者後續明確要求「更新部署」。本機與公開Kiosk已發布；備份`pb-test.local/checkout-local-kiosk-20261117-091110`、`checkout-public-kiosk-20261117-091122`。公開entry `/kiosk/assets/index-DuoD7aNN.js`，index SHA `6bbbc075938d7dda77e770fda492c63e6c29f90150a8ce4eaa533fdabd13a9b0`；HTTPS entry/UMA Worker/Worklet/notices SHA與API ready核對通過，證據`/tmp/checkout-public-verification.json`。未改API/DB/provider/PIN，不需重啟API。
- 原生服務已重新build並重包Windows可攜版：`/tmp/Webnavior-Kiosk-Windows-x64-20261117-091109.zip`，163742313 bytes，SHA256 `79ad8059dfcd79aa952518c7fc6545b6f0925cf56d66010ec6f5d9e45cea2c3b`；`/tmp/latest-windows-portable.json`已更新。固定官方runtime SHA、PE x64、ZIP CRC及全部封裝檔雜湊通過，三個payload逐檔對照目前build一致。未commit，package manifest中的gitCommit不能當作未提交修正的來源版本，應依此成品SHA/檔案manifest核對。現場Windows須完全退出舊程式，解壓新版整包並啟動；僅refresh/重開舊EXE不會更新內含native pb.js。設備/登入在原LOCALAPPDATA，未清除；未遠端安裝或Windows實體驗收。
- 唯讀查DEV-642583，02:44–02:56（台北）636筆接待，私密原始`/tmp/checkout-0300-private.jsonl`勿打包：0988被要求完整號碼；「這樣就好」被轉成修改餐點；最後摘要反覆出現，未見送單工具執行。多句ASR已失真，不可宣稱已修好現場語音。
- Native `pbBrowserService`不再因wheel改cart manualRevision；`pbInvoiceInput.owns`從手機/email/目前載具欄第一個pointerdown即保留問題，鍵盤同樣受其擁有。其他手動操作仍保護；最終ticket仍比對完整form/cart fingerprint。通知手機label解析抽至既有pbCheckout.notificationField共用，避免按input type錯寫Email。
- `pbInvoiceInput`在真實通知手機欄附加3×4數字鍵盤（清除/刪除），只透過原生input/change寫draft，無submit；卸載/SPA換欄清除，disabled/readonly不寫。流程提示與語音通知手機引導在i18n；cart recovery明示下一步。Cart-review的「這樣就好／就這樣／餐點正確／餐點沒問題」僅進發票選擇，不增加最終送單同意範圍。
- 回歸先red→green；Kiosk Dialogue/OrderingTools/QuestionWindow共266、Chromium scanner/keypad/checkout19、Kiosk與StageUI scoped types、scoped lint及Kiosk/native bundle build過。StageUI首次types發現NodeList iterable，改Array.from後過，未動tsconfig。無全倉typecheck/commit。
- 完整原生隔離`checkout-flow`通過19步，新增真wheel→點手機→鍵盤清除後，0912→345→678仍續接，覆誦確認後完整摘要→另一次同意，fixture ledger 1次提交/1筆單/0重送/0付款；下一位A03可點餐。證據`/tmp/checkout-nov17-journey.{json,log}`。測試只暫換本機Kiosk，finally已還原。Native bundle重建在out/service/pb.js；本次Kiosk build `/tmp/checkout-kiosk-build`。當時未部署；後續發布與Windows成品以本節前兩點為準。未商家實單或實機ASR驗收。


## 2026-11-17 UMA-8 AEC3／LCMV 接線完成、仰角70°（已發布）

- 使用者已同意附件方案，本節取代下方「未選擇／未接AEC3/LCMV」。新src/audio依v2.1.6/MIT：48k8ch Worklet＋stereo playback reference→Worker AEC3(7mapped mics)→LCMV→補償1024樣本延遲→61tap FIR雙路16k。gain/limiter僅mask供Silero；Falcon記AEC後mapped第6路raw，legacy記gain後mask。未改Jev admission/TTS interruption政策、相機、訂單授權或辨識模式；一般mic仍browser processing。
- 本機偏好kiosk/audio/microphone-processing：auto(UMA-8 label)/uma8/standard；三仰角70°、azimuth0/-90/+90、radius44mm、mapping0..6、gain15、loading.03。PIN0000面板「本機麥克風與喇叭」新增處理設定，變更重建並丟棄半句。array要求raw8/browserAECNSAGCfalse，settings8+ECfalse及Worklet真8ch雙重檢查。inputConstraints由Scene擁有/cleanup，原surface無覆寫；明確channel layout的catch不換其他mic。
- useVAD新增externalPCM（不另建AudioContext/resampler）及processAudio(detection,endTimeMs,recording?)，recording等長用於prev/main/overflow，機率仍由detection推論。第一Worklet source startTime映射performance再加sample offset，不用Worker/VAD完成時間。startup有attempt/controller隔離；主watch用mode/max key，避免10秒policy poll重啟。
- Kiosk mount前共享context固定48k；playbackReference registry把customer/admin TTS及cue/wait music接同bus，capture可晚於已播放source建立。來源transfer queues每邊界限約1秒，Worklet也有ack credit防UI卡住無限堆積；錯誤/abort/unmount/設定變更terminate Worker、detach bus。AEC3 WASM固定16MiB，另有DSP/VAD/嘴圖模型記憶體，不可當整個Electron僅16MB。
- catalog固定webrtcaec3.js0.3.0/fft.js4.0.4，加入Eventa與既有AudioWorklet types。AEC3裸賦值在strict ESM真browser拋錯，patch只加var宣告兩行（注意在license閉合行後）；正式patch/lock/notices納入。Eventa id/type/body集中captureProtocol，Worker/main用Context；AudioWorklet沒有AbortController，直接使用同一Eventa declared envelope，無global polyfill。依賴重連及sdk-shared owning build已修復安裝後舊dist型別，不改tsconfig；pnpm-workspace僅3行新增。
- 通過25 Chromium（真8ch AudioNode→WASM/LCMV/16k、cue/TTS各證明referenceSignalFrames增加、70°UI/持久化、普通mic/speaker、clock）、15Kiosk unit、11Shared unit、Kiosk/StageUI scopedtypes、scopedlint與兩origin build；後續移除多餘fallback/收緊mapping regex後DSP3項再過。native隔離search-missing完整通過 /tmp/uma8-ordering.{log,json}。未全倉types、無commit。Synthetic MediaStreamDestination會降2ch，測試採原參考AudioNode邊界；不可當USB驅動驗收。
- 最終正式asset smoke /tmp/uma8-built-worker-smoke.{mjs,json}從入口importgraph定位：Worklet8ch/384samples、Worker4個512pcm、referenceSignalObserved=true。公開entry/Worker/Worklet/notices逐檔SHA及APIready證據/tmp/uma8-public-verification.json；entry index-BH-vhdcy.js、Worker capture.worker-Dx4OmM-3.js、Worklet capture.worklet-CXgFx3YF.js。
- 已發布本機/公開，備份pb-test.local/uma8-local-kiosk-20261117-034715、uma8-public-kiosk-20261117-034719；公開indexSHA f0bca005faeacd720e5d14b56c1c00501a61e36e778b5500076661d1f6a345f0。無Server變更/restart、無EXE/ZIP重包，8767及PIN0000不變。Windows642583需完全關閉重開，選實際UMA-8及auto/強制uma8；實機echo/插嘴/效能仍待現場驗收。用法與公開API文件已更新Kiosk/StageUI README。

## 2026-11-17 DEV-642583 對齊警告、8767 與服務問答 SSE

- 使用者確認警告出自642583語音辨識、硬體UMA-8。公開現行並沒有附件AEC3/LCMV，只有browser processing+Silero，已明確告知，不可把仰角70欄位當已生效。使用者詢問目標鏈UMA→AEC→LCMV→增益→VAD，已回覆正確，且Falcon送AEC後mapped第6路，LCMV+gain僅VAD。已詢問是否沿用附件webrtcaec3.js/fft.js，使用者目前只追問此鏈，尚未明確選擇。LCMV/AEC3接線及顧客/左右抑制70°仍未完成，不可宣稱已接好。
- 8767 ready且3秒plain影音/JSON text與Webnavior gateway實測通過；公開ConfigKV只改baseURL8766→8767，保留mode=falcon及key/其他設定；本機也改8767但保持mode=legacy。私密前值/tmp/falcon-8767-{before-private,local-before-private}.json，不打包。health engine=onnx，未列GPU provider，startup synthetic inferenceMs30054，不可宣稱GPU已證實。Shared預設8767、gateway及Web browser expected值同步。
- 對齊回歸先red：VAD2秒前置非語音歷史先於可見嘴部，prepare拒絕整句。VAD新增preSpeechSamples；Falcon只在firstVisible不晚於speechStart時，為缺少的前置非語音使用第一張嘴圖補齊，音訊保留；實際speech缺圖/75ms距離不放寬。單元新增保留音訊且實際speech缺影像仍拒絕。此為重現的一種原因，尚非實機全部警告的確診。
- FalconCaptureError區分duration/mouth/timing，Scene另busy，各自中文/英文提示。diag啟用且已有visitorSession時，service_event source=falcon_capture只記數值reason/gap/相對時間/frames，無音訊圖片。便於重開後看642583真實錯誤。
- SSE原Server及Scene雙重context/browser封鎖。一般服務問答（serviceReply+readOnly，無requireMenuRead/handoff/pending question）現在強制工具空、plain reply、不經finite reply tool，Server可真delta，Scene信任server-safe事件，仍對stale/tool/question/outcome清除草稿。點餐/菜單查詢等仍live progress+verified final，未冒充全部點餐文字已串流。新route延遲DONE回歸先red後green；原withhold草稿測試仍過。
- 通過Kiosk84unit、VAD3unit、Server精準5route+8gateway/admin(另1遠端env skip)、Chromium14（含真worklet clock）、Kiosk/Server scoped types、scoped lint、兩origin build。曾啟動全route147但多分鐘無進度，僅以專用stdout確認後SIGTERM該vitest，改精準5項，不可宣稱147全過。未全倉typecheck、未commit。既有CRLF導致git diff --check報trailing CR，未修改無關app.ts。
- 已發布本機/公開Kiosk與API兩檔(route,Shared/settings)並restart既有服務，兩ready通過；公開JS /kiosk/assets/index-DQQTbqeC.js SHA314e514759cd2ed59add9de0513a74f3594608ee1e4f1418425033662146d469；證據/tmp/falcon-alignment-public-verification.json。備份pb-test.local/falcon-alignment-{local-kiosk-20261117-032042,public-kiosk-20261117-032150,api-20261117-032122}。無原生/EXE改動，Windows完全關閉重開。隔離native search-missing報告/tmp/falcon-alignment-ordering.{log,json}，完成結果見檔。


## 2026-11-17 麥克風重開未啟動修正、Admin 麥克風及喇叭選擇

- 使用者確認642583上方顯示收音管線未啟動，要求admin可選裝置，第二個裝置已明確澄清為喇叭/音訊輸出，非相機。真實audio_runtime快照18:56UTC：enabled=true/mode=falcon/policyLoaded=true/vadLoaded=true/listening=false/microphoneTracks=[]。原因：初始化列舉尚未就緒時未startStream，已保存enabled=true重開不觸發watch，prepareMicrophone只查權限且未實際取得擁有的串流。
- prepareKioskMicrophonePermission新增必需startAudioInput，grant後即使enabled原本true也顯式取得串流。Scene以原settingsAudioDeviceStore.startStream去重，並保留attempt/語音模式guard。回歸先red後green5項，文字模式仍不啟動連續收音，未改VAD/TTS打斷或Falcon選擇。
- KioskAdminPanel新增KioskMediaDeviceSettings：沿用現有mic store/VueUse enumerate/FieldSelect，選麥克風與喇叭、本機持久保存、重新偵測/連接、顯示是否有mic stream、用原chime測試喇叭。無相機設定變動。新增kioskAudioOutput統一路由HTMLMediaElement及avatar共享AudioContext；正式/招呼/管理員TTS及cue/wait music都讀同一output preference，缺失/不支援明確選擇報錯，不靜默改播別台；default仍可用。路由在播放前async完成，取消時不延遲重播。
- Chromium22項（含2真synthetic input/output整合＋原17cue/3speech）通過，測到保存true重啟取得live track、UI裝置保存、HTML audio/WebAudio路由和測試音。新增VITEST_FAKE_MEDIA=1 envguard，僅該測試process用Chromiumfake device/UI flags，不mock平台API。Native runner PB_AUDIT_AUDIO_DEVICES_CHECK=1只給自己的Electron fake-device，實際既有權限handler確認microphoneLive/nativeOutputSelected/graphOutputSelected全true；search-missing旅程全過 /tmp/audio-devices-ordering.{log,json}。Kiosk scoped types/lint及兩origin build通過，未全倉types。
- 本機/公開Kiosk均發布，備份pb-test.local/audio-devices-local-20261117-030745與audio-devices-public-20261117-030811。公開入口JS核對通過 /tmp/audio-devices-public-verification.json，indexSHA17099284bb42b0bfe94f8b29890d63d8a4ac83adf873062b672be3056fb78411。不改API/DB/provider/native/ZIP，無需換EXE、未commit。Windows需完全關閉重開，PIN0000進管理面板「本機麥克風與喇叭」。實際硬體收音/喇叭音量仍待642583重開驗收。

## 2026-11-17 DEV-642583 音訊資訊被原生菜單遮住

- 使用者接續回報「音訊沒有顯示任何資訊」。定位：KioskVoiceDiagnostics原fixed right/bottom落在menu-region，Electron WebContentsView蓋過DOM z-index；不是零事件就不render。新增Chromium幾何回歸先red（面板bottom超menu.top）後green；面板改放service-hero內absolute、含空事件的收音/VAD0%狀態，不改設定開關。
- Scene補麥克風權限/啟動/連接失敗文字。診斷已開且visitorSession存在時，既有service_event以source=audio_runtime記錄mode/policyLoaded/vadLoaded/enabled/listening/microphoneTracks(state/muted)/error；只在生命週期狀態變動寫，無音訊/影像/裝置ID/連續機率。目的是取得Windows實際失敗位置，不代表已修復麥克風。
- Scoped Kiosk types/lint及本機/公開build通過；真Electron隔離fixture以PB_AUDIT_VOICE_DIAGNOSTICS_CHECK=1驗證audioTop33/bottom129.14 < menuTop707.03，零語音事件仍顯示文字模式/未收音/VAD0%；完整search-missing旅程通過 /tmp/voice-diagnostics-ordering.{log,json}，非真人收音測試。新增runner參數只對自己的測試設備開啟diag。
- 本機與公開Kiosk已發布，備份pb-test.local/voice-diagnostics-local-20261117-024959、voice-diagnostics-public-20261117-025026，公開indexSHA734bba4eebb7b1bfe3e65956b50b18e9a9f1e8a98ddf39c60896a40dc1594917。無API重啟/native/ZIP/commit/全倉types。使用者已被請求重開642583並回覆上方黃色面板收音/錯誤狀態；可用/tmp/read-device-642583-runtime.py唯讀查生命週期快照。仍待此實機資訊，不可宣稱麥克風已好。

## 2026-11-17 DEV-642583 偵測有 ENGAGED，TTS 404 已修正

- 使用者回報人物/語音無反應，後確認畫面ENGAGED、招呼閃一下就消失、TTS一直無聲，看不到VAD數值。唯讀公開DB：設備jn0fHJBK9JWau5A2VVjeq無停用，observation/greeting/reminder=true、mixed、voiceDiagnosticsEnabled=true，site constrained/VAD threshold.5/pad2000/minsilence250。2:35及2:40確有proactive_greeting事件但無assistant_text，API同時/audio/speech 503；不是相機沒有偵測。
- 當前實際Redis辨識模式為falcon（使用者後續已切換，不是預設legacy），8766 health ready=true/busy=false。最初未帶Redis認證的docker redis-cli回覆被誤判為未儲存，之後使用server.env的真Redis認證確定mode=falcon；不得沿用最初結果。最後ASR文字約2:10，未取得Windows VAD/影音capture錯誤，不能宣稱麥克風已修好。
- TTS設定https://brtvngxfh6.aikcitri.qzz.io/v1、voice default；上游/v1/audio/speech404。Node fetch官方openapi確認根/audio/speech及/audio/voices，唯一voice yiting；根+yiting實測200/audio-mpeg/11493bytes。這與下方Nov14已知但使用者當時暫緩的問題相同，本次使用者要求查修語音已恢復處理。
- 已透過原AI control.verifyAndUpdateProfile修正目前選定TTS profile u_Dsaz6a5e0TU-Xo6U2ow的baseURL為根origin及voice=yiting（驗證成功）；只同步WEBNAVIOR_AUDIO_CONFIG.tts這兩欄，不apply其他capability草稿。前值備份/tmp/device-642583-tts-before-private.json(0600，勿輸出/打包)，腳本/tmp/fix-kiosk-tts-config.py。原gateway.speak實測200/10413bytes，ASR/Falcon前後相同確認，無API重啟/EXE變動/commit。
- 已請使用者完全關閉重開642583，確認真實招呼/收音；後端產音成功不等於Windows喇叭或麥克風驗收。收音問題仍需現場數值/錯誤或重開後結果；不要為此盲改VAD/觀測門檻或自動切回legacy。

## 2026-11-17 恢復 master 提示音與等待音樂，移除等待 TTS

- 使用者澄清要master的收到語句提示音＋處理中等待音樂，並明確取消「好，我幫您確認／請稍候」等待TTS。沿用master原始WAV、processing.json=true、useKioskProcessingCue及kioskPlayback；目前Kiosk不是master分支，先前發布缺這套接線。正式回覆及主動招呼仍用現有分句TTS。
- Scene在legacy/Falcon完整且獲允許的capture上傳前播放提示音，文字模擬只對ACCEPTED輸入播放；音樂涵蓋ASR/Jev/Main/工具/TTS準備。真HTMLAudioElement onplaying同步停止音樂，createSpeechPlayer新增onStopped通知；不在進入speaking狀態或僅開始合成時提早停音。新的pending語句可跨前一個TTS完成延續，無待辦時不重播；reset清除聲音所有權，admin/paused/fault/dispose停止。不改VAD、訂單授權、API或native。
- KioskScene已完全移除useKioskWaitSpeech及receipt預先合成/等待播放呼叫（模組本身未刪，無Kiosk等待TTS fallback）。音檔缺失時等待靜音，正常TTS保留；畫面進度文案仍在。每個處理時段先chime(0.4)，之後loop music(0.3)，忙碌中追加語句不重建播放器。
- Chromium20項通過，包含真原WAV載入、真TTS合成等待→onplaying停音、結束不重播及reset不復活；Kiosk scoped types/lint、本機/公開Kiosk build通過，未全倉types。原master測試的encodeComparisonRecording在本分支沒有，改用本分支既有createKioskVadRecording，不加相容export或mock匯入。
- 隔離真Electron search-missing旅程通過 /tmp/processing-cue-ordering.{log,json}，未建立商家訂單。公開HTTPS入口/JS與兩個WAV、processing.json逐檔核對通過 /tmp/processing-cue-public-verification.json。
- 本機15169及公開Kiosk已發布，備份pb-test.local/processing-cue-local-20261117-022948與processing-cue-public-20261117-023001；公開index SHA06494d3b98792d4e3b9a6eae25528067837ae1c07d3debcccad71fad901aab9f。無API重啟/設定變更/EXE重包/commit。Windows需完全關閉重開載入新版；實體喇叭音量、AEC及插嘴仍需現場驗收。

## 2026-11-17 管理後台左側選單固定

- 使用者澄清「跑版」為桌面左側選單會跟頁面捲走，非暗色模式。公開頁1280×800實際重現scrollY=800時aside top=-780。單用sticky無效，因Stage外層高度受限；AdminSidebar改保留w64欄位、aside在lg固定inset-y-0且overflow-y-auto，窄版維持原橫向nav。未改頁面資料或設定。
- scoped lint與兩種origin Web build通過；公開實頁確認fixed top=0，scrollY=800仍top=0，sidebarRight=contentLeft=276無遮擋；1280×300側欄scrollHeight430/clientHeight300且overflow auto；700px側欄static/nav row，已reset臨時viewport。未另增低影響CSS測試／未全倉types。
- 最終本機備份pb-test.local/admin-sidebar-local-20261117-015417，公開admin-sidebar-public-20261117-015422；公開index SHA c64eebd0e473ac9919205cba2e8587bd3d1a2f84e145049b10cdd8b80ca65cb8。前面的0152/0153是sticky中間版，以本節最終fixed版為準。已發布Web，不改Kiosk/API/native/ZIP，管理後台重新整理即可，未commit。

## 2026-11-17 PB 主動招呼狀態工具漏接

- 使用者確認Windows DEV-904267重開仍完全不招呼。唯讀核對公開設備已啟用observation/greeting/mixed，最近接待僅有browser_tool_metrics無招呼。程式確切缺口：startProactiveGreeting及sendAssistantAction所有狀態檢查只找owned Menu的kiosk_interaction_state，PB只發布browser_cart_get，因此永遠拿不到phase。不是ZIP拿錯舊版本；先前PB點餐旅程未涵蓋相機自動招呼，上一輪只修文字模式的判斷不完整。
- fixedGreetings.readGreetingPhase現在依目前能力讀PB或owned Menu。PB僅table（code核對）／ready menu且無product selector、無Host pending question可招呼；cart/checkout/signin拒絕，讀完重查pending。PB table映射ordering播放配置opening，不附owned phone hint，reminder排除table。Scene四個狀態檢查統一使用此邊界；原相機/VAD/ROI/停留時間未動。新回歸先red→green；聚焦20項、scoped Kiosk types/lint、兩種origin build通過；未全倉types，未Windows實機相機→TTS驗收。
- 本機／公開前端已發布，備份pb-test.local/pb-greeting-{local,public}-20261117-014724；公開index SHA b92e5c641d259dbe2a77ae8c228df0b3b280a52284b73ef07ab3c35e9569eb44，HTTPS module驗證/tmp/pb-greeting-public-verification.json。隔離原生PB既有點餐搜尋旅程通過，證據/tmp/pb-greeting-ordering.{log,json}；此為點餐回歸，不是相機→TTS實測，不建立商家訂單。無API/native/DB設定修改、未重新打ZIP、未commit；Windows需重開取得新網域前端。

## 2026-11-17 語音模式誤開文字視窗、停收音及阻擋招呼

- 使用者回報語音模式啟動文字視窗、相機開但麥克風疑未開、偵測到人未招呼。route 原本以 device textOnlyMode OR !profile.voiceConversationOnly 判斷，舊Profile false會蓋過已存的設備false；現在只採effective.textOnlyMode。Scene在文字模式保留相機觀測，但prepareMicrophone及allowsObservedVoice會禁止收音／主動招呼，因此同一模式誤判可同時造成三個症狀。未改觀測門檻或招呼時機，未宣稱已實機驗收。
- 原生隔離Electron先以舊build重現語音設定仍出文字窗，再以新build驗證語音無窗→文字有窗→語音關窗；接續完整search-missing旅程通過，證據/tmp/text-mode-{red,green}.{json,log}。runner現在明確把自己的隔離設備設為文字供輸入，不再依賴Profile。Chromium聚焦5項、麥克風／招呼／turn26項、presence policy25項、Kiosk scoped types及changed-file lint通過。較廣browser run有一項原有deviceTextOnlySettings舊斷言失敗（背景音判斷控制項現已存在），未擴修。未全倉types，未實體麥克風／相機／TTS驗收。
- 已同步本機與公開Kiosk前端，備份pb-test.local/text-mode-{local-20261117-013718,public-20261117-013923}；公開index SHA d3540aeb6185d80fd6f9ac6491b14f03b8b82a6bd53ce21ba21033e8f25c9855，驗證/tmp/text-mode-public-verification.json。API／DB／native未變，既有Windows EXE載入網域即可取得修正，不需重包；需完全關閉重開。這輪修改尚未commit。

## 2026-11-17 分批提交、網域發布與 Windows 可攜 EXE

- 使用者明確要求分批commit，覆蓋先前「不commit」限制。已提交：1b7cf18 後台備援/Falcon、1ba16ac 點餐搜尋/購物車/發票/送單/SSE、5a54dc3 Windows可攜EXE與Setup修正、fc2cf1b 管理器/部署文件。各commit hook檢查通過；未push。原有未提交修改均已納入。
- 以Electron官方resources/app可攜方式沿用46.0.0-alpha.2／Node24.22.1，未增加封裝框架/依賴。Desktop main改完整bundle，packaged啟動讀EXE旁kiosk.settings.json（可讀Notepad BOM，HTTPS /kiosk/、windowed、診斷port驗證）；Windows保留原LOCALAPPDATA/Webnavior/Kiosk-Pilot，開發環境原env流程保留。packagePortable.py核對固定官方SHA、PE x64、三個非空產出、ZIP CRC與每檔雜湊；無source/env/key/profile/node_modules。
- **交付唯一最終包**：/tmp/Webnavior-Kiosk-Windows-x64-20261117-011758.zip，163741396bytes（約156MiB），SHA256 f7889ef616d3f3ea539c4a6b94fee05b02b6247ab0e540dcc3dcaa9016df31b8；相鄰.zip.sha256，索引/tmp/latest-windows-portable.json。manifest源commit fc2cf1b。包內有Webnavior Kiosk.exe、預設公開網域JSON、Edit Settings.cmd、先看我.txt、管理後台.url；舊/tmp/latest-windows-source.json仍是舊原始碼包，不要拿它代替本次EXE包。解壓整包後雙擊EXE即可；仍需設備配對及商家登入。
- 新使用者錯誤紀錄已處理：JSON暫存版本探測正式提交；Runtime GET最多3次/180秒並套HTTPS_PROXY/HTTP_PROXY/NO_PROXY（認證分離，不輸出密碼），npm/pnpm 120秒/3次重試，符合版本pnpm及Runtime/套件快取沿用。Build驗證electron-vite與main/preload/pb產出；依exitcode判定，不因arrow2csv警告失敗、不建假EXE。來源PS以PSScriptRoot定位，相對Config以root解析，最後還原PATH與全部啟動相關env；GUI清除Node探測旗標。README說明Process範圍執行原則與公司政策。
- **公開已發布** https://webnavior.aikcitri.qzz.io：沿既有main-fallback runtime只更新9個有差異的API/Shared/prompt檔；/var/www/airi/web與kiosk已發布。備份/manifest在pb-test.local/domain-release-20261117-011847；原WorkingDirectory不變，正常systemctl restart成功，無DB或provider設定更動；公開及本機有效PIN均核對為使用者指定值，檔案保留不重建。API/db/redis ready，新Falcon admin route401保護通過。證據/tmp/release-domain-verification.json。
- 公開入口origin indexSHA：web 554e2433c79f1dcca69c4a021c990a094f7fd9a8060bc13c4ee25156d3177b33，kiosk 54c370e4a5acf8a7ecbf6c014d11dd6ffc03943fac49838be5b238be58f72fd9。Cloudflare會注入analytics beacon，HTTPS HTML整頁SHA因此不同；已比較所有本地script參照及遠端JS實體SHA，兩個entry module皆與建置一致。不是拿CDN整頁hash差異當舊版本。
- 驗證：全倉typecheck一次通過；全倉lint未過，2370既有錯誤在未修改檔案（chats、原kiosk-audio、研究文件、試驗檔等），不擴修；各提交檔hook通過。Windows PowerShell純邊界31組、Desktop26項及scoped types、Host搜尋/回覆162項、manager19項、建置通過。真正resources/app Linux封裝在本機與公開HTTPS啟動成功（packaged=true、Node/Electron正確、獨立profile），證據/tmp/release-portable-{,public-}smoke.json；隔離測試使用no-sandbox，產品EXE沒有添加該旗標。**不是Windows實機驗收**，實體麥克風/相機/觸控/公司Proxy仍需目標機器驗收，沒有程式簽章或自動更新。
- **Falcon影音模式仍停用**，此發布只有連線草稿、codec與response reader，不能宣稱同步擷取/轉送/歷程已完成。舊ASR保持運作；下方「公開網域尚未同步／沒有EXE封裝」的舊狀態由本節取代。C01/C02既有挑戰案例限制未在本次擴修。

## 2026-11-17 新版 Falcon 重測與連續／多餐點搜尋

- 使用者要求重測已部署Falcon並確認採新版。http://192.168.8.64:8766/api/falcon/health ready=true，模型已為falcon_spectral_dynamic.onnx；health仍報frames=[25]但已不是實際固定1秒限制。合成2/3/15秒plain frame count成功200，3/15秒由實際encodeFalconClip送出，samples分別48000/240000，回JSON text（靜音為空字串）；舊ONNX bit30標頭3秒被422拒絕。證據/tmp/falcon-new-codec-results.json。已移除codec的engine參數/旗標，統一新版plain N；引擎由遠端服務決定。不是真人影音品質驗收。
- 最新本機實際紀錄證實「章魚燒＋貢丸湯」只呼叫第一個search_menu_items，「棺材板＋魚丸湯」同樣漏第二道。根因是native查無結果status=clarification被Host當成待答問題直接結束整輪。改status=not-found並保留具名回執，投影為information_ready，Main可繼續；common skill明確逐一搜尋並整合回覆。新非空搜尋若先前有filter，先讀fresh完整catalog，清空搜尋並驗證所有cards恢復，再套新query（不是只看input已空）。未證實商家本身有交集篩選bug；此處以明確完整render避免前次filter殘留。
- 中途實測發現Main後續menu-unavailable/return_to_menu會蓋掉查詢結果；questionPresentation現在只對有browser_search的本輪保留查詢事實再接操作/政策結果，避免重複最後一道回覆。原生隔離自有fixture先red，修正後全配置Jev/Main旅程通過：兩道皆查無、混合查無/有魚丸湯、雞腿→查無招牌→有水餃，未加購物車／送單／付款。/tmp/search-missing-final.json為首次通過；最後去重版報告/tmp/search-missing-accepted.json。私密原始操作摘錄/tmp/latest-local-search-private.json不得打包。
- 驗證Host兩組162項、codec5項；Kiosk／Stage UI／Shared scoped types、scoped lint、Desktop/native與Kiosk/Web build通過，未全倉types。原生工具紀錄確認後續query有兩個search步驟（清除＋新篩選）。後台真實瀏覽器ASR dialog可開、Falcon設定前後一致PASS，最新說明截圖/tmp/falcon-asr-group.png已檢查。
- **僅本機發布**：Kiosk備份pb-test.local/search-fix-20261117-010631，indexSHA 3fa505802b68fe93328082f618514612b2bf87bf56daf28a9f41555ae1a9cd85；Web備份falcon-settings-20261117-010512，indexSHA 54d6ce512bb0804eb3c01346ef7edb820cf4211f1ca60d0e3daf21a886bd236a。manager-owned隔離API已reload；公開API/網域與Windows ZIP未同步。使用者需關閉重開Electron載入新版native工具。
- Falcon新影音模式**仍未啟用**：本輪更新codec/說明與驗證遠端可用，沒有完成前端同步嘴部擷取／整句轉送／歷程接線；現場保持legacy ASR。下方「2秒413、只接受1秒、response待確認」均由本節測試結果取代；不要用舊ZIP旗標對新版服務。

## 2026-11-16 Windows 版本探測第二版

- 使用者提醒先前stdout修正第二版；比對目前來源與上一ZIP，Assert-KioskRuntime仍直接electron -p擷取stdout。現改Start-Process -Wait -PassThru執行暫存inspect.cjs，寫versions.json；檢查exitcode／檔案／JSON／非空字串electron與node／精確指定版本。探測期間設定RUN_AS_NODE及NO_ATTACH_CONSOLE，finally先還原兩環境變數再清除獨立GUID暫存目錄；不改下載、SHA、pnpm與Build邏輯。
- PowerShell測試先red→green，23組通過，涵蓋成功、非零exit、缺檔、非法JSON、缺欄位、版本不符及既有／未設定環境還原、清理。真實Linux Electron Node模式JSON探測通過；不是Windows實機驗收。記錄/tmp/windows-runtime-{red,green,electron}.log，未跑無關TS/build/typecheck。Windows README同步；已重新打包目前來源，索引/tmp/latest-windows-source.json。

## 2026-11-16 商家送單權限修正

- 使用者回報Agent要求手動送單。根因是pbBrowserService硬編碼只允許127.0.0.1:5188送單，未對齊既有商家授權。Shared PbJourney新增明確canSubmit：僅app.esgpb.com/1kgJeql/internal_use及自有fixture為true；舊pick_up與RD保持false。Native服務使用該能力；完整摘要、獨立肯定答覆、120秒一次性token、cart/form/manual revision比對、送出前consume、防重送與付款隔離均保留。
- 回歸先red→green：Shared journey6項；Chromium checkout13項、Stage UI/Desktop scoped types及scoped lint/build通過。完整原生配置模型checkout-flow改預設商家origin，所有網路仍攔截至自有fixture，19步通過且ledger恰1次submission/1筆建立/0重送/0付款，證據/tmp/order-submit-merchant-origin.json。非商家實單驗收；測試內TTS上游503，不能宣稱語音播放通過。PB_AUDIT_CHECKOUT_ORIGIN=fixture保留本機origin模式。
- Desktop原生包已重建；公開/本機前端已發布，備份order-submit-public-20261116-202651及order-submit-20261116-202645。無Server變更或API重啟；使用者需關閉再開Electron才載入原生修正，Windows需新版來源ZIP重Build。全倉typecheck未跑。最新ZIP索引/tmp/latest-windows-source.json。
- 先前自動審查拒絕直接操作商家最後確認仍有效，本輪沒有以工具送商家實單或繞過拒絕；隔離測試與產品能力修正不可當實站送單證據。

## 2026-11-16 發票選項、欄位導引與分段通知手機

- 查實最新公開紀錄：購物車「正確」被Main誤編譯成choose_invoice_method=none，跳過選項；載具後雖換問手機卻無捲動/聚焦；0933/867/498被逐段拒絕。私密摘錄在 `/tmp/latest-checkout-private.json`，禁止包進來源ZIP。
- Cart review的有限肯定詞及checkout gate現在先消費原問題；generic肯定不能選發票（即使問題到期，也重新列出選項）。發票選項來自fresh native methods，全列供既有TTS朗讀。`browser_checkout_prepare.focus`沿用既有act/follower，指向invoice或next；有效載具後聚焦手機，無欄位寫入。Native phone填入後才prepare新摘要ticket，避免只回泛用核對文字。
- 新電話提示集中在 `packages/i18n/src/orderingMessages.ts`（zh-Hant/en），Host沿用既有zh-Hant ordering copy邊界。分段電話僅在notification步驟收集，query是唯一暫存；notification-phone/confirm綁visitor/document/cart及120秒expiry。保留0，可處理中文數字、空白/逗號、有限phone前綴、重來/否認；10碼09開頭逐位覆誦，確認後Host內部phone-confirmed才填入。未完整/超長/未確認皆不填；購物車變更/reset作廢，不從模型歷史猜電話。原完整phone公用工具仍不接受模型自行拼接的跨輪號碼。最終送單另有獨立同意，電話確認不送單。
- 先red→green：cart確認被選none、分段電話。Kiosk三組265、Chromium checkout13及Kiosk/Stage UI/Desktop scoped typecheck/lint/build通過；未全倉types。完整配置Jev/Main＋原生自有fixture `checkout-flow`19步PASS：五種發票選項、載具完成/焦點手機、0912→345→678→覆誦確認→填入→完整摘要→另一次同意→僅1筆fixture未付款單/0重送/0付款/新接待能點餐，證據 `/tmp/checkout-access-journey-final.json`。原首輪失敗是phone寫入未prepare摘要ticket，已修復；非商家實站送單及非實際麥克風/ASR驗收。
- 前端及Desktop已重建；發布備份 `checkout-access*`。僅Host/native service變更，無Server runtime或prompt變更，不需要重啟API。公開/本機靜態發布後舊Electron需關閉重開（僅refresh前端無法更新原生工具schema）；Windows用最新來源ZIP重Build，索引 `/tmp/latest-windows-source.json`。

## 2026-11-16 水餃購物車改10顆

- 實際公開session `59BtJjE_Xu6iKD8yTMbvP` 19:57「我水餃要10顆」：Main先set_cart_item_quantity=1，無變動卻回verified/已調整8顆；續replace piecesPerServing=10因舊程式只找「水餃」遭拒。失敗回覆保留前一筆錯誤成功訊息。原紀錄保存在DB；本機截取 `/tmp/latest-dumpling-session-private.json` 不得打包。
- 已在IAB原購物車點鉛筆實見「加量／水餃1顆／$8」，未存修改、未送單。以Shared `pbDumplingExtraName` 統一現行名稱，compiler／finite fastpath／Server Main及Jev plan／verified meal readback對齊；不猜未知選項或ID。未變動的set份數回proposal_rejected/dataOnly/no effect，允許Main修正工具，不能生成已調整receipt。
- Fixture原快照也過時，已對齊API、DOM、cart attrs及revision v6；不是只改斷言。完整原生配置模型情境 `dumpling-cart-edit`：加水餃1份→看購物車→「我水餃要10顆」，1列/1份/extra2/80元/正式回覆10顆/0訂單PASS，證據 `/tmp/dumpling-cart-edit-verified.json`。中間失敗保留：舊fixture DOM名未更新造成控制項核對失敗；未重建Main造成數值已改但顯示加量2個。Desktop已重建後才最終通過，舊Electron必須關閉重開；Windows用新來源ZIP重新Build。
- 目標測試Host267＋fastpath/drafts76（與前組有重複，不可加總）、Shared5、Server plan14、fixture25pass/20env skip；Kiosk/Server/Desktop scoped typecheck、scoped lint及公開/本機/Desktop build通過。未全倉typecheck、未實站送單、未驗Windows實機。舊snapshot native baseline PASS不算本次名稱修正驗收。
- 本機靜態備份 `dumpling-cart-20261116-200827/`；公開runtime只改Shared pbMenuPresentation及Server plan，備份 `dumpling-release-20261116-200936/`。公開靜態已發布，備份 `dumpling-public-20261116-201006/`；公開API已於20:10:10重啟，active及readyz/db/redis正常；發布備份以dumpling-public目錄為準。Windows最新包指標 `/tmp/latest-windows-source.json`。

## 2026-11-16 Kiosk SSE 文字呈現

- 沿用 Chat source `auto/sse/json`，無新增前端開關；模型實際傳 SSE 時，無 browser/finite reply context、無 commerce tools（僅 session history 例外）且可直接呈現的 service/greeting 回合可逐片顯示。JSON 一次顯示。PB 點餐／查價／修改／結帳仍顯示即時進度，核對 receipt 後顯示正式文字，不得宣稱所有 PB 文字都已逐字串流。
- `useKioskStreamingReply` 擁有 display-only draft，依 turnId 隔離；新 round、工具要求、失敗、取消／新訂單清除，舊 finally 不清新 turn；完成前不寫歷史或啟動 TTS。Scene 接入既有 callbacks；Conversation 與浮動文字 console 共用呈現文字，pending 無 draft 時不顯示前輪回覆。Server 依實際 tool policy 阻擋可能先文字後工具的草稿；未知工具亦不得放行。
- 測試：Server 路由146、Host相關161、Chromium17及router模式3項通過；最後 lifecycle3項通過（涵蓋舊清理不清新回覆）。原風險先 regression red→green。Kiosk/Server package typecheck、scoped lint、公開/本機build通過；未跑全倉typecheck／未做商家送單或Windows實機驗收。記錄 `/tmp/kiosk-sse-*.log`。
- 公開/本機靜態已發布，備份 `pb-test.local/sse-presentation-20261116-194724/`，保留舊hash。runtime僅同步 routes/kiosk/index.ts，原檔/SHA在 `sse-release-20261116-194714/`；本機API已reload，公開API已於19:51:39重新啟動，active/readyz正常。舊Electron需重載。Windows新版來源包索引 `/tmp/latest-windows-source.json`。

## 2026-11-16 十組困難情境實測

- 使用者把困難情境由3～5組改為10組，明確要求逐組實測。`scripts/pbTest/conversationCases.json` 現有8組basic及C01～C10十組challenge；basic新增直接問無關任務後回到點餐，並納入查價／總份數／刪餐。案例存在不等於全basic已驗收。`verifyKioskOrdering.mjs` 的 `service-boundary` + `PB_AUDIT_BOUNDARY_CASE` 每組用全新設備、配置Jev/Main及原生自有fixture，商家流量全部攔截，零商家送單／付款。
- 首輪 `pb-test.local/boundary-live-20261116-170420/`：10/10未通過，另加basic無關題也失敗。共同缺口是reply工具僅有泛用ack/查不到，無法正確表達服務邊界。修正後第二輪 `boundary-live-20261116-170929/`：**8/10通過**，另加A05 basic通過。C04斷言已區分「無法保證」的否定表述；runner不再替service-boundary額外跑無關idle收尾。兩輪原始結果均保留；報告 `/tmp/kiosk-challenge-report-20261116.html`。
- **未通過，不得宣稱完成**：C01「兩份雞腿換成一份排骨」實際成兩份排骨，兩輪皆重現；C02同句查水餃價+加雞腿/排骨+不要湯/先別結帳，加入正確餐點但漏回水餃價格，且把「不要湯」加成餐點備註。這兩項需要後續專門修復，不擴大本輪測試範圍。
- 新 `ordering-tools` 擁有 `customerReplySchema` / `servicePolicyReplySchema`，對齊模型JSON schema與Host驗證。8種有限政策回覆由i18n渲染，不做外部操作、不消耗待答餐點問題：off-topic、food-safety、promotion-policy、unsupported-budget/delivery/taxi、menu-unavailable、unsupported-permission。食安請現場人員確認但不假稱已呼叫；現價依畫面，不支援優惠券；拒絕總預算整套配餐，但單品價格上限查詢仍可。單元回歸先red→green，Kiosk259項、Shared20項、workflow4項及Kiosk typecheck/scoped lint/build通過；未跑全倉typecheck。
- 本機前端備份 `boundary-policy-20261116-170923/`；公開前端備份 `boundary-policy-20261116-171557/`。現行API runtime的Shared回覆合約與common skill已同步，原檔及SHA在 `boundary-release-20261116-171552/runtime-overrides.json`，不改原Main備援設定／DB。公開API需重新載入後與新前端配對，使用者需重新開啟舊Electron載入新前端。Windows新包包含目前工作樹及案例，最新路徑在 `/tmp/latest-windows-source.json`，舊ZIP不會自動更新。

## 2026-11-16 發票逐步引導與 Windows 更新

- PB 結帳已改為發票欄位→完成短答→通知手機／email→完成短答→完整摘要→獨立送單同意。Host只說當前步驟；OK/好了/資料填好了僅在已發布的資料填寫問題中觸發fresh form重讀，不授權送單。尚未填好仍留原步驟，拒絕時保留同一步問題供稍後繼續。型別/來源合約未變，無新依賴。
- BrowserOrderingTools回歸先red→green；OrderingTools/Dialogue/QuestionWindow共251項通過，Kiosk typecheck/scoped lint及兩種origin建置通過。完整配置模型+原生自有fixture `checkout-flow` 17步通過：載具/OK/通知資料/OK/摘要/另一次同意，只建1筆未付款訂單、0重送/付款，新接待仍可點餐。報告 `/tmp/invoice-stages-journey.json`，不能當商家實站證據。
- 舊 `apps/server/tests/experiments/kioskProviderReplay.test.ts` 是自建Order Menu回放，現已在檔頭及suite名稱明確標記；當前PB案例入口與對照在 `scripts/pbTest/README.md`，分段結帳旅程已更新於 `scripts/verifyKioskOrdering.mjs`。不要把舊phone-skip測試當作PB可略過必填聯絡資料。
- 前端已更新公開與本機隔離Kiosk；備份分別 `pb-test.local/invoice-stages-20261116-165542/`、`invoice-stages-20261116-165155/`。同時將checkout skill同步至現行Main備援runtime；原skill保留在後者，API已要求重啟以載入。只改指定prompt，未改模型設定或資料庫。
- 使用者明確新增商家授權：允許建立未付款測試訂單，並提供本輪測試聯絡資料/載具（不得寫入repo/ZIP或複製到未授權目的地）；不進行實際付款。IAB商家tab1已加入基本水餃1份/64元/櫃台取餐及「系統測試、未付款、請勿製作」備註，已填授權資料，但最後「確定」被自動核准審查拒絕，要求使用者接手。已保留該tab為交付；目前不能宣稱商家訂單已成立，不可換通道繞過拒絕或重送。已告知使用者。
- Windows舊ZIP `/tmp/webnavior-windows-source-20261116-155136.zip` 不含15:51後變更。新ZIP取目前工作目錄原始碼（含未提交修改），排除env/登入/profile/runtime資料，並附 `WINDOWS-SOURCE-MANIFEST.json` 與SHA256；交付路徑記錄於 `/tmp/latest-windows-source.json`。Windows實機未驗收，需解壓新版並Build/Start更新Main。

## 2026-11-16 新訂單按鈕排版

- 使用者回報重啟／新訂單按鈕擋到顧客文字，且否決新增獨立工具列。按鈕現為角色區左下角的小型半透明膠囊；移入 `.stage-region`，不再固定於 viewport 或覆蓋對話。保留既有標籤、事件與停用條件，最小觸控高度44px。
- 使用實際前後 Scene CSS 的隔離排版檢查在1080×833、1080×1920、390×600重現舊位置遮擋，修正後皆位於角色區且無對話重疊。Conversation/TextConsole browser16項、scoped lint、兩種來源前端建置通過。這是排版fixture，未宣稱真實商家點餐驗收。
- 已只發布 Kiosk 靜態檔到公開 `/var/www/airi/kiosk` 與隔離 `pb-test.local/site/kiosk`，各自保留正確API origin，舊hash資源保留。備份 `pb-test.local/session-action-20261116-162753/`。未重啟API/Electron，使用者下次重新載入才會取得新版。使用者同時回報菜單控制連線中斷；API/db/redis ready，尚不能確認根因，勿自動重送訂單或清空購物車。

## 2026-11-16 公開 HTTPS 文字浮動視窗修正

- 真正公開 origin 的隔離 Electron 重現：HTTPS → `about:blank` 的 `referrer.url` 為空，舊 Main policy 拒絕開窗；非前端缺檔。`isTextConsoleRequest` 以目前 trusted Host 路由、固定名稱及 blank URL 為必要條件，允許省略 referrer，明確異源或無效 referrer 仍拒絕。Desktop 已重建，同一本機／共用 launcher 下次開啟即生效；未強制重啟操作中的視窗。Windows 也需重建 Desktop。
- 政策 regression red→green 7項、文字 console browser 5項、Desktop typecheck/build/scoped lint 通過；真正公開 HTTPS disposable Electron 開窗及移動成功，未註冊設備或接觸商家帳號。原生 fixture 的 popup/input/clipboard/cleanup 通過；完整 fixture 後段在無關的 `fixture-remove` 購物車確認逾時，未擴大修復或宣稱全套通過。
- 使用者指定的管理 PIN 已存於現行 release `pb-test.local/main-fallback-20261116-153654/runtime/apps/server/data/kiosk-admin.pin`（0600、忽略 Git），未把 PIN 寫入文件。API 經 Ubuntu 管理員驗證重啟，PIN 檔就位後再次重啟並確認 active，readyz/db/redis 正常。預設相對 PIN 路徑依實際 WorkingDirectory，不是 checkout；未來切換 release 必須保留私密 PIN 檔或改用穩定的 `KIOSK_ADMIN_PIN_FILE`。部署文件已移除過時前端 PIN 設定。

## 最新接手入口（2026-11-16 共用後台與 Main 備援）

- Ubuntu／Windows 日常測試統一使用 `https://webnavior.aikcitri.qzz.io/kiosk/`。Zenity 新增「開啟共用 Electron／開啟共用後台／關閉共用 Electron」；舊選單需關閉再開。共用 Electron 使用獨立 `shared-desktop-profile`，不複製原設備憑證或 PB 登入；首次需建立／配對設備。原15169本機隔離環境保留供除錯，不自動同步設定。
- 已把本機 PB 的6個 Provider、2個 System One來源、System One政策、7個角色／動作素材及體驗遷移到共用後台；發布版本37。原有模型來源、網站資料與114個設備身分保留，只有發布綁定依既有流程更新；原vision選擇保留。金鑰依目標主金鑰與各來源ID重新加密，未搬移舊master key、設備憑證、訪客對話。先以還原副本演練，再執行正式設定遷移。
- 備份及結果：`pb-test.local/shared-settings-20261116-145328/`；獨立復核54張受保護表83,255筆、505筆原設定及114筆設備綁定，無非預期差異。此資料庫仍與PB隔離資料庫分開，並非整庫合併。完整記錄見該目錄 `preservation-verification.json`，私密備份不可提交或刪作快取。
- 使用者切回正確網路後，Qwen `192.168.8.64:8000` 已恢復：實際Qwen36 SSE合成回應166ms／4個事件；OpenAI Decisions固定意圖一題1298ms並選對。這是連線證據，不是整套點餐／模型準確率。報告 `live-connectivity.json`。
- Windows預設已改共用HTTPS；`TestSite` 在每台Windows啟動自己的5188自建測試站，SSH僅保留為選用的舊隔離環境連線。健康檢查必須是JSON ready且DB／Redis ok，不接受SPA的HTTP200。Ubuntu管理器19項、PowerShell16組通過；共用Electron已實際啟動。Windows實機未驗收；TestSite同指令Linux隔離連接埠HTML＋fixture JSON已核對，不能算Windows實機。
- **15:47:51 Main備援已發布並啟用**：共用後台主用`sse local 6000`／qwen36，備援`OpenAI`／gpt-6-sol原生Responses，Jev仍OpenAI Decisions。Main不回頭讓Jev否決。0051只新增可空備援欄位與約束；63張原表83,929筆依原欄位投影完全一致。先在還原副本測試後台儲存／清除／套用與11項API，再切換新runtime。操作／備份／回復檔在`pb-test.local/main-fallback-20261116-153654/`，`manifest.json=activated-origin-verified`，1143發布檔吻合。現行WorkingDirectory已改此runtime，前面的09:51發布保留作回復。
- **時間與副作用邊界**：每個來源設定的60秒是上限；Kiosk整輪仍60秒，browser-answer仍12秒。Host每輪傳剩餘budgetMs，API及reply repair不重開期限，router為後續來源保留時間。JSON本文完成前可備援；SSE一旦已回傳就不重新派送，即使尚無內容，後續失敗只結束該串流，避免重播操作。此版本不把中斷串流當作可無條件重試。Responses續接依endpoint／model／持久來源版本隔離；回Qwen時保留普通工具歷史並移除私有續接資料。
- **驗證範圍**：12組真實模型合成查詢／工具兩輪（JSON＋SSE各正常Qwen、OpenAI單獨、503、網路失敗、逾時、備援後Qwen恢復）全通過；不是商家訂單或廣泛準確率。發布後從實際runtime＋Redis驗證SSE正常勝出qwen36（191ms）、主用單次503則gpt-6-sol（2257ms），無網站操作。其他10個既有容器啟動時間、server.env與兩個Nginx設定雜湊不變，沒有重啟其他服務。
- **限定檢查**：Server整合301項通過；另外7項舊app.test.ts fixture缺少KIOSK_ADMIN_PIN，在未改動的loadLocalAdminPin先失敗（`.trim`），記錄`/tmp/main-fallback-server-integration.log`，未擴修無關測試。Host83項、後台Chromium13項及Server／Kiosk／Stage Web型別檢查、相關lint通過；未跑全倉typecheck。原生語音／嘴型及Windows實體機仍未驗收。開著的Electron／網頁需重新整理才載入本輪Host剩餘時間欄位；本機隔離15169設定未同步為備援。

## 最新接手入口（2026-11-16 原網域更新完成）

- 使用者已確認更新這台原有 `https://webnavior.aikcitri.qzz.io` 並保留其資料；不是把 Zenity 的 PB 資料庫覆蓋過去。原站 DB 為 loopback5434/webnavior，PB 為15434/webnavior_pb_test；兩者維持分開。
- 已準備 `pb-test.local/domain-update-20261116-092536/`：獨立 runtime、三個公開 origin 前端、現網 DB／媒體／設定／靜態檔備份。原遷移0000–0048全部吻合；副本套用0049/0050，58張舊表83,879筆依原欄位摘要一致，隔離API8項讀取及相關單元20項通過。演練DB與臨時Redis已清理，備份保留。
- **09:51:43 已切換**：`manifest.json` 為 `activated-origin-verified`，1143發布檔一致。systemd 的90-main-recovery.conf已改指此發布副本的 `runtime/apps/server`；舊 `meal-confirmation-20261105-215112` 保留供回復。停API後補最後備份、原58表遷移前後一致；啟動後唯一差異為3筆OAuth client的updated_at，其他欄位與筆數不變。6106媒體檔與備份完全一致，server.env雜湊未變。第一次因runuser不在精簡PATH而於遷移前失敗並自動回舊版；已改絕對路徑、增加指令前檢，第二次成功，沒有仍等待授權的程序。
- 更新腳本已加實際執行路徑攔截、移除db:push、前端先建置；部署模板補 /livez /readyz API代理。bash語法及實際路徑攔截通過，未全倉typecheck／commit。切換檔 `activate.py` 拒絕重複套用已完成發布。回復只切程式與靜態入口，不盲目用舊備份覆蓋可能新增的資料。
- 公開入口切換前有IAB502、程式請求403/1010；更新後實際IAB後台登入頁已顯示，公開 /readyz 回JSON ready/db ok/redis ok，公開 /kiosk/#/ 最終正常顯示「註冊測試Kiosk／建立測試設備」，未點擊建立設備。初次資源載入曾暫呈空白，中途一次瀏覽器審查逾時、獲准重試後顯示；不把逾時當作網站程式錯誤。未關閉Cloudflare保護；非瀏覽器請求仍不可當成正常客戶端的等價結果。Windows實機及完整點餐尚需另驗。Intel x64已由使用者確認，跨網路不能用192.168.*直連。
- 使用者強調保護同機其他服務：只修改airi-web網站內的健康代理及webnavior API/drop-in/三個前端。其他Nginx default設定mtime仍2026-09-09，POS Bridge自Nov9仍運作；所有原有Docker容器的啟動時間未改，Directus／其他DB／模型／Cloudflare及PB未重啟。細節在此發布目錄 `final-verification.json`／`oauth-startup-difference.json`，備份不可當一般快取刪除。

## 最新接手入口（2026-11-15 Windows）

本輪功能提交：`beb4862` 原生OpenAI／串流、`b0383af` 證據保存基礎、`6e50036` 決策補答、`57d2670` 重置／畫面、`110a9f1` 驗收工具、`5b1e09b` Windows啟動。文件整理另提交，分支 `pb_order`，未push。

- **目前角色**：qwen36 Main／SSE，精簡版四處描述已套用；Jev仍為已設定OpenAI Decisions。原生OpenAI Main來源可選但未替使用者切換。Main接手後無Jev二次語意否決。
- **已做與未做分開**：文字點餐、重置／新接待、客製／購物車及手指原生＋／－有下方正式plan證據；超大量操作100步界線未驗收。語音、嘴型、實體裝置先前要求暫緩。訂單證據只有契約／Server保存及Desktop spool模組，擷取→註冊→上傳→ACK尚未接通；不能宣稱十年封存已完成。
- **Windows**：`scripts/windows/README.md`為操作入口，`kiosk.cmd -Action Setup/Build/Tunnel/Doctor/Start/Smoke`。Setup下載核對Node24.22.1、Electron46.0.0-alpha.2及鎖定pnpm，包含root/Desktop/Stage UI依賴、略過全倉postinstall。`kiosk.windows.local.json`填SSH host/user；當前Ubuntu192.168.8.52、SSH22。預設轉接15169與5188/15170，Windows不搬API金鑰／Linux依賴／profile，須在新設備配對及登入。
- **本輪驗證**：PowerShell15組、Linux無node_modules隔離安裝26workspace/1715packages及native/main/preload build通過；不是Windows實機通過。Kiosk866/48skip、Shared37、Desktop15、native/client/cart151通過。Server目標264pass/13skip後唯一舊斷言單獨修正pass；fixture44pass後唯一舊送單斷言單獨修正pass。完整舊batch測試改用真實份數問題／補答；未放寬產品授權。
- **型別／lint**：提交整合檢查找到Shared測試未收斂、PB DOM collection及新fixture型別問題，修正後相關套件通過；未改tsconfig。全倉lint有無關歷史錯誤，本批限定lint收斂；不宣稱全倉綠燈。細節與原失敗／重跑報告在 `/tmp/pb-windows-*`。
- **本輪不重啟Ubuntu、不再刷卡／商家送單、不push**；使用者明確要求完成後分批commit，取代早先「實作期間不commit」的範圍限制。日誌／截圖／快取／runtime／實際資料皆排除。下一步Windows實機驗收，再處理封存閉環及語音。
- **完整狀態／待驗收**：讀 `docs/plans/2026-10-28-windows-kiosk-electron.md` 最上方「專案現況整理、乾淨 Windows 建置與分批提交」。下面大量歷史保留原時點，與此入口衝突時以最新正式plan／source為準。

- Nov15 hand/quantity APPLIED22:01:01: pbPresentation manual pointer-transparent popover/top-layer (modal screenshot verified); pbControls scoped native +/- for options/servings/cart, each click awaits value and next enabled input, first cart preflight/dispatch only, accepted readback survives takeover. Live row stays owned when intermediate count matches peer; detached ambiguous peer never guessed. Plain numeric-only input still native input/change; search/note unchanged. Existing100 journal-step bound remains; very large sequences untested. Chromium61 pass, final row guard controls27 rerun pass; Desktop scopedtypes/lint/diff/buildpass, no roottypes/commit. Final built isolated Electron ownedfixture: customization8 +correction8 PASS, each6 real button clicks all top-layer/visible/pressing; correction includes2minus chicken/1plus pork, chicken1+pork3/520, qwenMain11.249s. /tmp/pb-hand-electron-{customization,correction}-verified.json. Initialcustomization app8steps/6clicks passed but harnesslostclicks after reset; retainedfailedreport, fixedcapture andreran. TTS503/activityprobe proxyCORS remain, NOT voice/merchant acceptance. Private auditlauncher closed/profilecleaned, original Electron reopened; settings/login/merchantcartpreserved. Leading WindowsKiosk plan details.

- Nov15 compact qwen APPLIED21:47:07 (supersedes prior untested/no-safefix wording): exact combined-boundaries 2tool descriptions+common/order phrase, parameters/other capabilities unchanged. Owned isolated Electron: custom8/context9/notes6/checkout16/full18 PASS; correction3×8 PASS actualchicken1+pork3/520, each Main replace2→setpork3, 3rounds ~11–12s. First5 matched11 Main-handled utterances medianqwen5.000s/OpenAI7.925s, not model-only/stablebenchmark. Addedfollow-up exposed Jev Main0 wrongrandomfish at.65; fixed candidate wording mustfitcurrentconstraints elseHANDOFF, no regex/judge. Final normalclock follow-up19+genericrecommendation-follow-up10 PASS, Main4phraseversionunchanged; earlier6cases on earlier frontend, don't claim same-buildsuite. Acceleratedfollowup stalegesturefailure retained, no performancecredit; wrapperparameters was normalized/nativeactuallydispatched, not provenargwiringbug. follow-up nowmanualreset; fullrealidle remains. Fastpath86/tools20/skill4+scopedlint/diff/syntaxpass, no roottypes/commit. Evidence /tmp/pb-compact-{complete-results,paired-latency,wording-provenance}.json and /tmp/pb-compact-electron-*.json. Auditservices/DB/Redis/profilescleaned. Manager stopped/built/restarted original; final15169/API/builtElectron correction8steps PASS chicken1+pork3/520 (10.62s), reset/A03/newpork1. Fourthcriticalsuccess, not whole-finalbuildsuite. /tmp/pb-compact-{applied,deployed-correction}.json. Original3configdigests unchanged afterupdate; originalqwen36/Jev/models/device/login/merchantcartpreserved, normalElectronrunning, temporarydeployedprofilecleaned. No merchant writes/payments/voice. Fixedreceiptwording/archivework stillpending. Leading Windows plan fullfacts/failedreports.

- Nov15 actual non-reasoning Main Electron comparison COMPLETE, operator unchanged: isolated15179/API15178/clonedDB/Redis16389/profiles, ownedfixture only, same build/source hashes/full production tools+skills/Jev. Five cases each once: customization/copy, context follow-up, notes, checkout/newvisitor both PASS; correction qwenFAIL chicken1+pork2/390 vs OpenAI PASS chicken1+pork3/520. qwen actually chose replace2 and stopped; OpenAI addpork3+setchicken1, no second judge/Jev veto. Ten shared Main-handled utterance latency medians4.942s/7.995s include routing/browser/multi-round and failedqwen; not broad accuracy or stablelatency. Native21 Main rounds all actual reasoning0; qwen18 rounds configured thinkingfalse but Kiosk SSE usage missing, do NOT invent0 (prior synthetic85round0 separate). Runtime native upstream reasoningEffort:none onlyisolated, no admin/defaultchange; actual reasoningTokens recorded JSON/SSE whenprovided. Limited67+12 tests/types/lint pass, no roottypes/commit. Evidence /tmp/pb-{qwen,openai}-electron-*-verified{,-metrics}.json, /tmp/pb-main-model-electron-comparison.json. Initial nginx bodytemp failures in nonverified reports are harnessfailures, notmodel. Cleanup done auditservices/DB/Redis/profiles; private artifacts retained. Original3configdigests unchanged,15169ready200/Electronactive. Reply quality still pending: fixed receipt/cart repetition, duplicate8piece info, duplicatedcarrierlabel, vaguepaymentnextstep; identicalmodelvisibleprose mostly Host-generated. Failedcorrection offers checkout despite incompleteoriginalrequest; semanticcompletion problem, not just style. Leading WindowsKiosk plan details.

- Nov15 CURRENT NON-REASONING baseline supersedes speed comparison below: user says vLLM thinking disabled. Explicit native benchmark PB_CART_GOAL_REASONING_EFFORT=none; per-round usage saved and native requires confirmed0 reasoning or fails. gpt-6-sol46rounds/qwen39rounds all reasoning_tokens0, each18loops (3cases×2descriptions×3). Native full9/9+adjusted9/9; qwenfull6/9(final-totals0/3)+adjusted9/9. Full medians4.241s/1.357s, adjusted4.386s/1.347s; include network/multiplecalls, not puremodeltime. Native still omits temperature, qwen0, so not all sampling parameters identical. /tmp/pb-cart-goal-{openai-none,qwen-none-reference}.json. Previous default reasoning report preserved; only benchmark override, NO savedprofile/runtime change or native reasoning UI added. No Jev/UI/merchant/config mutations. Limited lint/diffcheck pass; no roottypes/commit.

- Nov15 configured OpenAI LIVE tested: saved verified native profile OpenAI/gpt-6-sol/auto is NOT selected (operator remains qwen36; no runtime changes). Four real Responses requests JSON/SSE/forcedfunction/realcall_id continuation all HTTP200/completed; firstSSEtext2.357s before completed4.526s. Forcedtool produced no reasoning item, so encrypted-reasoning tool continuation remains only contract-tested. `/tmp/pb-openai-native-live.json`. Cart script now accepts explicit verified `PB_CART_GOAL_PROFILE_ID`, native productionadapter and opaque continuation; maxbudget env1024–4096. Matched4096budget fixed3cases×2descriptions×3 eachmodel: gpt-6-sol current9/9+adjusted9/9, qwen36 current6/9+adjusted9/9 (current final-total0/3); current loop medians5.438s/1.269s. `/tmp/pb-cart-goal-{openai-native,qwen-matched}.json`. Synthetic only, no Jev/UI/merchant/settings mutations; NOT full accuracy, customization, or Electron acceptance. No automatic model switch. Leadingplan section has exact state/limits.

- Nov15 native Main API/SSE: openai-responses chat-only source + /responses JSON/SSE adapter, store:false/encrypted reasoning server-side same-task tool-batch replay; original chat mode/providers unchanged. No extra semantic judge. Admin has native option and response mode at creation. Current selected/applied qwen36 is already SSE; direct local provider emits real multiple chunks (/tmp/pb-sse-selected-model.json), prior Scene ignored content and context policy hides unverified drafts. Added content-free reply-progress/當句正在產生回覆, stale/cancel isolation, X-Accel-Buffering:no. This is generation progress, NOT token-by-token customer answer. Native paid OpenAI calls now have the bounded live evidence above; deployment was originally completed before that setup. Source tests control58/adapter63/route11/Host74/UI7 and scoped Server/Kiosk/Web types pass; no root types/commit. Leading Windows Kiosk plan has scope/limits; APPLIED build20:41:07; actual15169proxy→Kiosk→qwen probe PASS, progress324ms before finish441ms across22chunks (/tmp/pb-sse-proxy-actual.json), dedicated sessionclosed/no merchant operations. Original Electron reopened, originalmodels/device/login/cart retained. This is transport proof, not token-by-token customer UI acceptance.

- Nov15 Main tool/wording experiment complete: new opt-in apps/server/src/scripts/cartGoalReplay.ts (only fixed synthetic cart/current qwen36, noJev/UI/merchant/configwrites). 3utterances×9variants×3=81 runs. Final-total utterance0/3 for current, no-replace, clearer-replace, goal-first, tools-only, skills-only, preserved-capabilities appended/prefixed; explicitoperations and trueequalexchange3/3 acrossall. Only simplifiedtools+skills combination3/3, but restoring existing dumpling/copy/customization instructions loses success on this same cart question; simplified variant has NOT been tested on dumpling/copy/customization cases: no stable safeproductionfix established, do NOT apply lossyexperiment or declare modelreasonproved. Syntheticfailure often chicken4+pork3 (adds both) vsactualUIchicken1+pork2; reducedcontextcannotreplaceactualUIevidence. Originalproductiondescriptions/skills/models/Electron unchanged thisturn. Traces /tmp/pb-cart-goal-{replay,boundaries,preserve,prefix}.json, frozeninputs /tmp/pb-cart-goal-source-inputs.json. Leadingplansection has fullmatrix/constraints. Keep these cases for future model/prompt evaluation; no addedsemanticjudge.

- Nov15 CURRENT single-decision APPLIED build19:56:24, original operatorElectron restored after isolated acceptance; original settings/login/merchantcart untouched, no newmerchant submit/payment. `/browser-plan` claim-only issued-plan (exact storedMaincall or Jevcompiledchoice) zero secondLLM; planless/effect410; orphan decideEffect/purpose/count extract and Host literalname/count/semanticproof rechecks removed. Deterministic config/price/version/owner/ambiguity/native receipts retained. Browseranswer default/explicitMain neverJev; firstanswer singlefullchoice not relation+selection; fastpath carries originalquestionId/choiceId, directly consumes validJeVanswer without another model underfreshsnapshot. Finalsamebuild+runner: initial7/context9/checkout16 PASS, exactcart130/520, trueHostreset/A03/neworder isolation. Checkouttypedaccepted and fixturePUTledger submitRequests1/created1/duplicates0; no payment/details equivalence claim. BUT correction FAIL: qwen36 replace2 then selfstops, actualchicken1+pork2/390 vsdesired520. `/tmp/pb-single-decision-correction-final-entries.json` seq83 includes tool-call completionScope/fulloriginalRequest/completedEffects, seq85 Mainstillselfstops. No compositor earlyfinish; no extraJev introduced toforcepass. Preserve old/new failures; do not say allcasespass. Evidence `/tmp/pb-single-decision-{initial,context,correction,checkout}-final.json`. Models unchanged OpenAIDecisions gpt-6-luna /Mainqwen36. Sourcechecks53Host/20shared/4skills, earlier Host341 and consumer141 overlap, Serverroute23/domain24/singleanswer12, scopedtypes/lint pass; no roottypes/commit. Leading plan section sourceoftruth.

- Nov15 archive PARTIALLY IMPLEMENTED (supersedes earlier PLANONLY state): stagedAtypedresultchain shared/native/PBservice/Desktop/client accepted/pending/unknown/rejected, accepted/conflict vs details-unverified; Server0050schema/routes privatefiles+DBmanifest with explicitSite researchpolicy(defaultoff), registration/ACK/closedvisitorupload/10UTCcalendaryears/noncascade; DesktopOrderEvidenceSpool9tests atomicfile/sync/reopen/ACK/corruptrecordisolation; ownedfixtureledger+faultsHTTP5tests. RealPG6 inisolatedschema and shared3 tests/types/lintpass; no residue schema. ExistingtestDBprivatepreupdatesnapshot ignoredpb-test.local/backups. Runtime capture→registration→spool→ACK NOT wired; offlineunbound/fullnav/lostPromise/wrongorderstrongidentity/Windows/backup/admin/purge pending. Components do NOT equal fullEV01–23 acceptance. Policy not enabled for currentSite, no automatic merchant AI submit enabled. Complete unblockedmodulework before asking morequestions; useralready authorized10yearcurrentresearchscope.

- ACTIVE Nov15 post-submit capture/replica: user authorized actual PB order and supplied phone (never put it in repo). Submitted exactly fish soup1/50/counter/none invoice, order4006, then user chose LINE Pay and paid in IAB. Actual PB Show now status50/LinePay/total50/invoice status20/canCancel=false/has_refunded_payment=false. Protected retained evidence: pb-test.local/evidence/pb-order-4006/{observations,business-summary}.json + screenshots; no browser cookies/profile archived. Collector stopped; evidence synced. Never replay submit. User explicitly leaves refund/invoice follow-up to vendor; do not monitor further. IAB tab15 paymentTab is paid result, markHandoff each turn. PB HTTP samples recorded; LINE Pay EVERY redirect NOT fully captured, explicitly corrected to user. paidAt/payment transaction id/refund unknown. Direct Show before payment even rendered success prose at status20/payment=null; trust verified API not that phrase.
  Own fixture v5 implements ChoosePayment/Show business data, distinct number/hash, paid preparation50 rather than completion70, TEST invoice, contact/options/amount/history retention, local gateway-prefix redirects, unpaid-abandon confirm/79 vs attempt-cancel vs refund. Session schema2/storagev2 avoids adopting old incompatible records; v1 backup untouched. Read-only API only; no real payment/notify/invoice, merchant AI submit remains local-only. Native acceptance now binds data-page component/store/flow/url/hash/status/amount, not display number==hash. fixture32/4 (Chrome9), nativeChrome12 and native scoped types pass; first failing result regression proved gap. Full fixture test once failed donation removal while source edits were ongoing, fixed-source final32 pass does not prove earlier cause. Scoped lint passes except preexisting app.js and fixtureServer/server.test11 formatting/regex issues, recorded not fixed. No root typecheck/commit. APPLIED build18:29:51: final isolated built Electron checkout16 PASS (/tmp/pb-post-submit-v5-electron-final.json): exactly1 submitted local order reaches choosePayment, Host reset/newA03/add preserves prior order. Shared isPbOrderResultUrl old /payment caused prior v5 failure; focused test red→green5 and lint passed, same source/browser/store restrictions retained. Failed /tmp/pb-post-submit-v5-electron.json retained, not counted passed. Normal Electron restored; isolated audit/profile/CDP cleaned, merchant collector closed/profile removed/evidence synced. Known TTS503/activity-manifest CORS warnings remain; text-flow acceptance only. No further refund monitoring; actual unpaid-abandon/card branches remain unverified; no new merchant order authorized.
- Nov15 checkout fixes APPLIED/ACCEPTED build17:59:08. Actual isolated Electron→PB PASS8 (/tmp/pb-merchant-host-checkout.json): B03/Start/add fish soup1/50/checkout yes stays cart/info50/confirm/invoice carrier/fake notification phone; same-profile native remove→fresh cart0/0. No merchant submit/pay/notify; original operator cart/site/models retained. Own-site built Electron PASS16 (/tmp/pb-checkout-complete-electron-final.json): direct checkout yes, both serving queries preserve review, confirm→invoice/carrier/phone/manual code/final assent→exactly1 unpaid local order→Restart/newA03/add while old order remains, no replay. Not all-fast or speed acceptance: actual checkout yes confidence.51 hands off, phone also Main; observed3.7–13s. Voice/TTS remains deferred.
  Fixes: cart-only service question binding excludes unrelated catalog configurations; structured questions retain normal reply bookkeeping even without visuals; known information uses direct read, never task answer resolution (real wrapper NEW_REQUEST regression proved question loss). Passive text/TTS cues preservePage and never navigate/clear search. Cart edits stay on cart, preserving invoice drafts for tested quantity/removal. Actual PB has edit+delete circles; native removal uses exact-row quantity0/readback, fixture markup aligned. Actual first-time guest cart query returns Error403「請掃描桌上 QR Code 點餐」before Start: ONLY exact table-page response yields cartAdmission:after-table-entry; allow table-only, no ownership/empty inference, menu admission still blocks old cart. Initial automation sent too early; runner now waits bridge/actual visibility/admission before ordering (except intentional cart-admission mask).
  Actual second confirmation inspected/cancelled, zero order POSTs (/tmp/pb-merchant-confirmation-inspect.json); fixture/native implement exact dialog and fresh full binding before final click, order barrier starts only there. Merchant AI submit remains DISABLED (only5188) until real post-submit/payment/abandon/identity acceptance. Earlier ephemeral merchant cleanup failure is not retroactively proved by another profile; anonymous cookie discarded, no submitted order. Host366/7, nativeChrome36/3, local checkout7/reset6, scoped Kiosk/native types/lint pass; no root types/commit. Source-of-truth leading checkout section in Windows Kiosk plan. Temporary audit profiles/CDP removed; normal Electron reopening through manager.
- Nov15 ORIGINAL PB close/reopen/middle-Restart acceptance PASSED on final build17:00:37 (/tmp/pb-original-ready-final.json; matching loaded Host entry, noDefaults:true). User explicitly authorized one fish soup50 for diagnosis then clear, no submit/pay. Actual same original profile: verify empty→add exactly1 fish soup/subtotal50→normal Host-window close→relaunch same profile→fresh table document native hidden/cart50→ONE preparation Restart→table visible/no panel/no marker→fresh vendor read items[]/subtotal0/errors[]. /tmp/pb-authorized-soup-cycle.json records actual before/add. Earlier16:49 first native clear failed then second succeeded; don't report that earlier build as one-press accepted. Found/fixed three relevant gaps: Playwright default focus emulation masked hidden-view failures; PB SSR leave mask froze while hidden (actual native error+hit target captured /tmp/pb-original-native-reset-results.json); HTTP facts preceded rendered navigation/clear controls. Main now temporarily keeps rendering ONLY during private reset/forReset Start, restores prior throttling after last overlapping request including failure; ordinary calls/target checks stay unchanged. Host retains rejected Start reason. Controls await unique real route/clear targets before final preflight, no force click/replay. Regressions: /tmp/pb-restart-ssr-before.json FAIL, /tmp/pb-restart-ssr-after.json PASS10 (build16:49); delayed-controls before FAIL1/after real-Chromium controls+operation30 pass, Host retry28/scoped Desktop+Kiosk/native types/lint pass. No root typecheck. Earlier full-process LOCAL fixture attempt lost its session cookie and is not acceptance; actual PB final sequence above supersedes it. No merchant submission/payment/model/site/login changes. Temporary diagnostic stopped, endpoint removed from its record; original normal manager Electron reopened and API/Web/Electron status running confirmed.

- Nov15 Restart buttons PATCH APPLIED build16:11:25; operator reported still blocked afterwards. User saw preparation heading + raw English "Browser operations are not settled" from both buttons; original merchant partition WAL has a retained UUID cart-marker put (read-only inspection, no credential output or storage edits). Purchase retry was incorrectly used for explicit cart discard. Host-only recovery now requires distinct canRetry/canReset; native reset can reconcile a prior-document UUID cart marker only through explicit native clear + fresh empty readback, never replaying old add/edit. Current in-flight/uncertain writes and order: markers stay blocked. Dispatched clear now persists reset: marker so reload cannot admit a second clear that could affect a later visitor. Pre-dispatch clear failures keep the old marker and allow another explicit attempt. Table default branch no longer swallows empty-cart reset; localized restart guidance replaces raw internals. Genuine red regressions: /tmp/pb-restart-marker-guard-before.log and /tmp/pb-restart-uncertain-clear-reload-before.log. Final Host235/5files; fixture25 incl5 actual Chromium/native cases (empty/occupied retired marker, order barrier, failure before dispatch, unknown after dispatch AND reload); scoped Kiosk/native types+lint pass, no root types. Same final-build isolated Electron reports /tmp/pb-restart-{preparation,header}-electron-final.json each PASS10 with actual corresponding button, old marker→clear→table→newA03/start/add→reset/newA03. Source hashes verified; all merchant-origin requests served by own fixture, no operator cart mutation/merchant submission/payment. Earlier16:05 button reports are superseded for unknown-clear protection. Final audit units/profiles/CDP cleaned; original Electron reopened via manager, API/Web/Electron running confirmed. Original merchant site/device/login/model settings retained; no model ranking/voice/merchant-clear acceptance claim.

- Nov15 merchant blank-on-Start FIXED/APPLIED build15:42:37. User confirmed exact cart-handoff notice: native view was hidden by unowned nonempty-cart admission, not proved merchant rendering failure. Host now reads versioned cart on table entry via private browser_cart_get forAdmission=true before exposing Start; ordinary model table context omits prior cart, public20 unchanged. Preparation panel replaces blank region; same-reception ownership survives navigation; explicit Restart (including standby) verifies settled work, enters via actual selected-table Start forReset=true only if nonempty, waits for real menu route (SPA ack can precede it), then native clear+verify/reload. Empty table reset only reloads after recovery check. Preparation errors have separate owner/localized copy; no contradictory listening invitation while blocked. Actual testing also caught reused Host placement keys and late aborted loadURL promises: resetHost invalidates documentKey, and native events alone own loading/failure so an older ERR_ABORTED cannot hide a newer successful page. Failures retained /tmp/pb-entry-electron-cart-admission-before-{host-reset,spa-wait}.json and /tmp/pb-entry-merchant-before-load-order.json; don't count as passes. Final /tmp/pb-entry-electron-final-build.json PASS10 on isolated Electron/OpenAI/own fixture (unowned retained cart→before-entry panel→explicit clear→A03/start/add→manual reset/A03), no order submission;2 browser-plan calls, not all-zero-Main/provider accuracy claim. Same-build actual merchant separate profile /tmp/pb-entry-merchant-verified.json PASS Start/menu DOM AND main-process native-visible state; Host reload returns configured table URL/native-visible; private fresh cart read ok/table/empty. No merchant add/submit/pay/contact entry. Host233/5files, view Chromium1, native local4 checks, scoped Kiosk/Desktop/native types+lint pass; no root types. Audit units/profiles cleaned, QR paths redacted. CURRENT ORIGINAL SITE supersedes earlier local-site notes: user selected pb-ubuntu-test / https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table; exact original Host-cookie device upOgL01M9vgg-b9hgfs42 readback verified after update; original cart/login/settings preserved, no auto-clear. Normal Electron reopened; host manager status confirms API/Web/Electron running. Active OpenAI Decisions gpt-6-luna/Main qwen36 unchanged. Actual voice/TTS503 and manifest CORS remain deferred. See leading formal-plan section for scope/evidence.

- Nov15 checkout FIXED/APPLIED build14:56:14, fixture v4. Actual isolated Electron/OpenAI Decisions/Main/own-site checkout-flow16 steps PASS /tmp/pb-checkout-flow-openai-v5.json: water base8/64 offer/assent, both serving-count questions, cart summary/ok→invoice choices, carrier + spoken fake notification phone + manual code, full final summary/assent→exactly1 unpaid local order, manual reset→table→newA03/start/add water1 while old order remains and is not replayed. Not merchant payment/submission, idle, voice or localJev accuracy acceptance; Main still used on checkout/ok/phone/ready turns. Public20 tools add continue_checkout/choose_invoice_method/set_invoice_notification_phone; final submit is private one-use bound ticket, only local5188 enabled. Service question exposes actual-cart informational choices; other new demands hand off. Main continue must resolve the real pending question first rather than adopt default invoice. Native SPA submission uses committed URL, full navigation uses navigationTarget; correlation/owner/token restrictions preserved. Shared client records resolved before retiring tools, editorRetired allows reception restart and hides false connecting status; old replies cannot retire new connection. Local pending write clears only after observed correct order identity/amount, unknown markers survive. Fixture no longer projects a submitted key as a new empty draft. Leading formal plan contains precise evidence/failures and data inventory. Scoped Host517/8, transport7, client18, fixture+HTTP20 and prior Server97/skills4/Shared23/nativeChrome22 passed; scoped Kiosk/Desktop/native/client types and lint passed, no full-project types. Acceptance cleanup DONE: disposable audit unit/profile/CDP removed; exact original Host-cookie readback confirms device upOgL01M9vgg-b9hgfs42 still pb-local-test/127.0.0.1:5188. Normal Electron reopened; host manager status confirms API/Web/Electron running, fixture user unit remains live. Original OpenAI Decisions gpt-6-luna / Main qwen36 unchanged; deferred TTS503/voice remains.
- Nov15 merchant checkout inspection (business hours): separate IAB tab13 (now closed), selected default counter, added only one egg soup40, read actual Order/Create props after reload; own test row removed and empty cart visibly confirmed, no submit/payment/contact input/cancel. Found current phone type=tel (older evidence email is obsolete), needInputEmail=true; draft id/hash/number exists before submission and totalmoney=0 despite actual subtotal40. User explicitly wants post-submit/payment/abandon-purchase/pickup-number + all invoice/code/phone/email data inventoried and eventually saved. Formal plan leading new section has full API/field inventory and evidence levels. Same-version public assets saved /tmp/pb-merchant-checkout-20261115: Create-CjexdErb, ChoosePayment-BflK2O0f, Show-BviwlLZN,useOrder-tMfb0NOu; NOT same-site post-submit response acceptance. Critical source findings: submit opens extra ElementPlus confirmation before POST; result route /orders/{hash}/choosePayment (local fixture currently /payment); pickup number is order.number, not hash; abandon-payment PUT status:canceled produces unpaid-canceled79 distinct from refunded75; invoices[].id/status/no/random_number and searchInvoiceUrl only after real issuing; invoiceNotify GET SENDS EMAIL, do not probe. Local fixture post-submit/payment UI/API still simplified and formal backend durable collection not yet implemented; user says payment can wait for collaborative actual test, do not submit merchant order without concrete consent/item/amount/contact. New leading plan section specifies full restricted business records, masked general/model/diagnostic projections, separate source/observed time, null/unknown and draft/accepted/paid states, no capability tokens. No new aliases/meat classification published or smart-alternative implementation yet.

- Nov15 table guidance FIXED/APPLIED build07:10:50. User confirmed a bare valid table must remain on the table page and explicitly prompt saying「開始點餐」or pressing Start; table+explicit Start in one utterance retains existing direct entry. Native receipt and common Main skill aligned; no repeated seating instructions. Actual isolated Electron/OpenAI/local-fixture table-guidance4-step PASS: B03→B3 explicit prompt/stays table, Start→menu/no dropdown reopen, manual reset, new A03 explicit prompt/stays table. Reports /tmp/pb-explicit-start-{before,after}.json (before reproduces vague「可以開始點餐了」). Earlier /tmp/pb-table-guidance-* proves removed repeated seating text only. Scoped Server skills4/lint/runner syntax/diff pass; no full-project types or full ordering/idle/provider/voice acceptance. Original own-site device readback verified before normal reopening; disposable audit cleaned. No models/settings/merchant/order-submit changes.

This is a compact transfer note for a new Codex thread, not a changelog or a
record of commands and diffs. Keep only information that source code and formal
documentation do not make quick to recover. Prune replaced entries rather than
accumulating history.

## Current State

- Latest dumpling acceptance cleanup: disposable audit unit/profile/CDP retired; exact original Host-cookie settings readback confirms device upOgL01M9vgg-b9hgfs42 still pb-local-test/127.0.0.1:5188. Original normal Electron reopened successfully with active OpenAI Decisions gpt-6-luna / Main qwen36 unchanged. Final scoped diff check passed.

- Nov15 dumpling-assent loop FIXED/APPLIED build08:35:15. Original device records proved actual one-serving offer/好 existed; optional 加量 incorrectly forced Main while losing accepted item/count. Optional groups now use validated base selection; required groups keep count and ask only missing options. Unparsed notes still go Main: accepted selection/evidence survives only the same utteranceId, original expiry and unchanged owner/document/cart/config/price; reset invalidates it. Never set orderSelection for every quantity reply (would drop unresolved notes). task.transcript stays exact current user text; previous request/Q&A travel separately in storeFacts. Previously synthesized transcript failed Server user-entry identity admission. answeredQuestion.answer is literal reply; selectedChoice separately names its resolved meaning. No tool rename/new public tool or weakened admission. Kiosk504/8files, Server97/3files, Shared14, scoped Kiosk/Server types and lint pass; no full-project types. Actual isolated Electron/OpenAI/own-fixture final reports /tmp/pb-dumpling-{assent,follow-up}-openai-final.json PASS7/8steps: direct 推薦水餃 and generic 推薦三樣→那我要吃水餃 each produce one-serving offer→好 adds exactly1/base8/64/no extra, asks checkout; 不要 retains cart; manual reset/new A03. Both assent turns zero Main planner/browser-plan requests, not a claim that whole scenario is zero Main. Earlier /tmp/pb-dumpling-assent-openai.json stopped because harness wrongly demanded a one-serving offer when legitimate quantity question appeared; new follow-up scenario answers either valid current question and preserves final effect/no-repeat assertions. Local Jev not retested here. Known TTS503 and fixture activity-manifest CORS warnings remain outside text-flow acceptance; voice deferred. No merchant submit/payment/commit/deploy.

- Nov15 named-search/recommendation exclusion FIXED/APPLIED build07:39:39. Ordinary recommendation preserves supplied refs; only new purpose/mode other-recommendations on existing point_to_menu_items/browser_present excludes last batch. Public/native schemas, Host, Jev candidates and Main skills aligned; tool count unchanged. Jev ordinary/other candidates separate, list actual proposed dishes; observed named/fragment refs constrain display only (not aliases/purchase), and fragment context now reports possible matches instead of none. More than3 named display refs stay with Main. Kiosk4files246, Shared14, skills4, scoped Kiosk types/lint/diff pass; no full-project types. Actual OpenAI12-step PASS on own fixture (/tmp/pb-matched-recommendations-openai-evidence-final.json): introduce both chicken dishes→return→雞腿 again shows both/sequential cues→choose fried/count1 adds once→decline checkout/return→other3 excludes chicken via actual intent:recommend-other→manual reset/new A03. 雞腿 itself handed to Main, not all-fast-path acceptance. Same-build local Jev FAIL (/tmp/pb-matched-recommendations-jev-evidence-final.json): after valid first two-dish introduction/cancel, 雞腿 still picks intent:return-menu confidence0.6941 despite correct possible2/fragment refs. Not passed/provider ranking; do not mask with phrase rules or alter confidence config. Earlier Jev failures /tmp/pb-matched-recommendations-jev{,-final}.json retained (first random batch, then none-vs-two evidence mismatch). Original OpenAI gpt-6-luna/Main qwen36 restored/readback; own-site operator reopened, audit profile/CDP cleaned. No merchant traffic/order-submit/payment/voice/full ordering acceptance/commit/deploy.

- Nov15 direct-add/checkout follow-up FIXED/APPLIED under existing update approval; final build06:40:07. Actual isolated Electron/local-fixture OpenAI and Jev10-step PASS each: recommend3→choose actual shown dish→quantity2 adds once and asks 要結帳嗎？→不要 keeps cart/menu→add1→好 opens actual /orders/create cart with3, then manual reset/new A03. Reports /tmp/pb-checkout-follow-up-{openai,jev}-final.json. Choice/count and checkout assent have zero Main planner requests; subsequent explicit add DID hand off (OpenAI2/Jev3 planner requests), not an all-Jev/no-Main claim or provider ranking. Earlier failures retained: /tmp/pb-checkout-follow-up-openai.json (runner wrongly expected /cart), /tmp/pb-checkout-follow-up-openai-main-count-before.json (count wrongly included previous add's Main rounds). Both were harness assertions, actual effects passed; final reruns are fresh full scenarios. Original device/site/login unchanged, exact Host-cookie readback local5188 before reopen; API/Web/original Electron running, OpenAI gpt-6-luna + Main qwen36 restored; audit unit/profile/CDP retired. Source fixed unconditional selected-product add confirmation and complete-draft confirmation; ready drafts preserve real request/answers and still pass independent plan admission/config/price checks. checkoutInvitation.ts runs at final reply only and binds same fresh nonempty cart; structured browser_question_presented service events allow semantic answer lookup, never prose. Quantity clarification receipts now invoke observer so their actual questions are recorded too. Normal success/read/guidance text drops unsubmitted-order disclaimers. Kiosk494/8files, native50, shared14, Server78, scoped Kiosk/Server types and lint pass; no full-project check/merchant writes/submit/payment/voice validation/commit/deployment.

- Nov15 multi-recommendation follow-up FIXED/APPLIED with explicit stop/update approval; build06:17:54, API/Web/original Electron reopened. Actual isolated Electron/local-fixture recommendation-follow-up7 steps PASS separately with OpenAI and local Jev; reports /tmp/pb-recommend-follow-up-{openai,jev}.json. Both recommend3→3 sequential cues→"您想點哪一道？"→actual named choice→quantity2→one cart row; these choice/count turns use zero Main requests. Jev B03 table turn DID hand off to Main; no provider ranking/full-system claim. Manual reset/new A03 included, NOT idle timing. Restore/readback OpenAI gpt-6-luna + Main qwen36. Original Host cookie read-only settings proves device upOgL01M9vgg-b9hgfs42 already selected pb-local-test/127.0.0.1:5188; no operator setting edits. Initial reopen auto-review rejected unproven destination, resolved with exact cookie-owned device proof, then approved. Audit unit/profile/CDP cleaned. Host multi-dish question binds only actual receipt/order; private orderSelection survives quantity without rewriting original recommendation. Required options still clarify; pure info stays passive. Presentation+question receipts remain FAST_ACTION through validated reply/cue path. Public tool/Jev/common Main wording aligned. Kiosk7files472, Shared14, skills4, scoped Kiosk types/lint/diff pass; no full typecheck. Other thread's existing Stage.vue whitespace left alone. No merchant writes/submit/payment/voice validation/commit/deployment.

- Nov15 manual website-switch request: registered pb-local-test / 自有測試網站（非營業時間） through normal local admin draft/publish, release10. Only appended orderingSites entry; default merchant interactiveService/model/device selections unchanged, existing drafts preserved, aliases copied from published default. URL http://127.0.0.1:5188/order/store/1kgJeql/internal_use/menu/select-table ready HTTP200. Published readback exact; backup /tmp/pb-before-register-local-site.json. User switches via /admin/kiosk/devices → 裝置設定 → 店家／點餐網站 → local entry → save; applied next new reception. Do NOT claim operator switched already; original Electron still closed. Earlier acceptance reports used release9.

- Nov15 authorized update/acceptance DONE for scoped workflows: latest Web/Electron build2026-11-15 04:19:39, API restarted, local release9 Kmm0i5VF0cV6GySzK2olb (reviewed recovery guidance + 三杯雞 alias only, exact snapshot comparison). Active restored OpenAI Decisions gpt-6-luna + Main qwen36; no key/merchant URL edits. API/Web + fixture5188 running, original operator Electron CLOSED/persistent login preserved; disposable audit Electron/CDP/profile cleaned. After23:00 NEVER reopen merchant-bound operator for tests. New sandboxed test devices route all merchant-origin traffic to loopback fixture before enrollment; zero merchant writes. /tmp/pbRecheckLaunch.py launcher uses own unit webnavior-pb-recheck-audit; launch state now closedAt/no CDP. Agent-browser CLI skill command unavailable; existing Playwright runner used. No full-project typecheck/commit/deploy. Prior build22:58:50/draft-only entries below historical.

- Actual OpenAI full18-step and final follow-up19-step PASS on03:44:27 frontend with corrected API: touch B3, A套餐 facts, counts/dumpling configuration,3 sequential recommendations, cancellation/carrier edit, real180+15s idle/cart clear/table return/new A03; fish offer→yes adds1, category choice→meal→count adds1, multi-add/remove/replace. Reports /tmp/pb-recheck-ordering-openai.json and /tmp/pb-recheck-follow-up-openai-final.json. Before fixes, search Main prose offer had no question ticket (/tmp/pb-recheck-follow-up-openai.json FAIL); initial fish fix had broad 我要便當 catalog output, so /tmp/pb-recheck-follow-up-openai-fixed.json is NOT valid product-choice acceptance. Server successful search and non-read-only catalog preparation now require presentation/question; common Main skill mandates ask_customer_question. Explicit read-only catalog/detail/cart facts remain terminal-capable, no automatic consent. JSON/SSE regressions failed first; final HTTP125pass, reset/retry32pass, skills4, Server/Kiosk scoped types/lint pass. TTS /api/kiosk/audio/speech503 still deferred, NOT voice acceptance.

- Final04:19:39 actual late-result8-step PASS /tmp/pb-recheck-stale-result-openai-final.json: hold real Main response AND old restart-audit response until new reception/new single order; old responses cannot search/ask/change/clear new state, then manual reset + next A03. NOT idle timing or already-dispatched merchant-result loss. Reproduced before fixes: model thinking disabled restart (/tmp/pb-recheck-stale-result-openai-before.json); awaiting audit acknowledgement blocked reset (/tmp/pb-recheck-stale-audit-before.json). KioskScene restart now gates real native operations/ready binding using lifecycle-cleared operationId map, enters resetting immediately (sync cancel ASR/Jev/Main/TTS), records old visitor independently, leaves cleanup solely with resetInteractiveSurface rather than late duplicate clears. Keep this cancellation-before-logging rule; no relaxation of native pending/unknown-effect gates. Reports separate old18/19 and latest8 by build, NOT one same-version total.

- Actual local Jev Qwen/Qwen3.5-4B: first12 steps pass, then 看A套餐 selected intent:read-item at0.9203 despite open-window candidate, no product window; /tmp/pb-recheck-ordering-jev.json FAIL. Restored OpenAI through normal admin API and verified. No full Jev pass/fair provider ranking (requires same frozen state/candidates/random outputs); do not classify missing candidates/program errors as model errors or hide semantic misses with regex. Source audit scope/results/remaining boundaries at leading Nov15 Windows Kiosk plan.

- Latest user clarification: reasonable aliases are allowed (三杯雞→三杯雞便當); the rejected design was assigning the generic 套餐 only to B and excluding A. Wiring v3 restores the accepted alias and shares 套餐 across A/B; separate ambiguity regression prohibits a unique purchase. Initial seed mirrors this policy; already-published settings unchanged. /tmp/pb-wiring-audit-cases-v3.json supersedes v1/v2 for current inputs/options; still forced model answers, not accuracy. Device backgroundSpeechMode=off must NOT offer IGNORE or run admission filtering. Source now gates direct fallbacks, delegated active-request admission and Main scope-question enum with off/observe/enforce (observe cannot veto). Closed local answers offer answer:current plus HANDOFF; Jev still selects, private browser_answer_question is Host dispatch, not a new public tool. PB INCOMPLETE asks for a complete request and retains no speech fragment. Case11/12 Host tests extend past dispatch: quantity answer adds once; product answer asks quantity then adds once. This exposed loss of the original product-query target across questions: question tickets now retain that query separately from the unmodified request; unparsed customization still cannot auto-add. Validation: Kiosk7files400, Server4files76, scope8 pass; both app types, separate integration types and scoped lint pass, no root typecheck. Latest sources remain unapplied to running build22:58:50; no runtime/profile/model/merchant changes.

- Latest Nov14 late-night source-only wiring audit, before further model comparison:6 concrete program defects fixed after12 failing regressions: numeric dish names/aliases lost quantity-edit candidates; multi-item alias resolution differed; observed menu/cart screen was omitted; cart product refs were ignored; returned unknown/partial receipts were classified as definite refusals; failed observation-only recipient calls blocked action decisions. Kiosk486 pass/46 live replays skipped; Server scoped191 and final HTTP117 pass (overlap, do not sum). New tests/integration/browserDecisionWiring.test.ts covers actual production candidate source→projection→Hono/schema→provider encoding/decoding→Host dispatch,12 cases×dasein/lookski/OpenAI×plain/segmented=72 forced-answer wiring paths, NOT model accuracy or native-site execution. App types, independent strict integration typecheck/lint pass; no tsconfig changes/full-project check/commit. Runtime still build22:58:50 below; latest source fixes NOT applied to operator Electron/API. No runtime restart/profile activation/merchant URL edits or true model calls this turn. After23:00 only our own fixture; do not reopen a merchant-bound operator for acceptance. Before fair real-provider comparison, refresh runtime then freeze actual facts/candidates/question/prompt/profile per case; missing/incomplete compiler candidates are program coverage failures, never model mistakes. See new leading Windows Kiosk plan section.

- Production-candidate audit after benchmark correction: actual createBrowserFastPathSource + real createBrowserDialogue regression reproduced2 defects, now fixed: missing-serving question has separate intent:ask-quantity (no guessed quantity/purchase), and local answers describe the actual issued question instead of labeling product choice as quantity. Retained staged routing recognizes read-item/ask-quantity as ITEM/non-purchase;2 regressions failed before fix.16 producer cases cover negative purchase queries/greetings/cart/assent/compound requests, explicit servings, final quantity, duplicate cart rows and search cancellation. Kiosk216 + Server60, scoped types/lint pass. Build22:58:50 applied; actual isolated built Electron/localAPI/OpenAI+Main/loopback fixture17 utterances + real180+15s reset/new A03 pass (18 steps), actual trace confirms ask-quantity then answer:current;14 final direct routes/3 Main, not total model-call count or accuracy. Report /tmp/pb-production-candidates-ordering-openai.json and log. Operator Electron/API/Web restored, no merchant submit/commit/deploy. Voice/TTS503 remains deferred. NOT whole-system acceptance or provider ranking; fair comparison using production-generated candidates still pending. Formal details in leading Windows Kiosk plan.

- Benchmark correction after user challenged candidate validity: the23-case directDecisionProbe handwrites/reuses7 menu options (including fixed pork2) and4 edit options instead of invoking the real PB candidate generator. All8 reported wrong utterance types received that same7-option menu; most had only phase=ordering, without real cart/menu/dialog facts.20/23 vs15/23 are artificial-choice matches, NOT sufficient evidence of application accuracy or provider ranking. Real built-Host/API acceptance remains separate valid evidence. Pending: compare providers on identical real snapshots + production-generated candidates/live questions; separate candidate construction failures from semantic errors. Do not repeat the earlier model-ranking conclusion from these23 cases.

- Nov14 direct decisions + native OpenAI implemented and active for local testing. UI/Electron build22:20:47, Server restarted after final semantic prompt. Native `/v1/decisions`, encrypted key, real readiness/admin activation, optional models discovery, provider-selected routing and Server-owned backgroundSpeechMode wired; Jev retained, SLM unchanged, Main/voice unchanged. Ordinary choices direct; lifecycle review/idle/customer-entry/active/incomplete retain existing correlated protocols. PB tables are real facts/all choices rather than an unasked question. A套餐 candidate gap reproduced/fixed: shorter B alias 套餐 was masking the exact target; shared productMentions suppresses contained labels but keeps separate/shared-label ambiguity. Server93 + HTTP113 + final direct/HTTP12 + Kiosk112 + Shared4 + Chromium2, scoped typechecks/lint pass; no full-project checks. Actual final23-case probes twice each: Jev15/23, OpenAI20/23, median216.5/290ms (decision only); still high-confidence wrong selections, not accuracy acceptance. OpenAI broad-candidate total-price query still picks add; actual Host negative test prevents purchase but only answers item data/single price, missing the agreed add-to-cart-total invitation. Record this as unresolved UX, not completed. Actual built Electron/new device/loopback fixture/real API+models17 requests passed plus REAL180+15s clear/nonempty-cart/return-table/new A03 visitor;13 final direct routes incl quantity question,4 general Main handoffs, not total Main-call count. `/tmp/pb-direct-ordering-openai.json` and log. Additional8-request no-unconsented-purchase/assent-clarification journey + real reset passed (`/tmp/pb-direct-semantics-openai.json`); Jev search/reset passed, full Jev stopped at 看A套餐 choosing read instead of opening, failure retained. Final raw probes `/tmp/pb-direct-{jev,openai}-probe-v2{,-repeat}.log`. Old17-case baseline remains frozen. UI proof `/tmp/pb-openai-decisions-enabled.png`, admin `/admin/system/models`. Original operator Electron/API/Web running; no merchant submit, no commit/deploy. See leading Windows Kiosk plan for exact evidence/limits; do not call production-ready.

- Nov14 late table/state audit (scoped built-Host acceptance completed; do not call all connected): actual operator session `QqCz4aGomUJAWwT-4za_a` proved table clarification projected as information_ready and caused four repeated Main calls. Shared outcome + Host now stop on real questions/replies, ignore dataOnly retained questions, and skip later same-batch tools after rejection/unknown. Default table is actual visible selection; Start does not reselect same table, checks again after hand movement; native text-node changes synchronize buttons; one large-button hand cue with shadow hit testing. Native menuReady requires actual cards; Host checks replacement-document menu/table before announcing ready. Original persistent Electron blank root remains unreproduced, not proven fixed. Actual built-Host replays found two more defects: item clarification parsed table facts without products (fixed table admission first); Main copied historical counter after touch B3 (now proposal_rejected with fresh selectedTable, allowing correction without customer reselection). New regressions failed before fixes; latest3 Kiosk files253 pass, earlier broader543 + Shared14 + Server96/11skip, Chromium table18, native smoke pass; scoped typechecks/lint pass. See leading Windows Kiosk plan for exact evidence/limits. Final build21:29:10 applied, API/Web and original operator Electron running with login retained. Disposable Xvfb built-Host + actual configured models + intercepted loopback fixture passed17 requests and real180+15s idle reset/new A03 visitor; report `/tmp/pb-state-audit-ordering-accepted.json`. Latest Main request explicitly contained B3, yet initially proposed old counter; correction succeeded without reselection. Jev only1/17 direct (quantity answer),16 Main; fastpath accuracy/speed remains unaccepted. Native heap5.91→7.44MB only single-run evidence. Voice/TTS503 remains deferred; no provider/profile changes or merchant submit.

- Nov14 live/fixture parity: Chromium side-by-side before merchant submit found real divergences; fixture v3 now defaults counter on table entry, omits old cart/table props there, scrolls categories instead of filtering, searches globally with matching tabs, removes cart row at zero, removes artificial99 quantity/200char note limits (235char live note accepted), matches one-extra label/edit wording and radio5/2/3/4/6, resets invoice/notification/order note only on checkout page entry.19 scoped tests pass; actual PB service10 browser checks pass on fixed v3 including select-table and duplicate-row partial replace; live and fixture own test rows cleared, no merchant orders. `/tmp/pb-fixture-executor-parity-report.json`, `/tmp/pb-parity-observations.json`. See leading Windows Kiosk plan and fixture README for exact matrix. NOT whole-site interchangeability: load/network races, browser-history cache, scroll-spy, cross-device cookies and post-submit/payment/receipt remain outside this parity evidence; switch via new reception/binding. No production/voice/model config changes.

- Nov14 follow-up after user challenged stopping at audit: implemented native introduction-batch trusted-input locking (Host ignores corresponding raw native activity; ownership-safe release on failure/cancel/replacement) and dedicated idle continue/end Jev semantics with expiry/ticket/visitor checks plus receipt-time idle tagging, so queued speech cannot become an order after a touch resumes. Semantic end reuses existing restart/error presentation. Chromium21, Kiosk23, Server routing48 and original native Electron smoke pass; new regressions failed before fixes; Kiosk/Server scoped typechecks and lint pass. Full-TTS lock and complete built-Host idle reply acceptance remain unverified. Actual Jev selected CONTINUE/.9912; browser-only accelerated clock rejected real Server checkpoint expiry, and aligning Date invalidated the idle deadline. None of these accelerated attempts counts as acceptance. New runner scenario idle therefore requires real time; not yet run to completion. Disabled/unavailable Jev leaves touch/countdown; no Main fallback. See leading Windows Kiosk plan supplement. Background mode/runtime and Jev fastpath performance gaps remain open.
- Follow-up local build20:38:31 applied; manager confirms API/Web running and operator Electron open. Restart now rechecks reception generation/visitor after awaiting its record, and shows errors only to the same anonymous customer, so a delayed record cannot reset or mark the next reception failed. Voice/provider settings and merchant data unchanged. No full-project typecheck/commit/deploy.
- Nov14 latest cross-layer audit fixed13 concrete boundaries: actual Jev candidates/choices, native dialog facts, question aliases/configuration choices/async errors, Main table equivalence, PB uncertainty incorrectly read-only, merchant descriptions/read-only replies, visual no-effect classification/dwell/viewport wait, and native renderer-exit notification/admission. Details and evidence are in the leading full-chain section of docs/plans/2026-10-28-windows-kiosk-electron.md. Confidence threshold unchanged; no phrase whitelist.
- Final built-Host acceptance: build19:30:06, normal systemd/user-service, isolated fresh device/profile, local API/published revision8/real Jev+Main, CDP interception to loopback fixture (no merchant writes).15 sequential requests passed plus REAL180+15s idle clear/return to configured select-table and next A03/A3 with a distinct visitor ID. Heap6.54→6.89MB. /tmp/pb-ordering-audit-accepted.json and /tmp/pb-audit-normal-clean-final.log. Earlier native OOM/timeouts were traced by heap sampling to Vite client unhandled-rejection console forwarding with blocked WebSocket (~4GB); proxy now strips HMR HTML injection. Do not count those failed/partial attempts as acceptance. Renderer exit handling also has a forced-exit regression (failed before/passed after; no writes). Browser presentation/operation19 checks, Desktop typecheck and lint pass. Test manager API/Web running and operator Electron reopened; diagnostic unit/CDP stopped; original operator login retained.
- Jev performance acceptance remains open: final16 customer utterances had1 direct execution and15 Main handoffs. End-to-end fixed-case times1.96–7.66s do not prove Jev speed benefit. A03 purpose ANSWER/SINGLE split yielded confidence0.5576<0.6. Investigate stage option boundaries before claiming the agreed fast semantic path is achieved; do not silently lower the threshold. Physical voice/mouth remains deferred.
- Audit-confirmed unfinished implementation (backgroundSpeechMode has since been wired above): full-TTS introduction lock remains unverified (text/cue batch lock and idle continue/end semantics subsequently implemented above); Host notification phone/Email, customer-confirmed AI submit, submitted-order reconciliation/Admin typed order data and full invoice voice flow remain unconnected. SSE customer text/TTS still waits final validation. These are implementation gaps, not merely environmental tests. Do not repeat earlier completion claims.

- Nov14 idle-entry fix: after verified native clear, always reload configured select-table entry (not current URL); revoke old document tools synchronously. Pending old cleanup/results cannot own the replacement reception. select_table requires tableName; start_ordering_at_table may use the current selection. Required-field deletion across all17 tools and18 malformed parameter cases cover the compiler boundary. Earlier build/check counts are superseded by the latest audit above.
- Nov14 revision8 real Jev synthetic probe: all4 cases (cancel open selection, remove cart meal, assent to explicit serving, combo contents query) handed to Main; no website effects. Several purpose/family stages below confidence threshold. NOT evidence of improved fastpath accuracy; no threshold reduction or phrase whitelist added. Prompt config applied but full model-route acceptance remains pending.

- Nov14 user explicitly postponed voice/mouth investigation; do not resume it automatically. No voice/provider settings changed. Current VRM asset Yynd4XWHhI-8BOc5Gh_E- has all5 mouth expression binds; Kiosk connects TTS audio automatically, no mouth toggle found. Actual recent speech timings fail before audio-ready/playing. Selected 台語tts/gpt-sovits points at .../v1 with voice default: configured /v1/audio/speech returns404. Authenticated public OpenAPI shows /audio/speech and /audio/voices at root; root rejects default400, lists only yiting. One fixed root+yiting probe returned200/audio-mpeg/11493bytes, but this correction was NOT saved per user's deferral. No physical mouth movement verified.
- Nov14 user-provided prompts reconciled with actual local revision7 and saved Jev policy. Saved plain full-word Jev instructions and rewritten5 role-card fields via existing services, published local revision8;6 matching same-site drafts updated, other custom cards preserved. Provider profiles byte-for-byte unchanged; merchant binding/aliases retained. Clarified context-dependent cancellation vs cart removal, delta vs total quantities, one-serving assent, only issued choices, complete multi-item candidates, independent Main reasoning, direct answers plus one next step, no repeated confirmation or forced old-question answer. Full exact saved text is in leading Windows Kiosk plan section for revision8. Voice investigation remains deferred.

- Nov14 Jev handoff/SSE follow-up: actual active chat is qwen36/SSE. Local session CX4pdljsMeNnROLq_EyRU entry155 and a real selected-Main replay reproduced valid service/assistant/new-request plus unused question echo; strict unused-field validation discarded handoff as invalid. question is now consumed/validated only for clarify; admission/disposition/requestKind still strict. Real Main replay after fix returns NEEDS_ASSISTANT. Current website productDialog now supplies selected dish/screen and explicit close-via-return-menu candidate to Jev, without phrase whitelist. Adjudicated current service retains non-operational clarification on review failure; unknown/background/cancellation do not gain tool authority. Removed misleading simulation status claiming no AI was called.141 scoped tests (Server29/Kiosk108/JSON+SSE HTTP4),4 real Jev synthetic cases allowing Main abstention, scoped Kiosk/Server typechecks and lint pass. Actual local vLLM minimal SSE probe returned200/event-stream/text delta/[DONE]. Important outstanding: SSE delta callback only updates progress; customer text/TTS still waits final receipt validation, NO word-by-word display implemented. Do not claim lower first-spoken latency from SSE setting alone. Isolated build17:35:01 applied; API/Web restarted and Electron reopened, host status verified. See leading Windows Kiosk plan matrix; no merchant writes/full live acceptance.

- Nov14 A套餐 detail regression: local session CX4pdljsMeNnROLq_EyRU entries90–106 proves Main successfully opened A套餐, got 水餃12顆 + 蛋花湯/136 and drafted the right answer; questionPresentation ignored open_menu_item_details evidence and replaced it with no-verified-result fallback. Fixed final receipt summary to join only current productDialog names against same-receipt products; never announce the whole returned catalog. Explicit get_menu_item_details also preserves website details (previously price only); no generated facts admitted. Five regressions, including wrong/missing/failed dialog guards; two positive cases failed before fix.68 presentation tests, scoped Kiosk typecheck/lint pass. Isolated build17:25:36 applied, API/Web restarted and Electron reopened; host status verified. See leading Windows Kiosk plan section; no merchant writes/full live acceptance.

- Nov14 saved-prompt audit: actual local release6 and saved Jev instructions did not hardcode old browser_* names; earlier migration defects were not explained away as operator error. Found conflicting saved postHistoryInstructions (stop guiding after answers) and assistanceReminderPrompt (ask vs no questions). Updated only those text fields plus a typo through existing profile services, published local revision7, verified device assignments, and aligned5 same-site drafts. Jev saved policy wording now covers text and ASR input and explains target/Application/references in Chinese; candidate codes/store instruction preserved. Built-in Jev multi-operation guidance now defers only if no single offered candidate covers the whole request, matching existing batch support. Source skill/native/public receipt prose expands 加車/空車/原車; fixed ambiguous public quantity hint to 指定餐點全部不要時使用remove_items_from_cart. Merchant binding/aliases/models/credentials unchanged.378 focused tests pass (Server128/Kiosk239/Shared11). Isolated build17:15:43 applied; API/Web restarted and Electron reopened, host status verified. See leading saved-prompt section of Windows Kiosk plan for durable cross-boundary audit checklist. No merchant operations or full live dialogue acceptance in this audit.

- Nov14 broader public-tool audit after user challenged prior coverage: confirmed additional migration defects: recommendation dedup read native args instead of public names/purpose; correction routing ignored public receipts; large-result/model receipt hints named private tools; public alias Host resolution was rejected by Server literal binding; readable cart targeting schema capped200 vs2000 in domain. Fixed these boundaries using the existing registry, consistent alias resolution on public reads/details/presentation/questions/cart targets, shared cart target schema, and exhaustive public dispatcher typing. Added17-operation real-compiler route cases and HTTP preservation of all17 schemas, multi-round public recommendation guard, alias authorization/ambiguity and long configuration cases. Root failure was incomplete migration plus predominantly native-path tests; do not describe unit/type passes as full end-to-end acceptance.
  Validation:402 Kiosk units/8 files; Shared11 (includes menu/cart/checkout, read-only, empty/populated cart and pending/login/review state matrix); Server6 files230 passed/1 outdated prompt assertion, then updated current prompt vocabulary/semantics and targeted6 HTTP cases passed (includes former failure). Three scoped package typechecks and scoped lint pass. Separate native Electron/Xvfb synthetic journey smoke passed;6 real Jev synthetic pending-question cases passed with allowed Main abstention (not6 guaranteed fast hits). No merchant writes. Current source of truth: leading public-tool audit section in plans/2026-10-28-windows-kiosk-electron.md. Isolated build17:08:54 applied; API/Web restarted and Electron reopened. Production and merchant data unchanged.

- Nov14 fish recommendation/confirmation regression: actual local session proved add_items_to_cart recorded browser-confirm-add/questionId correctly, but Server findPresentedQuestion ignored public names (browser_ prefix only), so browser-answer returned UNCERTAIN. Now canonicalizes via existing nativeOrderingToolName registry, preserving stale-turn checks. Jev pending questions now precede search recovery and expose every issued choice; Jev-selected semantic answers bypass only the literal pre-Main shortcut, still use independent answer/freshness validation. Public add finishes the sealed confirmed proposal immediately and stops the batch, instead of returning only data/repeating the question. A single prepared/shown recommendation attaches a bound one-serving offer; yes/explicit count adds once when required fields complete, no bare-recommendation consent. No phrase whitelist expansion. Validation:230 Kiosk units/5 files,14 Server answer/route cases, Kiosk+Server scoped typechecks and scoped lint pass. Initial regression tests failed on the reported lookup/search/confirmation paths before fixes. Isolated build16:52:47 applied, API/Web restarted and Electron reopened; no merchant/cart mutation in validation, no full live/Electron dialogue acceptance claim. See Kiosk README.

- Nov14 follow-up: LLM creation already exposes auto/json/sse after choosing OpenAI-compatible (default new kind Ollama); added creation regression, editor/card total6 Chromium cases pass. Host and actual Admin catalog probe successfully reached http://192.168.8.64:8000/v1, model qwen36, no key; minimal JSON and SSE generation both HTTP200. User connection failure not reproduced; no profile saved/activated. Removed merchant loading branding/full illustration; status only appears visually after700ms, no change to native ready/failure/isolation. Native surface6 Chromium cases including delayed visual capture and scoped lint pass. Isolated build16:33:23 applied; API/Web running and Electron reopened, confirmed by host manager status.

- Nov14 LLM streaming setting visibility follow-up: actual local Admin UI confirmed `/admin/system/models` → 設定對話LLM → 編輯 already exposes auto/json/sse for OpenAI-compatible chat, and local chat profile remains auto (no model/config switch). Improved outer capability card + Provider list to show current selected mode, moved editor control immediately after Provider type. Existing provider verification/save/runtime/router66, Kiosk HTTP JSON/SSE4 and Chrome editor/card5 pass; Stage Web scoped typecheck/lint pass. No backend transport rewrite needed. Applied local build16:26:16 Taipei; API/Web/Electron restarted, host status running/open. Built Admin UI verified via CUA: outer card/list now show auto and editor response selector is second field with JSON/SSE options. Screenshot /tmp/pb-llm-response-mode.png. No provider mode/model changes. Architecture audit: no new user decision is required for Jev/Main ownership. Do not claim all historical phrase gates are eliminated: PB plainMenu still uses literal forms to decide direct read completion; table entry narrowing/Start and quantity/slot compiler coverage also retain text rules. Separate necessary argument parsing from semantic admission, test varied forms + negative examples, and do not call incomplete generalization a finalized design.

- Nov14 third acceptance fixes: local build16:18:09 Taipei updates Web/Electron/API source; test PIN now0000 (new installations default0000, startup preserves operator choices), release6/new PB URL retained. Search cancellation is no longer admitted by transcript phrase lists: actual nonempty native query issues recovery to Jev; direct semantic recovery choice keeps0.6 confidence threshold, other demands/weak scores go Main. Valid local slot answers retain the old question; pending selection exposes cancel to Jev. Ordinary return/cart/recommend/replay capabilities are state-based; literal product/count/configuration parsing is auxiliary, not intent authority. Table code matching narrows targets; counter/Start remain available for semantic answers. Host-only intentSource=jev is assigned only after a selected issued action, never from model args.
  Local transcript proved repeated return failures were public no-arg parsing of Main's `{parameters:"{}"}` before any website dispatch. Fixed no-arg business tools now own their empty arguments, while parameterized/cart/session checks stay intact. Native table/counter/Start now use actual hand taps; immediate post-Start navigation cannot turn a dispatched tap into a visual failure. Removed obsolete floating audio status component from Kiosk (yellow diagnostics retained) and failed request badges.
  Recommendations reserve facts/cards with prepared cue (no premature frames); visible text triggers mention-ordered single-dish cues, voice playback segments trigger them in voice mode. Serialized cues cancel by reception/document; only actual shown dishes enter history. Segment-level, not word-timestamp synchronization. Kiosk/Server scoped typechecks, native strict browser entry check, scoped lint pass;279 Kiosk units across6 scoped files (last added cue case separately),41 routing,25 Chrome,15 manager cases. Actual Jev6 synthetic positive/negative checks allow correct Main abstention; do not claim all6 fast. Short contextual cancellations still sometimes score below threshold. Original native Electron Xvfb/portrait fixture PASS (prepared emits no dish frames, three sequential cards, clear search, counter/table/Start reconnect and original isolation regressions); API/Web/Electron restarted and host status verified running/open. Current HTML imports pages-B-tVX-Pr.js (no old overlay); retained obsolete hashed assets are not active. no merchant writes/production deployment/commit. An initial virtual-display smoke failed on its deliberately hidden popup; rerun uses existing KIOSK_TEST_PORTRAIT=1 mode to provide compositor frames.

- Nov14 second customer acceptance fix batch: source/isolated build15:44:30 Taipei refreshed, API/Web restarted and local release6 published via existing draft/publish service (9 alias rows + seating greeting, other snapshot/model fields retained); Electron reopened. Current new PB URL unchanged. Actual local transcript proved B3 吧檯 suffix mismatch, and independent Main extracted 排骨便當 but code compared against 炸排骨便當, causing broad choice + repeated named answers + Host quantity readOnly refusal. Table resolver now covers counter pickup/takeaway and real B1–B7 bar names, ignores leading zero/case; delivery gets explicit dining/counter-only explanation; compound table+food stays Main. Start waits native ready and gives ordering guidance. Exact issued name/unique configured alias replies resolve locally; sealed explicit prior count + no missing required options/unparsed preferences can finish once, preserving freshness and price. Quantity questions may be asked in read-only routing and present the selected dish. Independent count extraction normalizes only immutable session-profile aliases, still verifies counts/options/notes and rejects shared aliases. Public name compiler also resolves trusted aliases.
  Native recommendation now presents each dish with its own label/scroll/frame and~1s dwell; only full completion returns aggregate shown. return_to_menu available on menu/search/recommendations, clears native query/unadded selection/frames and waits all current cards, keeps cart. Finite close now also retires Host question/search; Host recommendation strip clears on search/return/close. Empty search gives concrete recovery guidance and stops Main continuation; hidden paging retained but spoken extra-options suffix removed. Kiosk customer/diagnostic/TTS use existing ordering vocabulary converter (虱目魚/菜單), original inputs/records unchanged. Error labels use assistant name, unknown results remain explicit.
  Validation:305 Kiosk targeted units/9 files;7 Shared;77 independent semantic;10 HTTP plan route;17 Chromium; original native Electron Xvfb/intercepted smoke includes exact3 single-dish batches in order and filtered-menu return, zero merchant writes. True Main2 fixed synthetic regressions pass (alias count and empty-search abandonment). Kiosk/Server scoped typechecks, native entry strict browser typecheck and scoped lint pass. Tests are not full merchant/hardware/Jev-accuracy acceptance. Source seed also has9 reviewed alias rows including deliberately shared 雞腿飯/牛肉麵/combo so ambiguous names do not select a random SKU. No production deployment/commit.

- Nov14 update applied with explicit user approval to stop/reopen: isolated build refreshed14:27:24 Taipei, API/Web/Electron restarted. User then identified the still-active RD URL: build fallback did not override published release4. Through existing saveProfileDraft/publishProfileDraft, cloned current local test snapshot and changed only interactiveService URL/description; local revision5 assigns all test devices to https://app.esgpb.com/order/store/1kgJeql/internal_use/menu/select-table. Initial seed and build default also updated; model/device/other profile settings preserved, no production publication. Electron reopened after revision5. Ordinary sandbox manage.py status cannot see host processes and falsely reports stopped; use escalated read-only status for actual host state. Initial protected build refusal was correct. Never overwrite a running test without consent.

- Nov14 user-reported table-entry/Loading/clipboard fixes: standalone assent/table+Start closes only after a correlated entry receipt; extra meal demand waits for fresh discovery. Shared client ready-wait follows navigation gap with15s/caller cancellation. Native placement contract adds loading so resize/overlay updates cannot expose/announce a half-loaded website using the old loadURL promise. Added approved current app.esgpb.com/1kgJeql/internal_use journey and local-build default; no published profile edit. Loading simplified after user feedback: no branding/illustration; neutral small status delayed700ms, actual readiness unchanged. Corrected loading/error i18n keys formerly nested under cart-handoff. Trusted Host/owned text popup get sanitized clipboard write only; popup Copy uses clicked ownerDocument navigator, dialogue text selectable. Disposable Xvfb native smoke passed OS Host/popup Copy + Ctrl+C/V and current-URL nine-second table navigation/resize; all PB requests synthetic/intercepted, not merchant acceptance. See leading plan section.


- Nov14 user retired the old Stage Web character/chat page. Removed stage-web/src/pages/index.vue and its exclusive OrderMenuPanel, ChatDiagnosticsOverlay and usePersonEyeFocus. Existing `/` -> `/kiosk/` guard retained; `/admin` and shared packages/stage-ui remain in use. Stage Web build and package typecheck pass; generated router declarations no longer contain IndexScenePage. No deployment or test-system restart.

- Nov14 user-authorized cross-row/dumpling/customization implementation completed LOCALLY. Current source of truth is the leading cross-row section in plans/2026-10-28-windows-kiosk-electron.md; supersedes older multi-row replacement refusals below. Public17 tools now accept piecesPerServing (8-base dumplings, current price/limits), copyFrom for explicit same-meal additions, and per-option patches (0 removes) for same-product replacement. Unspecified options/notes retained; cross-product replacements do not inherit them. Host compiles equivalent lineRefs+retained source total. Native group replacement verifies new servings first, then every source edit. Truly indistinguishable rendered rows are interchangeable only within the admitted exact group; verifyCartRowEdit proves the actual affected identity/full snapshot. Different customization/price never grouped. Jev complete literal pieces+servings shares parsing with Server claim; complex cases Main. Main plan admission and independent semantic extraction preserve original source customization. Unique known spoken PB dumpling name resolves to one canonical SKU. No new submit/payment tools.
  Validation:190 Kiosk tests;9 Shared;91 Server domain;50 native cart;20 Chromium controls. Local original-executor UI9 checks passed, including two manual identical extra-dumpling rows and partial replacement, restored original cart/total; screenshot /tmp/pb-customization-compat-20261114.png. First UI run interrupted by development HMR, not counted; marked test leftovers cleaned and fresh full rerun passed. True-model synthetic9 tests passed (6 Main tool selection,1 effect-check test covering copy+customization,2 Jev candidates); no full-route/Electron/hardware or broad accuracy claim. Kiosk+Server scoped typechecks and strict PB-native-entry browser typecheck/native service bundle/scoped lint pass. Stage UI full-package typecheck FAILS on existing DOM.Iterable and test typing issues; config not altered to hide them. Native bundle rebuilt, no test-system restart/profile switch/deployment/commit or merchant submit/payment. Refresh isolated test build before Electron acceptance.

- Nov14 follow-up Jev check: existing `liveReplay.test.ts` service-scope contrasts ran against the previously recorded Jev endpoint:8 passed (remaining67 not selected). Existing cart/question/category/preference/price/phone routing regressions:131 passed; PB fast-path/tool adapter:44 passed. The latter175 are model-mocked/policy checks, not live accuracy. The first attempt to run the whole historical replay was auto-review rejected pending payload audit; a source-audited subset containing only fixed synthetic utterances/state was subsequently approved. Full live PB purchasing/quantity/recommendation replay and Electron E2E remain pending. Notification-phone entry and customer-confirmed AI submission were already planned under P4/P5 but are not connected by the17-tool/six-follow-up implementation; payment remains excluded by the user's latest clarification.

- Nov14 six user-authorized follow-ups implemented LOCALLY, not deployed. Current source of truth: plans/2026-10-28-windows-kiosk-electron.md Nov14 table; it supersedes historical remaining lists below. No more decisions were needed for these versions.
  1) Final transcripts appear immediately with queued/processing/completed/cancelled/failed state. conversationMessages.ts groups uniquely identified replies by original utterance; shared ChatHistory after-message slot renders status. Display sorting does not rewrite durable/model evidence.
  2) useKioskInteractionRecording.recordTranscript saves once per utterance, audio links exact transcript+visitor session. Admin UI/ASR export share interaction-media unique explicit matching; chronological/activity/position guesses removed. Same words in different utterances are preserved. Admin raw-audio list retains access to unlinked originals. New receptions detach pendingAppend; old acknowledgements/errors do not block/overwrite new work. Historical mismatch root cause is not proven, and old links are not guessed/repaired.
  3) recommendationSession owns category/reception budget scope and additive name exclusions. list_menu_items optional criteria patches; allowedTerms removes specified exclusions; accepted price relaxation clears only price. New categories must be real configured labels; otherwise use keyword search. Main interprets semantics; Jev/native presentation use the filtered pool. No ingredient/allergy guarantee.
  4) Yellow voice panel shows mode, mic/VAD/ASR, block reason, timestamps and TTS overlap. Kiosk Admin separate test enables mic/TTS/interruption even in text mode; useKioskVoiceTest cancels on close/reopen and never enqueues customer tools/messages. Physical echo/hardware not validated.
  5) Jev source compiles complete batches of up to3 distinct no-option meals; per-step fresh versions, partial effects retained, incomplete requests Main. Routing family/effect coverage admits complete multi-item candidates. Rotation/replay use real shown refs and current criteria. Real Jev comparison remains unavailable, not a measured speed/accuracy claim.
  6) orderingNextActions offers only receipt-supported navigation. Final presentation adds at most one offer, none on pending questions/partial/unknown effects; no extra Main polishing call and no submit/payment tools.
  Execution seam: browser-ordering/plan.ts now binds public Main business arguments to Host-resolved names/configuration/counts, one claim per batch item; finite set/remove/batch authority is recorded and no longer forced to cart_add. Unique aliases come only from the session's immutable published service binding. Batches use one Host task through browserOrderingTools, preserving verified effects. HTTP public call -> native plan -> independent semantic check and DB once-only/cross-reception tests pass. Public read facts have a final factual summary fallback, overridden by a later actual presentation; no forced extra operation for qualified information reads. Cart configuration exposed to model/targeting is readable description, never canonical private fingerprint. Answered-question context is scoped to utteranceId; search during a missing-quantity question first asks cancel-and-search.
  Validation:361 Kiosk units across14 files;8 shared;152 Server domain +22 focused HTTP;11 Kiosk Chromium +1 Admin pairing Chromium. Kiosk/Server/Stage Web scoped typechecks and scoped lint pass. No root typecheck, live merchant/submit/payment, commit, migration, profile switch or deployment. After23:00 Taipei use local fixture only. Remaining acceptance: real Jev A/B+latency, full Kiosk/merchant E2E, physical mic/VAD/TTS/scanner. This historical scope did not complete every agreed feature; the latest audit above explicitly lists the missing implementations.

- Nov13 user authorized implementation and engineering choice if Jev comparison is inconclusive. LOCAL first batch, not deployed: 17 public PB business tools in stage-shared/orderingTools.ts, execution adapter in stage-kiosk/services/browserOrderingTools.ts. Native browser_* transport remains private; pure list/detail reads do not consume answers. Names/configuration/quantity inputs compile against fresh host refs, prices and versions. Delta additions vs final quantities are distinct. Batch failures preserve earlier verified effects. Public model projections omit host refs/versions.
  Jev finite source now covers simple unique add/alias, quantity question/answer, table equivalence, cart view/return, simple single-row set/remove, random up-to-three no-preference recommendations. Unsupported/uncertain cases still Main. Simple purchase quantity answers add directly; recommendation bare assent asks quantity. Service questions retain original pending ticket when declining cancel-and-search. Native table dropdown synchronizes button state; A3/A03 resolve to one real choice.
  Cart preparation now runs before customer surface admission; storage eviction does not revoke a known same-reception cart. Carrier focus leaves without losing text before meal changes. Completion/reset retires ASR/Jev/Main/SSE/TTS, detaches old providers and isolates recording start/end exact IDs; prior-turn tests cover new-before-old-return. These are local tests, not deployed physical voice acceptance.
  Real Jev wording probe timed out after30sec; no new measured accuracy. Opt-in Server pbToolWording.test.ts uses JEV_TOOL_WORDING_URL for broad/bounded/no-reply comparison. Chosen bounded purposes/replyType is engineering judgment under user authorization, not an experimental win.
  Local PB original-executor compatibility UI passed seven checks, restored cart/total, no submit/payment; screenshot /tmp/pb-local-compat-20261113.png. This is not full Kiosk/model E2E. After23:00 Asia/Taipei use only test-sites/pb-order-lab, loopback5188; do not operate merchant site.
  Validation:340 Kiosk units +6 shared units;13 table Chromium;7 local native compatibility. Server initial157 passed with2 stale table assertions; migrated public JSON/SSE table cases +skill/receipt7 pass. Kiosk/Server scoped typecheck and scoped lint pass; no root typecheck.
  Historical Nov13 remaining list is superseded by Nov14 above; full Kiosk and physical acceptance / real Jev comparison remain. Multi-line equivalent-row replacement refuses pending clarification; complex selection paths retain existing Host behavior. Historic recording/transcript mismatch remains unreproduced. Source-of-truth plan: docs/plans/2026-10-28-windows-kiosk-electron.md, Nov13 first-batch section. No commit, migration, profile switch or deployment.

- Nov13 local PB fixture v2: `test-sites/pb-order-lab/README.md`, loopback
  5188 via `start.sh`. Captured public API numeric IDs/attrs, three categories,
  A/B combos now136/150 (earlier UI116/128); frozen revision prevents test drift.
  Real `createPbService` browser check exercises DOM+Inertia/API reads and native
  add/quantity/icon-delete, without mocks. Keep draft order context after last
  removal. Table component IDs change per reload. Exact local journey added to
  shared policy with origin/store/port isolation tests; no arbitrary loopback.
  Cookie-owned in-memory browser-profile sessions use CAS revisions; tab storage
  seeds only new sessions. 15 fixture/protocol/HTTP +3 journey tests pass. Payment/
  receipt UI remains simulated; no original post-submit page was observed.
  Test Kiosk profile/rebuilt Electron/voice acceptance remain unconfigured and
  unverified. No merchant writes, production config, commit or deployment.

- Nov13 later request IMPLEMENTED locally: OpenAI-compatible Chat Provider
  response mode auto/json/sse, neutral ai-provider schema, migration0049,
  profile save/revalidation, real SSE verification, runtime upstream policy and
  Admin selector. Auto retains current behavior; JSON disables upstream stream
  only for streaming callers and preserves internal JSON decisions. JSON-provider
  results still finish Kiosk's event stream. No migration, deployment/restart or
  active profile changes. Server/Stage Web package typechecks, scoped lint,
  Provider/control/runtime/router/admin tests and Chromium selector tests pass.
  Full Kiosk route suite has two existing table-prompt wording assertion failures,
  left unchanged; focused true-SSE and JSON-provider Kiosk SSE tests pass. Tool
  redesign remains planning: master uses finite question choices plus Host
  execution, no public generic order_answer_question. Remove that proposed Main
  tool; narrow add, distinguish cancel selection from cart removal. Plan has
  proposed Jev intents/executors, not implemented coverage. See server README.

- Nov13 preceding DISCUSSION/PLANNING ONLY; no production code, deployment, profile or
  merchant state changed. User-approved decisions, source/master audit, proposed
  tools, staged modification plan and unresolved/test index are now the leading
  `2026-11-13` section of `plans/2026-10-28-windows-kiosk-electron.md`; read it
  before continuing. It supersedes Nov12's universal second add-confirmation:
  explicit item/quantity purchases and completed quantity answers add directly;
  recommendation-only "好" still needs clarification. No pre-cart combination
  quote tool. Restore independent background mode and Jev/Main paths, widen PB
  finite execution, synchronize native dropdown/touch/voice table choices and
  A3/A03, restore master VAD diagnostic capture/block stages. Plan prioritizes
  cross-reception ownership: reuse session/utterance/task/question/operation and
  document IDs plus lifecycle generation; old ASR/SSE/tools/TTS arriving AFTER a
  new reception opens must never update or act on it. Queue already has reset
  generation/abort; recording start/end and all consumers still need audit/tests.
  Valid new requests during cart writes are retained with visual status in formal
  dialogue, not dropped or spoken as "received"; serialize writes. Final barge-in
  reply arrangement, tool names, recommendation policy, request merge limits and
  optional Main prose polishing remain undecided. Browser CLI skill command was
  unavailable; audit used source/tests/prior RD screenshot, not fresh live UI.
  Latest steering: prioritize NEW tool names and model-facing descriptions first,
  without old-tool crosswalk; plan now has 17 proposed descriptions, not deployed
  schemas. Simplify user explanations; UUID was an example, reuse existing IDs.
  Track audio/transcript mismatches separately from ASR quality: inspect capture,
  activity-entry/audio upload and transcript linkage under out-of-order delays;
  not reproduced or fixed. Browser CLI issue affects only agent inspection,
  never application runtime. Settle tools/parameters/results before wider work;
  retain correlation/reset correctness and verify new reception cannot deadlock.
  Tool descriptions were subsequently shortened to purposes/selection/parameters;
  internal navigation readiness and lifecycle machinery stay in Host, common
  factual reply rules are written once. User's leaving-during-slow-LLM case must
  revoke old ownership and allow new reception without waiting for old LLM;
  already-dispatched merchant effects still require reconciliation. Existing P5
  plans order IDs/items/prices/timestamps/status/admin history, but deliberately
  excludes full notification phone/email from observations; user's question about
  phone retention is unresolved, not permission to silently change that contract.
  Latest Nov13 verification: target is now user-provided app.esgpb.com /store/
  1kgJeql/internal_use/menu/select-table. GET200, SelectTable, 11 tables, built JS,
  no Vite client/debugbar in response; runtime whitelist still accepts only that
  store's pick_up, so new internal_use is not integrated yet. No published switch.
  Four targeted Kiosk files/84 tests pass, BUT real queue test-only probe confirms
  reset invalidates old ticket while new utterance waits for old process Promise
  despite abort; fix owner/drain lifecycle without overlapping merchant writes.
  Audio audit (no new simulated ASR): admin UI pairs by nearest preceding voice
  activity, then array index fallback; ASR export also uses nearest activity.
  Susceptible to missing/interleaved records, not confirmed historical root cause.
  Details/evidence and follow-up tests are in plan's Nov13 verification section.

- Nov12 IMPLEMENTATION STARTED at user request; first batch applied to isolated
  test only. Scope/evidence/remaining work at top of
  docs/plans/2026-10-28-windows-kiosk-electron.md. Local API/web/Electron reopened
  through the original manager; published test Profile revision2→3 targets RD
  select-table, preserving other snapshot fields, drafts and prior release.
  No production change, schema migration or real order submission/cancellation.
  Backup DB dump, original frontend/native build, desktop login/profile, assets,
  config and prior publication: pb-test.local/backups/pre-skill-20261112-192459/.
  Old order3940 unchanged/unpaid. Manager status must be checked OUTSIDE sandbox:
  loopback probe failure inside sandbox had looked stopped while API/web lived.
  New code: shared pbJourney/invoiceInput; native origin/store/flow/member-vs-cookie
  buyer checks; canonical menu cart-owner key preserves old member ownership;
  table name included in cart fingerprint. Page-aware fixed Server skill assets
  replace the old cross-stage prompt list, no extra model call; JSON/SSE same path.
  Table buttons enhance the native selector; browser_table_select uses exact
  current names only. Follow-up browser_start_ordering supports voice Start with
  an explicit table or verified selectedTable; Host rejects an unchosen default.
  Native expected table→menu navigation accepts only its correlated entering
  receipt, never cart-write success; new binding still reads table/cart.
  selecting_table context has
  NO cart and exposes only entry/reply tools. Eventa onNavigation revokes/rebinds
  full documents with serviceId/documentKey/revision, separate from activity.
  Electron navigation handlers now use event details instead of deprecated args.
  browser_return_menu preserves cart/search and retires pending draft questions.
  PB selected carrier/citizen field focus + format check + Enter consumption
  implemented without dependencies, sharing owned Menu format rules. This batch
  uses DIRECT PB-field input, NOT the future Host scan buffer. Blur/reset/nav
  revoke ownership; expected input does not abort guidance or permit cart writes.
  No notification-phone/Email filling tool or checkout submit/pay tools added.
  Native synthetic acceptance29 PASS (all merchant HTTPS intercepted, temp
  profile; includes real keyboard input and guest full-page navigation). Evidence
  pb-test.local/flow-build/skill-integration-20261112-native.log. Chromium controls/
  scanner/table28 + native View5; Kiosk143; PB data/operations53; owned invoice13;
  relevant Server routes/skills pass (table JSON/SSE included). Server/Kiosk/shared/
  Desktop + focused PB entry typechecks pass; no root typecheck. Restored missing
  base/add-on quote details found by native regression; current oral row wording
  updated in fixture. New RD LIVE Main/Jev conversations, speed A/B and physical
  scanner/Windows portrait NOT verified. User confirmed the reopened Ubuntu
  Electron shows the new RD table page and large table buttons. This verifies
  initial rendering only; live ordering remains unverified.
  Voice Start follow-up built/applied via the same isolated manager and reopened
  API/web/Electron. Focused Kiosk69, table Chromium11, Server skill3 and native
  synthetic29 pass; Kiosk/shared/Desktop and PB-entry typechecks + scoped lint
  pass. Covers split-turn selection/Start, combined request, no default inference,
  A1 vs A10, Chinese numeric slots, disabled/ambiguous Start and takeover.
  Physical microphone→ASR→Main/Jev table/Start acceptance remains unverified.
  User corrected the welcome: published isolated Profile revision4 changes only
  greetingPrompt/greetingPhrases to「請告訴我桌號，將會由送餐機器人幫您送餐。」;
  old eight menu/recommendation openings removed from its active phrase bank.
  Other published settings verified unchanged; old releases/drafts retained.
  First-install PB seed uses the same greeting; existing publications stay intact.
  Counter-pickup report investigated on the same RD build: "我要櫃台取餐"
  failed before a Jev model call because browser_cart_get's table metadata GET
  timed out at8s. Fixed table reads to use only current document metadata with
  exact Menu/SelectTable component + URL and guest/member admission; actual
  dropdown choices/readback still revalidate selection. No menu/cart snapshot
  policy change. Synthetic native29 pass including failed repeated HTML reads,
  counter selection and stale component/URL rejection; focused type/lint pass.
  Actual text simulation on RD with active "rtx pro 6000 jev" passed: Jev2
  model calls → Main2 rounds → native counter selection verified; reply visible
  2257ms in this single sample, no HTML re-fetch or merchant writes. Evidence
  pb-test.local/flow-build/counter-selection-live-proof.json. Driver validation
  corrected from absent standalone tool_result to canonical resolved native
  metric + verified reply + pressed-state; did not replay the customer turn.
  This verifies text simulation, not microphone/ASR or the full new-site journey.
  FOLLOW-UP Start failure: the user's B3 selection succeeded; "開始點餐" selected
  the right tool but document replacement disposed its local wait. Also observed
  cold menu loads >8s and >30s in routed diagnostics; longer arbitrary waits were
  insufficient. Final policy acknowledges the native click/approved menu target
  immediately (table-entry-starting, effect:none), with loading/ready separately
  owning actual page readiness. ScenarioSurface now calls beginNavigation on a
  distinct navigating event: no descriptors admitted during load. Only a matching
  native entry receipt may settle across navigation/rebind; old handles, other
  results and writes remain rejected, caller cancellation still ends the wait.
  Schema lives in shared pbJourney. Standalone Start ends its covered Host task,
  avoiding a new Main round using retired table tools; combined food demands do
  not get that shortcut. Failed diagnostic reports retained privately; do not use
  the earlier timeout-based counter pass as final-version acceptance evidence.
  Verified RD's published dining-tables.scan route: base /order + t/{qrToken}.
  Native Start may acknowledge that exact same-origin intermediary via
  isPbTableEntryUrl; readPbJourney/isPbJourneyPage STILL reject it for tool IO.
  Tokens remain native and are not returned to Main. Real closing dropdown can
  briefly cover Start; picker now waits for the actual hit target while checking
  document, selected table and caller cancellation, instead of a fixed delay.
  Synthetic fixture now models QR302→9s menu and waits for native ready before
  invoice discovery; earlier fixture path typo was corrected. Native29 pass.
  Final RD LIVE text simulation passed counter and B3 selection→Start→native
  ready with matching Menu/Show diningTable and visible meals. Start reply visible
  1228ms/2839ms respectively; these are two samples, not a speed benchmark.
  B3 selection encountered one Jev provider failure (~5s), then Main completed
  selection; Start used Jev→Main successfully. No merchant writes. Evidence:
  pb-test.local/flow-build/table-entry-live-proof-{counter,b3}.json. Normal managed
  Electron restored afterward; diagnostic flags absent and CDP port closed.
  Follow-up navigation timing (independent Chromium guest, 1080x1920, default
  cache/no routing, two passes; not Electron/LLM latency): QR302 request took
  127ms/89ms; click→menu rendered with correct B3 took5948ms/5870ms. Table page
  cold load41062ms; repeated load16573ms, with HTML responseEnd16476ms. Separate
  cold attempt39255ms load; many Vite source/dependency modules and _debugbar
  resources observed (~8MB completed responses), so dev assets plus variable
  transfer are demonstrated costs; QR itself was short in these samples.
  Single curl table GET: first byte3.04s, total23.48s/316545bytes. Do not infer
  server CPU vs proxy/network throttling without server-side evidence, or claim
  production will be fast. Old routed entry tests disable HTTP cache and are not
  representative speed baselines. Evidence pb-test.local/flow-build/
  pb-navigation-timing.json (+ table-cold/no-cache artifacts). No app/source
  changes or user Electron restart in this timing investigation.
  Latest user incidents: A4 was absent but browser_respond repeated a generic
  table question; recommendation reached Main/browser_present then failed after
  8s (whole turn35.9s). Fixed Host absence feedback and substitute-selection
  rejection; table skill updated. Menu/cart live reads now use PB's versioned
  Inertia partial JSON (~500bytes, standalone167/273ms), no stale DOM merge or
  HTTP cache; validate asset version, component, response URL, store/flow/auth.
  Categories/options/prices remain live reads. Native synthetic30 pass including
  version409 and wrong store/URL/component rejection; Kiosk87 + Server40 pass,
  scoped Kiosk/Server/shared/Desktop + focused PB typechecks and lint pass.
  Live follow-up exposed Jev ignoring short A3 after the A4 rejection: no current
  question and phase=ordering. Source now supplies selecting_table with a fresh,
  bounded admission-only question; known/unknown literal codes route to Main
  after recipient admission. No selection or Start authority in that hint.
  Final live text flow A4→A3→Start passed. Recommendation replied twice in
  19.8/22.4s; NOT a satisfactory latency result. Second run verified canonical
  SSE continuation browser_present receipt, rendered names/prices, <=3 products
  and unchanged cart; first driver missed that receipt format, preserved as
  recommendation-first-reply-proof.json. Final recommendation-live-proof.json
  passed. No merchant writes, same visitor across both runs, no end/idle event.
  User explicitly requires idle-aware tests: preserve existing 180s + confirmation
  lifecycle; record session/end events and stop on IGNORE instead of waiting60s.
  Original Jev-ignore evidence: recommendation-before-table-admission-fix.json.
  Remaining latency includes repeated full category/configuration/cart reads
  and Main rounds; do not call the model broken or promise a speedup from the
  smaller page snapshots alone. Physical mic/ASR and real idle expiry not tested.
  Final normal managed Electron/API/web restored; diagnostic flag absent and
  temporary CDP port closed. Data/login retained; production untouched.
  Remaining: live voice table/Start acceptance, full name-facing tool conversion, reception
  reset journey, trusted Host input buffer/phone confirmation/manual keyboard,
  typed order observations BEFORE any new live submission, LINE Pay/readback,
  hardware and complete restore exercise. Do not report the whole plan complete.

- Integrated plan retained below; implementation is limited to the first batch
  above. Other P0–P6 requirements remain planned, not applied:
  P0 baseline/isolation→P1 new RD guest/table journey→P2 runtime skills/name-facing
  model interface→P3 controlled accuracy/first-action comparison→P4 invoice/voice
  notification phone with confirmation, Email manual-only→P5 typed deduped order observations BEFORE submission,
  bounded LINE Pay and readback→P6 reload/DOM drift/Windows/upgrade verification.
  Main gets one relevant versioned skill + current facts/tools; Jev stays finite;
  Host retains consent/validation/execution. No extra model round to choose skills,
  no appended full handbook or arbitrary skill-script runner. Reuse current domain
  modules/assets; loader packaging checked in release; no new dependency chosen.
  Names are the model-facing intent; current PB refs/IDs remain Host/native.
  USER CART TERMINOLOGY: cart 新增/＋ increases an existing item's servings;
  加點 means return to menu, without cart mutation. Plan now separates explicit
  return-to-menu navigation from quantity change and menu selection/draft/add.
  Jev/Main skills/tool descriptions and Host admission must distinguish them;
  plain 我要加點 never means add one to cart rows. Reuse pbControls.navigate,
  preserve cart/table, do not silently clear search; only explicit 看全部 clears
  the filter. Named dish after 加點 follows normal draft/count/confirmation.
  Regression cases added to plan, not implemented yet.
  LATEST USER STEERING: voice may fill notification PHONE only after customer
  confirms its draft; Email must be typed manually, no dictation/spelling/autofill
  assistance. Jev/Main route spoken Email to manual input; Host must reject Agent
  Email writes even on model error, and never turn Email digits into a phone.
  Preserve manual Email in PB. Replace prior all-manual notification policy.
  Phone recognition may use this turn's necessary input, but redact general
  transcript/tool telemetry/future model context and audit audio storage too;
  do not falsely claim raw voice never reaches its recognizer. needInputEmail
  currently demands phone OR Email; carrier scan/tax-ID drafts stay distinct. Final table association
  and new-site payment states still require real readback. Timing must separate
  progress, substantive response, finalized tool and native rendering/click; no
  dispatch from partial SSE JSON. Plan has provisional warm3s meaningful-response
  target/over5s report point, not measured improvement/SLA. Natural simple cases
  only, deferred complex matrix stays deferred. Preserve text switch, drag console,
  profiles/assets and pending old order3940. Initial observations reuse service_event
  with transactional event-ID dedup; do not change accepted-only old order result.
  Keep same isolated backend; no new launcher, production change or commit.
  Plan review added section10: one verified page/task/input/
  order state view; manual touch priority with voice resume and expected scanner
  input ownership. No observed scanner-cancels-checkout bug: native input reports
  activity, not requestManualControl; trusted page keydown invalidates pending
  actions/visual guidance, not the order. Hardware scan/continuation still untested.
  User suggests focused input + validate before filling: plan now prefers trusted
  Host scan buffer, type/format/current owner checks, limited PB field write and
  readback/vendor validation. Direct PB focus is an alternative pending hardware
  verification. Focus alone does not suppress keydown; scan Enter is input-only,
  never submit consent. Revoke input ownership on blur/type change/reset/reload.
  Canonical cart owner across select-table/menu/cart plus table
  binding. Test PB's two guest sessions on one table before assuming independent
  or shared carts; never clear another party's rows. Capture manual submission/
  payment too, not only Agent tool receipts. Pending order callbacks retain original
  visitor/device/ref after a new visitor starts; honor existing ended-session
  evidence access limits. Bound watcher/recovery and sanitized pending observation
  delivery; replay event IDs, never merchant writes. Add real readiness/manual
  fallback/status summary and sold-out/price change handling. Freeze local code/
  fixtures, NOT collaboratively edited RD server; site changes invalidate controlled
  comparison and are recorded separately. These strengthen P0–P6, not new platforms.

- Nov12 initial RD assessment (first batch has since been applied as noted above):
  https://app-205-rd.esgpb.com/order/store/1kAMNok/internal_use/menu/select-table.
  Manual independent anonymous browser: selectA1→start→menu→soup1/40→cart→invoice,
  full reload preserved table/cart; native clear verified empty, no submission/payment.
  auth.user absent, buyer.type=cookie.11 table choices: counter, A1–A3, B1–B7.
  Start follows vendor dining-tables.scan token and full navigation; tokens must
  stay Host-side. Cart displays A1/diningTable string, but draft dining_table_id
  null; submitted table binding remains unverified. Ziggy JSON/routes and basic
  cards/dialog/rows resemble old site; product IDs/names/prices differ. Current
  runtime hardcodes old origin/store/pick_up at native surface, pbBrowserService,
  pbControls, and rejects guest props. Requires explicit scoped journey + guest
  policy, table state/confirmation ownership, no blanket trust/auth removal.
  Latest notification policy: phone can be voice-assisted with explicit draft
  confirmation; Email stays manual-only with Jev/Main routing plus Host write
  rejection. Keep general history redacted, distinguish phone from carrier.
  IMPORTANT current needInputEmail=true and vendor frontend demands phone OR
  Email for guest. Cannot offer optional skip without PB change/verification.
  Phone DOM currently type=email too; keyboard choice must use verified semantics.
  New site is live Vite/HMR; treat reload as expected, never replay unknown writes;
  detect semantic contract drift rather than bundle hash alone. No portrait
  Electron/Main/Jev/new scanner/keyboard acceptance yet. Detailed assessment and
  implementation ordering at top of Windows Kiosk plan. Private new-site-* files
  in flow-build contain sanitized sample/source snapshots/screenshots. Old test
  runtime/login/order3940 preserved; previous Nov16 pickup applies to old self-pickup,
  not this dine-in page. This turn changed docs/evidence only, not product code.

- Nov12 15:50 Taipei user-authorized MANUAL real PB submission completed: order
  3940/ref OB2mNGOpg, egg soup1/40, pickup Nov16 11:00, approved bound member
  carrier. Preserve unpaid order; do not clear as a cart or submit another copy.
  Cart already had number/id/created_at with status10; submit POST changed same
  row to20 待付款 and total40. Show GET returns full lines/status/times; standalone
  details GET500. LINE Pay selection persisted payment=LinePay, still unpaid;
  its302 targets https://web-pay.line.me, blocked by current same-origin native
  guard (ERR_ABORTED). No wallet authorization/payment performed. Full Agent
  checkout, bounded payment journey, PB scanner/tax-ID UI and analytics persistence
  remain unimplemented; accepted-only order-results must not receive unpaid PB.
  Private flow-build checkout-lifecycle.json, submitted-order-readback.json,
  linepay-redirect-proof.json and checkout-analytics-example.json contain evidence,
  not an applied analytics feature. Formal Windows Kiosk plan has findings.
  Future tests use user-requested Nov16 11:00 unless steered; no production-date
  change. Existing Jev preserved active. Warm Jev model total0.38–0.42s, cold3.09s;
  Main0.88–1.35s/call; visible progress1.9–2.3s and substantive reply9.4–10s
  in prior five-case ledger. Historical Main-only7.7–8.6s is not controlled A/B.
  No directly correlated native first-paint metric; tool start is not a PB click.
  This task changed investigation evidence/docs only, not product code. Normal
  managed sandboxed Electron restored/CDP closed; profile/assets/config retained,
  test API/web and production activation/readiness verified unchanged (restore-report).

- Nov12 12:01 Taipei model-view simplification applied to isolated PB API/Kiosk.
  Shared browserConversation now projects direct Chinese currentActivity, one
  pendingItems list/currentQuestion, explicit none/available/not_verified options,
  orderSpecifications.optionGroups.options, selectedOptions and answerOptions.
  Main receipts use outcome/cartEffect and required facts/repair reasons; original
  ok/source/status, consent tickets and diagnostics stay in Host/durable records.
  Server projects schema keys, translates model arguments at BOTH completion
  paths, and reprojects canonical continuation calls; native refs/counts/options/
  validation and Jev admission are unchanged. Confirmation has no 確認加入： prefix;
  acceptance consent follows the actual sealed question purpose, not wording.
  Kiosk187 regression, Server9 focused seam/receipt/route checks, scoped Kiosk/
  Server types, targeted lint, isolated build passed; no root typecheck/commit.
  Final real Main+Jev5/5 on frozen source: single, missing count, two/three dishes,
  per-serving dumpling extras. All five reached Main (1/3/1/1/1 rounds); local
  confirmations had zero Main rounds. Actual counts/options/totals matched;
  final empty, no submission/payment/blocked writes. Ledger
  jev-main-2026-11-12T04-03-22-239Z.json; model-contract-live-proof.json.
  IMPORTANT: Jev was ALREADY ACTIVE on entry to acceptance; preserved active.
  Main-only ledger stopped at the mode guard before any task; not a Main run.
  This supersedes older inactive-mode handoff statements below. Main qwen36,
  thinking false. Normal managed sandboxed Electron restored/CDP closed; profile,
  assets/config and production preserved (apply-report.json/restore-report.json).
  Small-model Main equivalence and latency improvement were not measured.

- Nov12 PB meal wording applied at10:03 Taipei. Empty customizations no longer
  add 不加料. stage-shared/pb-menu-presentation shares spoken naming/serving
  text across Host confirmations/receipts and native quotes/cart readback.
  Only store1kgJeql's observed item2589 (64 dollars/eight dumplings, extra 水餃
  at8 dollars) gets per-serving pieces when structured options and price match;
  changed/unknown configurations retain serving units. Raw PB names/refs and
  quantities stay unchanged. Unique 周氏水餃 is recognized as the same customer
  name in draft validation/providedSlots; collisions stay ambiguous and complete
  pre-add confirmation is still mandatory. General aliases are unchanged.
  Focused Kiosk136, native Cart/Product53, shared wording3 and manager14 tests,
  scoped Kiosk types, targeted lint and isolated Kiosk/native builds passed.
  Final real Main3/3 passed on one frozen version: A01/P01/P02, including an
  explicit 不加 answer when PB's optional extra group is asked. Actual basic
  8-piece serving64 and two10-piece servings160 matched native cart; final empty,
  no submission/payment. Ledger main-2026-11-12T02-03-56-334Z.json. No new Jev
  suite on this wording version; prior4/4 below is earlier-version evidence.

- This wording acceptance caught stale Electron HTTP bootstrap cache: disk
  publication/hash alone did not prove the loaded UI version. Isolated manager
  now sets no-cache on /kiosk/index.html; only the owned test Nginx was reloaded.
  One Host-only cache-bypassing reload migrated the existing cached entry without
  deleting cookies/storage. A later ordinary reload verified a newer entry and
  the no-cache header (wording-entry-proof.json). verifyConversations now refuses
  an entry mismatch before testing. Preserve earlier failed ledgers: stale UI,
  harness missing optional-no/short-name consent handling, then actual short-name
  draft rejection were distinguished and fixed; never count them as passes.
  Test API and production activation stayed unchanged, profile/assets/config
  retained (wording-apply-report.json). No dependency/migration/root typecheck/commit.
  Normal managed sandboxed Electron restored after acceptance; loopback diagnostic
  closed, Jev remains inactive, text console/login retained (restore-report.json).

- Nov12 user narrowed acceptance to natural basic requests: single meal with
  count, asking a missing count, and one sentence ordering two/three meals.
  scripts/pbTest/conversationCases.json defaults to four basic A cases; the
  16 supplemental B cases remain deferred/explicit-selection only. The earlier
  Main B run finished12/16 before this steering; mixed buy/quote, recommendation
  ordinal, unknown allergen facts and a price detour during a quantity question
  failed. Preserve that diagnostic ledger; do not claim all master cases pass or
  resume broad Jev cases. Master's core matrix has112 cases/286 user turns;
  related/adapted IDs are not exact replay coverage.

- PB native operation cues now hide on release (~150ms after dispatch), while
  accepted effects still verify with the same ownership and no replay. Discovery
  frames retain their display lifetime. Chromium regression reproduced the old
  lingering frame; presentation9 and operation/control27 passed after the fix,
  targeted lint/native desktop build passed. Applied only by restarting isolated
  test Electron with its retained fixed profile; API/web unchanged. Actual nine
  tap samples hid after149–155ms. Main basic4/4 passed on the final native bundle,
  with exact cart quantities/totals and final empty cart, no submission/payment;
  ledger main-2026-11-12T01-39-50-035Z.json in conversation-acceptance.
  Main+Jev basic4/4 also passed (jev-main-2026-11-12T01-43-12-153Z.json),
  with actual system-one model decisions recorded in basic-jev-decision-proof.json.
  Both frozen-source runs ended empty and had no blocked order/payment writes.
  Jev restored inactive; normal managed sandboxed Electron restored, diagnostic
  listener closed. restore-report.json confirms retained profile/assets/config,
  unchanged test API/web and production activation/readiness. Text console remains.
  No root typecheck, new dependency or commit.

- Nov12 PB master-aligned follow-up: closed literal draft counts, complete
  confirmation and cancellation now prepare a Host operation after fresh context,
  record canonical user_text durably, then consume/revalidate the private ticket.
  Saved confirmations execute without another Main tool-selection round. Receipts
  are browser_question_answer with source host_question_answer; metrics retain
  modelRounds=0. Preparation never consumes consent, failed recording prevents IO,
  retired tasks/duplicate invocations reject, and manual control retains settled
  receipts without replay. Other answers/corrections still use the planner. Do
  not call this instant: observed native reads/verification still take seconds.

- Published OrderingSite now accepts optional catalogLabels (exact name, aliases,
  category); shared labelCatalog joins only unique current names, preserving all
  merchant price/options/identity facts. Main browserContext and Jev get discovery
  labels, shared aliases stay ambiguous, and labeled search displays verified
  native refs rather than sending an unknown alias to PB text search. Oversized
  category batches ask for narrowing rather than silently claiming all shown.
  Profile Admin has a reusable catalogLabelsEditor for primary/additional sites;
  content edits may change labels but not the approved URL. Published metadata
  changes defer through the existing customer-reset barrier, even for the same
  URL. No database migration/new dependency or administrator prompt edits. Exact
  alias lists have not been populated for the user; saved edits need publication.

- Master-aligned follow-up applied Nov12 02:35 Taipei (isolated Kiosk/API),
  Admin static build02:36; native desktop bundle unchanged. Final actual Electron/
  PB suites passed Main7/7 and Main+Jev2/2 on frozen production source; ledgers
  master-aligned-{main,jev}-cases.json in pb-test.local/flow-build. Cases cover
  alias/quantity confirmation, undecided add-on count, two unfinished dishes,
  same meal/different extras, cancellation, changing/clearing a search and
  nonrepeating recommendations. Host answers show modelRounds=0 in private
  local-answer-proof.json; native checks still take8–9 seconds for Main-only
  field turns, and two-row commits roughly22 seconds. Jev admission adds latency.
  Unit validation307 across12 Kiosk files, shared labels3, Server profile24,
  Admin Chromium4; scoped Kiosk/Admin/Server types, lint and isolated builds
  passed. No root typecheck/commit. Alias/category publication was verified by
  Server fixtures and the real Chromium editor, not by changing the user's live
  published Profile. All live test carts ended empty, no submission/payment;
  observed write paths were native cart details plus analytics. Jev restored
  inactive and normal managed sandboxed Electron restored, loopback CDP closed.
  restore-report.json verifies unchanged profile/assets/config, test API/web and
  production activation/readiness; admin-labels-apply-report.json covers static
  UI replacement. Text console retained. Full hardware/speech, arbitrary compound
  corrections and multiple mandatory groups on the real PB menu remain unaccepted.

- Nov12 PB additions now use a program-owned multi-dish draft flow. Main sees
  `browser_order_draft`, not raw native cart_add. Each line preserves one
  configuration/note, literal evidence, nullable serving/add-on counts, selected
  choices and unresolved groups. `browserOrderDrafts.ts` owns up to10 unfinished
  configurations, derives required fields from current merchant schemas, asks one
  field at a time and calculates prices with existing pbProduct policy. The Host
  presents one full priced batch confirmation before any additions. Same-item
  configurations stay separate. No dependency, migration or admin prompt changes.

- `browserDialogue.ts` and `browserQuestionWindow.ts` own the one-use question
  protocol (`browser-order-slot`, `browser-confirm-add`) and saved batch. Answer
  consumption follows canonical user recording and fresh owner/document/cart/
  configuration checks. `browser_confirm_add {}` consumes the saved batch before
  IO, adds serially and advances bindings only from verified native receipts.
  Unknown write, transport failure, manual change or rejection stops without
  replay; customer receipts retain already verified effects rather than claiming
  no change. Read failures before dispatch are distinct from unknown writes;
  pre-write sign-in requirements stay typed. Read-only turns remain immutable.
  A parallel model batch stops once a Host question has been issued.

- Fresh per-round `browserContext` now includes multiple drafts. Shared neutral
  contracts/types live in `packages/stage-shared/{browserConversation,productConfiguration}.ts`;
  Stage UI pbProduct retains native discovery/preparation/pricing. Literal counts
  mask product names and exclude party-size/add-on units. Draft counts without
  spoken evidence remain missing. Full utterance evidence is usable for one dish;
  split configurations retain separate spans so extras cannot leak between them.
  Original source and the current Host-bound quantity answer retain separate
  evidence provenance; prior bound answers can fill only their selected product.
  Finite visitor history remains bounded48 entries/16k chars; Jev has12/4k.

- Jev now gets the actual fresh PB pending question. Staged recipient admission
  still runs; closed confirmation/cancellation replies then go to the Host
  processor, without issuing an operation or consuming a ticket. Other admitted
  PB question responses also hand off as planner requests, rather than being
  mislabeled uncertain/read-only. This fixes the live regression where cart_get
  returned confirmedAddition but Main's confirm tool was hidden and it replied
  only acknowledgement. No original read-only restriction is relaxed. Shared
  browserQuestionChoice is a routing hint; private Host bindings remain final.

- Earlier draft build applied Nov12 02:03 Taipei to isolated test UI/API only;
  native bundle/Nginx/fixed profile/assets/config and production activation are
  preserved. Main full17 regression passed16/17 before the final recommendation
  fix: S10 repeated one item. After fixing successful-presentation history, focused
  S01/S10 passed2/2 on this final build. Do not call that a single final17/17 run.
  Final Main+Jev actual Electron/PB suite passed8/8: alias→quantity→confirmation,
  exact missing quantity, undecided add-on count→80 dollars, two missing counts
  →390, same meal split plain/extra→144, cancellation, complete literal single
  addition, and nonrepeating recommendations. Private ledgers are respectively
  `draft-main-verified-cases.json`, `draft-main-presentation-cases.json` and
  `draft-jev-verified-cases.json` in `pb-test.local/flow-build/`. Earlier failed
  intermediate ledgers are diagnostic history, not final model-quality scores.

- Recommendation history belongs to the successful native presentation, scoped
  by visitor/document and catalog availability; it outlives transient speech cues.
  Information/choice displays do not rotate it. Host filters already shown refs
  from model-selected recommendation batches, never invents replacements; an
  entirely repeated batch returns a repair receipt without phantom presentation.

- Earlier draft validation: Kiosk264 across9 files plus one additional
  cart-task/presentation integration regression (targeted pair61 passed), Server routing32 plus
  browser-ordering75, targeted route-policy4, scoped Kiosk/Server types and
  isolated Vite build passed. No root typecheck/commits. Real live menu has13
  products and only one optional dumpling add-quantity group: multiple required
  groups are unit fixtures, not live-vendor acceptance. Arbitrary compound
  corrections, price variants/groups, full speech/hardware/production acceptance
  remain separate scope. Drafts are reception memory, expire with their two-minute
  questions and do not survive reload/customer/document/cart/config changes.
  Current text/simulated-ASR question turns still take roughly8–17 seconds;
  two-row commits took24–28 seconds before the newer Host-answer work above.
  Remaining latency includes repeated fresh catalog/native reads, guided controls
  and verification; no general speed claim or relaxed freshness check is warranted.

- Test operations use actual providers and PB, simulated ASR/text console, only
  own empty-baseline test carts; never submit/pay. Prior plain-text/float-console,
  login/avatar/admin work is preserved. Final driver finished with empty cart and
  no submission/payment. Jev was returned to its original inactive state and normal
  managed sandboxed Electron restored; temporary loopback CDP listener is closed.
  `/tmp/pb-restore-normal-electron.py` verified profile/assets/config identity,
  unchanged test API/web processes, production activation and both readiness checks.
  Private apply/restore reports are in flow-build. Preserve
  all existing dirty migrations/avatar/audio/UI changes; `.env.local` is production
  and must not be used for isolated API. Exact Main-native plan matching remains
  in browser-ordering/plan.ts; do not silently patch/replay model arguments.

- Nov11 PB reception-end policy changed at the user's explicit choice:
  **每次結束接待時自動清空未結帳餐點**. Host-only `browser_customer_reset`
  now runs fresh-cart/native `.order-create` **清空** → verify zero rows/subtotal
  → menu/draft/search reset → Host rebinding, with the same document/login.
  PB current `Create-CX03t3FJ.js` binds it to DELETE details/all, not order deletion;
  no public/model clear tool was added. Coordinator rejects changed preflight,
  deduplicates through the existing journal and persists unknown-write blocking;
  empty-cart retries do not re-click. Failed reset retains the active visitor/chat.
  Removed premature durable-visitor end from both Scene restart/new-customer paths;
  manual failures display the native human message. Reset now skips guided-hand
  travel/dwell while retaining native hit/ownership/fresh-cart checks. A separate
  opaque `pbPresentation.cover()` survives SPA navigation, blocks trusted input
  and cleans up in finally; Host announces localized new-order preparation.
  Optional **我知道了，開始點餐** is not a required step. New validation: cover
  regression2 red→green, presentation8/operation9/controls18 Chrome tests, native
  portrait28 PASS including real masked pointer click/no hand/return/cleanup;
  Kiosk types, scoped lint and Desktop/isolated Kiosk builds passed. Applied21:21
  Taipei, only test Electron restarted; API/Nginx/profile/config/assets/production
  activation preserved, served UI/readiness/normal sandbox verified. Prior builds
  and report: `pb-test.local/reset-fast-build/`. Synthetic merchant traffic only. Continuing an idle prompt never clears. Crash/reload leftovers still use the existing ownership/staff gate;
  shared account carts across devices are not isolated by this local policy.
  Validation: initial red tests → Cart45, Host reset/lifecycle31, Chrome controls17,
  synthetic native portrait28 PASS; Kiosk types, scoped lint, Desktop/isolated
  Kiosk builds passed, no root typecheck. Fixture intercepts all merchant traffic;
  no real cart was cleared for diagnostics/testing. Real integration reset flags
  now require an initially empty cart and use only their own seed; new live
  clear-policy acceptance remains an operator check. Applied20:45 Taipei: only
  managed test Electron restarted; API/Nginx identities, fixed profile/assets/config
  and production activation preserved. Served UI, readiness and normal AppArmor
  sandbox checked. Previous native/UI builds and apply report are in
  `pb-test.local/cart-clear-build/`.

- Nov11 direct PB reply/cart-handoff fix applied20:14 Taipei. Read-only test
  history confirmed session `jUMlxtEp8XMaEpzVjYqtP` added one fried-chicken bento;
  subsequent session `qwEyimiy40ygT4h8L9uiv` asked how/to check out, and Main called
  only `browser_respond information-unavailable`, never checking the cart. Host
  now freshly checks cart ownership before non-greeting/hearing direct replies,
  redacts prior visitor contents, returns the staff-review receipt and stops the
  Main continuation. Typed sign-in failures remain typed; read failure never
  claims an empty cart, manual emptying is rechecked, stale visitor IO is rejected.
  Added `browser_respond checkout-guidance`: existing native cart review/ownership
  gate precedes localized manual-checkout guidance; that reply never submits,
  pays or clears. Reception-end clearing is the separate newer policy above.
  Scene only wires translations; vendor/native code unchanged. Staff resume stays
  under Electron Settings → External cart handoff and requires reviewed-version
  confirmation. Validation: initial10 failures→green; Kiosk225 across8 files,
  Server prompt1, Kiosk/Server scoped types, lint and isolated Kiosk build passed.
  Only test API/Electron restarted after settled task/speech/reset; previous UI
  and apply report in `pb-test.local/cart-handoff-build/`. Nginx, fixed profile,
  assets/config/native hash and production activation preserved; readiness and
  normal AppArmor sandbox checked. No real cart edits or migrations. Live Main
  acceptance was operator testing at that point. Nov12 work above now supplies
  structured drafts, required quantity collection and schema-driven customization;
  the earlier session documents the prior implicit-one-serving failure.

- Nov11 PB browse/speech synchronization applied19:48 Taipei. User reported
  雞腿→有什麼便當 kept the old filter while Main read the full catalog. Native
  presentations now verify EVERY selected card and clear the actual search when
  any selected card is missing; delayed/incomplete renders cannot yield a spoken
  success receipt. Explicit search-clear waits for the full current menu and
  acknowledges briefly, without reading all dishes aloud. Main interprets
  rejection of current recommendations as clearing browse/search, preserves
  explicit dietary/budget needs and never treats that as cart deletion. New
  searches retire old choice questions. Host alias/choose-product questions also
  require a shown native receipt with matching refs/names/prices; failed/cancelled
  cues retire the question. Public PB `Show-D_rzU06X.js` still debounces input by
  250ms, sets `me` while loading all categories and renders `.menu-search-meta`:
  controls observe its actual loading cycle and settled count, not a fixed sleep
  or the assigned input value. Scoped validation: Kiosk224, Chrome controls15,
  Server prompt1, native portrait fixture27 PASS; Kiosk/Server types and scoped
  lint/builds passed, no root typecheck. Prior Kiosk and Desktop out are under
  `pb-test.local/menu-sync-build/`; apply report there verifies only test API and
  Electron restarted, Nginx/profile/assets/config and production activation
  preserved, readyz healthy and normal AppArmor sandbox active. No real cart
  writes or data migrations. Operator's live Main acceptance of
  「雞腿→有什麼便當→這些都不要」 remains the next manual check.

- Nov11 PB menu-flow fixes applied18:43 Taipei during the ongoing local test
  iteration, after read-only confirmation the latest task/speech/reset had settled.
  Actual test records showed 13 fresh menu products, first recommendation3,
  follow-up10, then a13-ref presentation validation failure. 「我想吃虱目魚」
  reached Host discovery, whose unmatched-name fallback offered all products and
  generated fake website pagination. This was Host spoken paging, not PB controls
  or a laptop-resolution issue. New shared presentation input schema covers native
  queue/executor/Host dedup; default recommendation cap3 preserves supplied rank,
  validates ALL refs before limiting, and Host admits one recommendation batch
  per turn. Explicit information comparisons permit10/call; larger requests get
  a data-only split correction rather than silently losing requested subjects.
  Spoken choices use3 and other-options/previous-batch wording, with no webpage
  claim. Unknown names no longer fall back to the whole catalog; full facts are
  distinct from question-ready configurations, related named fragments require
  majority overlap, multi-name misses retain the original receipt, and confirmed
  missing-product clarifications end without unsolicited Main recommendations.
  Validation: Kiosk221 + Server route4, native fixture27 PASS (including real
  1080×1920 Host content on separate Xvfb; vendor region1040×1800). Kiosk/Server
  scoped types/lint, Desktop/Kiosk builds passed; no root check or Stage UI's
  known unrelated type repairs. Portrait fixture asserts actual content dimensions
  and keeps its popup visible on the separate display for real pointer checks.
  Applied only test Kiosk UI+native bundle+API prompt; API/Electron restarted,
  Nginx identity, fixed profile/assets/config and production activation preserved;
  test/production readyz healthy, normal sandbox verified. Previous Kiosk:
  `pb-test.local/menu-flow-build/kiosk-before-20261111-184301`; prior Desktop out
  in `pb-test.local/menu-flow-build/desktop-before`. No settings/profile publication,
  real cart mutation, Jev enablement or production update. Operator still needs
  to accept the changed live recommendations/absence response and physical kiosk.

- Nov11 operator's live 「推薦什麼？」 failure diagnosed read-only from isolated
  test session `mo3lSvvFptlb3EuCwSAFo`, entries23–29: Main called browser_observe,
  native tool resolved in ~501ms with `PB requires manual sign-in.`, then Host
  collapsed it into generic tool-rejected. Electron/API/tool transport was active;
  this is NOT successful authenticated menu/recommendation acceptance. Operator
  instructed to sign in in Electron's PB page, not another browser. No cookies,
  login state, cart, published release or production data changed for diagnosis.
  New typed pre-dispatch sign-in receipt from fresh pageProps; Host validates its
  full source/status/effect/code contract and selects translated sign-in prompt.
  No automatic retry, error-text matching or reclassification of unknown writes.
  Regression red→green in Host and real synthetic native fixture (auth false→true
  then catalog reads resume); Host/presentation104 passed, Kiosk scoped types,
  scoped lint, Desktop+isolated Kiosk builds passed. Stage UI known unrelated
  package errors were not rerun/repaired; no root check. User explicitly approved
  apply/reopen; applied Nov11 18:23 Taipei and restarted only managed test Electron.
  API/Nginx identities, desktop-profile/assets directory identities and test config
  preserved; production activation unchanged, test/production readyz healthy.
  Served Kiosk index/JS match new build; native bundle includes typed sign-in code.
  Normal Electron service active with PB AppArmor profile and no sandbox bypass.
  Prior UI `pb-test.local/sign-in-build/kiosk-before-20261111-182356`; prior Desktop
  out `pb-test.local/sign-in-build/desktop-before`; private apply report in parent.
  Later live records confirmed authenticated menu reads/presentations; the
  remaining recommendation/absence issues are covered by the newer entry above.
  Do not equate synthetic auth recovery with full merchant/order acceptance.

- Nov11 portable character packages implemented at user request; user chose
  existing JSZip (no dependency change). Site editor exports unsaved character
  text, greeting banks, avatar, six motion slots/idle fallback and background.
  Import replaces only those editor fields, preserves merchant/store/device
  settings, retires responses after Site/draft switch, never saves/publishes
  automatically. Both routes require experience-edit rights; export checks
  Site ownership/hash/format. Shared neutral v1 manifest and limits live at
  `@proj-airi/stage-shared/kiosk-character-package`. Import checks all declared
  files before writing, bounded Node ZIP streams (120 MB archive / 128 MB file /
  256 MB total / 256 KB manifest), hashes and paths. Only exact multipart import
  gets the larger HTTP budget. No schema migration. Fixed the existing asset
  service's generic reference type (Extract against grouped format unions
  incorrectly produced never); runtime unchanged. Server27/browser13 passed,
  Web+Server scoped types, scoped lint and isolated Web build passed; no root
  typecheck. User explicitly approved apply/restart; applied Nov11 18:10 Taipei
  from `pb-test.local/character-package-build/web`. Only managed test API restarted;
  Nginx identity, test config/assets/profile directories and production activation
  were preserved. Electron had already closed before apply and was left closed
  (not relaunched/reset). Existing Admin chunks retained, files published atomically
  with index last; replaced files backed up at
  `pb-test.local/character-package-build/previous-web-20261111-181032`.
  Test/production readyz healthy; served index/entry JS checked. Fresh background
  Admin tab showed new download/upload controls and existing Site release v2;
  screenshot `/tmp/pb-character-package-admin.png`. Original operator tab was not
  reloaded to preserve any unsaved form; refresh after saving to get new controls.
  No existing draft/release or live data modified, no real package imported or
  published during deployment verification. Actual user-asset roundtrip acceptance
  remains an operator test; automated roundtrips use synthetic binaries.

- Nov11 user selected avatar scope1+3 (upload/publish plus motions/speech/persona).
  Continued audit found PB's early system-prompt branch omitted the card's
  postHistoryInstructions, and model-only profiles omitted characterName. Both
  now reach the leading system prompt, preserving PB tool/safety policy.
  New `useKioskCharacterMotion` retains master's phase/gesture timing and owns
  native PB motion evidence/lifecycle: same operation+connection+document,
  verified cart writes→acknowledge, valid nonempty shown cues→presentation;
  no gesture for reads/failed/unknown/repeated/stale receipts. Owned Menu keeps
  its old fast-action path. Speech/think/idle resume after transient gestures.
  Shared Stage external TTS previously reached only VRM; Live2D now reuses its
  wLipSync engine through `useExternalSpeechSource`, detaching only its visual
  graph branch. Async worklet setup is invalidated on renderer change/unmount.
  Validation: Kiosk motion/fast-path/presentation33, targeted Server routes4
  (new persona cases red→green), real Web Audio browser2; Server/Kiosk scoped
  types, scoped lint and isolated Kiosk build passed. Stage UI package typecheck
  failed in unchanged interactiveServiceClient.test/pbBrowserService/pbControls
  (implicit-any and DOM iterable/types); no errors in changed files, no root
  typecheck or unrelated repairs. Actual model/voice/hardware remains unaccepted.
  User explicitly approved apply/reopen. Applied Nov11 17:41 Taipei, including
  floating text console, and restarted only managed test API+Electron. Test Nginx
  identity, fixed desktop-profile/assets directory identity and server config
  were preserved; no DB migration/seeding or profile reset. Served Kiosk index
  matches the new build and entry JS returns200; normal Electron has no sandbox
  bypass flags. Production activation unchanged and readyz healthy. Prior UI:
  `pb-test.local/character-build/kiosk-before-20261111-174113`; private apply report
  in the same parent directory. Actual model/voice/physical drag still require
  operator acceptance; do not infer rendering success from service readiness.

- Nov11 PB Admin character integration audited against master: editor/page,
  upload routes/storage and Kiosk model-cache logic already largely identical.
  Actual Admin hid avatar/card/background uploads because Vue optional Boolean
  `allowAssetUpload` cast to false. Explicit Site-editor default true restores
  them; template/read-only editors hide ALL uploads incl. VRMA motion slots.
  Upload events carry the editor's current draft, so asset responses preserve
  unsaved name/persona/PB URL. Responses require the same selected draft object
  and Site; late uploads cannot attach to another selection. Added built-in-model
  status, correct model-containing AIRI card ZIP hint and save/publish guidance.
  Browser regressions8 passed (default/permissions, four asset kinds with explicit
  publish, late response); Web scoped types/lint/build passed, no root typecheck.
  PB Admin static update applied Nov11 17:23 Taipei with atomic per-file entry
  publication and retained old assets; API/web/Electron PIDs unchanged, production
  activation unchanged, test/production readyz OK. Prior replaced files under
  `pb-test.local/avatar-build/previous-web-20261111-172328`. No data/schema/model
  upload or published Profile changed. Fresh background Admin tab verified new
  build and visible card/avatar upload controls; screenshot `/tmp/pb-avatar-admin-updated.png`.
  Original operator tab was not reloaded (preserves any unsaved form). Operator
  still needs a real model/card to accept actual rendering. User chose avatar
  scope1+3; its implementation and approved restart are recorded above.

- Nov11 PB text console now uses an owned frameless child BrowserWindow above
  the native vendor View, retaining the SAME Vue subtree/draft/trace/submission
  handlers via Teleport. `useTextConsoleWindow` mirrors host styles and handles
  collapse/reset/manual-close return to the reserved row; Scene releases that
  row while floating. Voice-only mode still omits the console. Main admits only
  its named about:blank child from a trusted host/current origin, denies popup
  navigation/nested popups, skips desktop preload exposure in blank children,
  and destroys the child on host reload/shutdown. No new dependency or IPC API.
  Chromium's about:blank referrer is origin-only; route policy checks actual
  host URL separately. Browser console5, NativeSurface4/Conversation7, scoped
  Kiosk+Desktop types/lint/build passed; real native fixture24 PASS. Actual
  physical Ubuntu/Windows title-bar drag/scaling still require operator checks.
  Desktop out rebuilt; floating UI applied with the character batch above after
  explicit restart approval. `pb-test.local/floating-build/kiosk` is superseded
  staging, not the running build. Do not auto-restart an unresolved ordering
  session; production unchanged.

- Nov11 PB initial native-page loading now has a translated host status/spinner
  and aria-busy. Native View stays hidden until its current loadURL settles,
  including bounds/occlusion updates; stale load completions cannot replace the
  current loading/failure state. This does not assert completion of later SPA
  menu requests. Browser regression reproduced red→green (5 tests incl. parent),
  real synthetic Electron visibility regression red→green (23 PASS), Desktop
  policy tests/scoped Kiosk+Desktop types/lint/build passed; no root typecheck.
  User explicitly approved apply/reopen; new Kiosk build applied Nov11 11:44
  Taipei and manager-owned Electron restarted with SAME desktop-profile.
  Only test Electron/static web restarted; test API identity and production
  activation timestamp unchanged, both readyz OK. Served index/JS verified and
  normal Electron service remains active without sandbox-disabling flags. Old
  static build retained at `pb-test.local/loading-build/kiosk-before-20261111-114415`.
  Do not overwrite/restart an unresolved ordering session. Test Admin settings:
  `/admin/system/models`, `/admin/kiosk/devices`, `/admin/kiosk/profiles`.

- Nov11 PB isolated Ubuntu system created at user's request, with simple Zenity
  **PB 測試管理** desktop/application launcher. Source/usage: `scripts/pbTest/`.
  Private ignored state `pb-test.local/`; Docker project `webnavior-pb-test` owns
  persistent Postgres15434 (`webnavior_pb_test`, user `pb_test`) and Redis16379.
  Independent API15168 plus non-root Nginx15169 serve Admin and `/kiosk/` on
  loopback. No production env is loaded; fresh secrets/PIN/assets/Electron profile,
  fresh test accounts and initial published PB text-enabled profile; camera
  evidence off. Existing accounts/profile edits survive restarts. Test Admin
  `admin@webnavior.local` uses existing development-only passwordless login.
  Models/keys are deliberately unconfigured, not copied from production. Desktop
  manager supports start/stop/status/PIN/logs/rebuild/open Admin/open Electron.
  Stop retains volumes/login and verifies ownership before signalling processes;
  never invoke the production Ubuntu updater. First build and API/Admin startup,
  browser login and stop/start identity/profile preservation verified. Original
  production API remains ready with unchanged Nov9 activation timestamp.
  Thirteen isolated lifecycle/guard tests and Server scoped types/seed lint passed;
  no root typecheck. Linux Electron46.0.0-alpha.2 verified against official SHA256
  ff40bc9371bc72c0f3aac8aae4dc6c9ae7b04358f0f81e54b3d2fea9c1a806fc.
  Existing native fixture22 PASS, but Playwright implicitly adds --no-sandbox;
  this fixture alone is NOT proof of normal protected launch.
  User explicitly approved the exact-path AppArmor userns rule and personally
  completed OS authentication. `/etc/apparmor.d/webnavior-pb-test` is now root:root
  0644, attached only to the test runtime; hash stamp records successful parser
  load. No global sysctl change or setuid helper installed. Initial auto-review
  rejection was resolved by explicit consent; it is no longer a blocker.
  Normal Electron now launches via transient user service
  `webnavior-pb-test-electron.service`, using fixed `pb-test.local/desktop-profile`.
  Never rename/reset this profile after operator login. Initial failed diagnostic
  profiles were retained (no PB vendor partition existed then), not deleted or
  copied from production. Direct tool-constrained launches were unreliable;
  user-service lifecycle is the supported path. Chromium rewrites both initial
  environment and argv into one title: regression reproduced red→green so manager
  matches birthtime/binary plus full argv or exact title, preventing false startup
  failure and duplicate launches. A secondary instance's quit/load error must not
  be mistaken for failure of the live primary window.
  Actual normal start, idempotent open, stop and restart all verified; process
  remained active on the second check, exact AppArmor attachment present and NO
  --no-sandbox/--disable-setuid-sandbox argument. Test/production readyz both OK.
  Admin screenshot `/tmp/pb-test-admin.png`; logs in private state/logs.
  User confirmed the visible enrollment screen. Two leftover early diagnostic
  windows were then identified by PID birthtime/binary/profile lock (zero PB
  vendor partitions) and closed; only the manager-owned window is kept. All
  diagnostic profile data were preserved. Models remain unconfigured; PB account
  login/cart and full AI acceptance are not proven.

- Nov11 live audit: user confirmed production is this computer's Webnavior.
  API systemd runs the independent release
  `~/.local/share/webnavior/releases/meal-confirmation-20261105-215112/runtime/apps/server`
  with `/etc/webnavior/server.env`; API/nginx active and livez/readyz healthy.
  Actual process config and repo .env.local target THE SAME production PostgreSQL
  `127.0.0.1:5434/webnavior` and Redis `127.0.0.1:6379/0`: do not start a dev API
  with those defaults as an isolated test. Auth/encryption secrets match (not exposed).
  Read-only repeatable-read audit: all49 ledger entries match candidate SQL hashes/
  timestamps,0047/0048 already applied, no pending migrations;113 devices all valid
  shared-settings shape. Actual assets `/var/lib/webnavior/kiosk-assets` and release
  `data/kiosk-admin.pin` exist; repo default asset dir/PIN file do not. Preserve
  actual asset path and configure explicit protected PIN file on cutover; do not
  infer missing PIN from absent env keys. Eight inspected Jev/conversation-core
  source files equal master and differ from PB candidate; live kiosk route differs
  from both. No published PB website among54 releases. First-batch PB backend is
  NOT a drop-in replacement for this owned-Menu production deployment.
  Baseline counts and cutover requirements are in the Electron plan's Nov11
  upgrade section; sanitized aggregate report `/tmp/pb-live-upgrade-audit.json`.
  No live data/service/deployment/cart/credentials changed. Electron runtime,
  userData/login/pending operations and media file integrity remain unverified;
  213 active/unexpired DB session records do not establish actual active customers.
  No backup/restore or cutover performed. Test DB/Redis must be isolated first.
  Existing Ubuntu updater uses db:push/frontend PIN and is unsuitable for PB.
  0048 removes old settings fields, so old-PB code-only rollback is unsafe.
  Source regressions fixed before this audit: inherited20s reminder, preserve old
  browser text-mode storage without granting policy authority, null→1x TTS edits
  retain verification (real speed changes invalidate). Recovery static assets and
  paired Web worker policy restored. Supplementary42 tests, Server/Kiosk scoped
  types, Kiosk/Web builds and scoped lint passed; no full-project typecheck.

- Nov10: user explicitly authorized starting master → PB migration and preserving
  switchable text entry. First batch implements multi-Site device management,
  shared revisioned settings, Server PIN access/keypad, text-only device mode,
  loaded release identity, feedback switch and TTS speed settings. PB native
  adapter, cart ownership/receipts, text-console dock and customer reset semantics
  remain intact. The historical frozen 13-case run is not acceptance of this batch.
  Service-mode/background-speech controls remain hidden: PB dine-in/table selection
  and master Jev/core conversation/audio migration are still pending. Use the
  existing Electron plan's Nov10 requirements for the next batch.
  Rebuilt server-schema includes migrations0047/0048; inspect each target ledger
  before startup (this machine already has both). Configure backend PIN/file,
  never a frontend PIN.
  No target database, production service, merchant cart or credentials were changed.
  Existing Desktop dependencies were relinked offline against the unchanged lockfile.
  Validation: Kiosk/Web/Server/Desktop scoped typechecks passed; Kiosk/Web/Desktop
  and server-schema builds passed. Kiosk admin/settings browser tests22, native
  overlay/text-console/settings browser tests18, Web device tests3, Server
  settings/model tests54 + settings routes4, PB backend tests75, PB Host tests178,
  Desktop tests5 and customer lifecycle tests10 passed (browser groups overlap).
  Scoped lint passed; full-project typecheck and actual merchant acceptance were
  not run. The queued published service now applies after the old visitor ends.

- Nov8 Git checkpoint: user requested grouped commits on `pb_order` before
  switching branches to pull. This supersedes the earlier no-commit instruction
  for this checkpoint only; it does not mark the frozen 13-case live acceptance
  complete. Local `output/`, browser failure screenshots, and Python cache are
  preserved separately in the stash named
  `pb_order-local-artifacts-before-branch-switch-20261108`.
  Checkpoint validation: Kiosk/PB/Desktop unit tests passed (431/57/5).
  Server targeted run: 655 passed, 14 failed from 10-second setup-hook timeouts.
  Root typecheck failed with 40 stage-ui diagnostics in the PB implementation
  and tests; root lint failed with 2,369 errors. Per-commit hooks passed.
  Logs: `/tmp/pb-order-{precommit-typecheck,precommit-lint,server-tests}.log`.
  These are checkpoint limitations, not resolved defects; do not count this
  commit series as a validated release.

- Nov3 continuation: actual normal Electron + Jev/Main/PB acceptance is INCOMPLETE,
  not deploy-ready. User wants autonomous completion; no repeated permission for
  own test additions/cleanup. No commits/root typecheck/new deps/remote model config
  changes, no submit/pay, no unknown cart deletion, no credential copying. Preserve
  dirty pb_order work. Actual UI CUA-only, synthetic fixture tests distinct.

  USER LATEST WORKFLOW OVERRIDE: user explicitly asks run ALL13 on one FROZEN
  version FIRST, then GROUP fixes, then regression. DO NOT FIX as cases fail.
  Agreed all13 including priorpasses S01/S06/S13 rerun under frozen code. Frozen
  manifest output/playwright/pb-electron/baseline-20261104-frozen.json contains
  SHA256 implementation files/nativebundle and percase status. Verify unchanged
  when recording eachcase; artifact/ledger/handoff edits okay, no implementation,
  modelconfig/dependency changes until fullpassround complete. No new agents.
  Current nativeexec42099 originalProfile/livePB; API81778/Kiosk9815; CUA
  restoredKiosk/nov4Send/nov4Evidence. OwncartEMPTY after S02control1 cleanup.
  No active request. NEXT normalcustomerreset then S03 exact5 originalinputs
  (formalplan S03) + only genuine issued question answers. S02 completedFAILED,
  artifact restored-frozen-S02.json. Step3 repeats2same alternatives ratherthan
  exhaustion; step4 porkshort failedrejected/noformalquestion/noadd. Step5control
  alias issuedofficialquestion, answer control1/$10, finalreview correct butdoes
  not prove replacement. Own1clearedEMPTY. S02first2 werealreadyinprogress when
  userfroze, sameexactsource/runtimenoedits, validbaseline. 1/13RUN, notpass.

  Last prefreeze fix: native browser_present invalidopaque refs (model gave
  names) formerly returned emptyclearedsuccess causing tool-limit. Now returns
  proposal_rejected/dataOnly/effectnone plus unresolvedProductRefs and fresh
  ref/name mapping, clear explanation; never auto-resolvesnames or writes.
  Synthetic script wrongnameref assertionsred->green; fullnative fixturePASS,
  strictservicegraph/lint/bundlePASS. S02step2nowpresentationworks butlaterfails
  keptforbatchfix. Logs /tmp/pb-nov4-present-refs-{red,green,types,lint}.log.
  Code notmodifiedsincefreeze. Last user statusanswers: priorfirstpass3/13passed
  (S01/S06/S13), 10notyet; estimate3-5h includedfix/regress, now userrequests
  fullbaselinefirst. Need preservehistoricalproofs but don't countthem as frozen
  roundpasses. No submit/pay, cleanupownauthorized, no root typecheck/commits.

  NOV4 NOW: originalProfile nativeexec69222 pricebreakdown+cuecancel bundle,
  API81778/Kiosk9815. Latest S01 exact5 FULLPASS after adding pricebreakdown to
  native browser_quote_selection receipt. Artifact S01-price-breakdown-pass,
  programassert exact5/noMainfail/base10+rice5 quotedwithoutwrite/finalchicken1
  rice1/$15. Own15manuallycleared UIEMPTY. No active request; nextnormalreset
  then S02 exact6 preference/exhaustion/reselection, formalplan185+.
  Rawfirst S01-price-breakdown-before retains missingbase/surcharge despite15
  correct. Formatter now gives configuration.unitPrice and actual choice.unitPrice
  plus per-servingcount, configuredunit/total unchanged. Synthetic script added
  assertionsbase10/rice5, 2mealsunit15/total30; red->green fullscriptPASS,
  strictservicegraph tsc/lintPASS. Runtime reopenedoriginalprofile withoutlogin.
  Latest docs formalplan/stage-uiREADME updated. NewS01/quote change doesnot
  touch write semantics. Previous current S06 and S13 proofs retained below.

  NOV4 NEW CURRENT (supersedes remaining historical states): nativeexec90746
  launched originalProfile after canceled-fetch bundle; CUArestoredKiosk resolved
  /private/tmp/... originalruntime. Latest S06-cancel-native-sequence exact7 +
  officialnameconfirmation FULLPASS:2IGNORE/noUNAVAILABLE/noMainfail/search/
  chicken2/$20/keep/finalreview. Verified no native writes after keep. Own2clear
  UI EMPTY; normalreset pending before NEXT broader S01 scenario. No active task.
  S13-instructions full9 prior cancellation patch PASS; cancellation patch itself
  fullnative synthetic + liveS06 acceptsadd/review, no actualS13rerunneeded yet.

  New actual diagnosis reproduced in scripts/verifyKioskDesktop.mjs: protocol
  holds only passive browser_present menu-categories response. Required cart_get
  false MUST finish <1.5s BEFOREheldresponse release, oldredwaits. New enqueue
  aborts activeVisual ONLY executingName=browser_present; readCatalog/pageProps
  optional signal combines cancellation with existing8s timeouts for all read
  stages. presentProducts passes capturedvisualsignal. Aborted present returns
  oktrue presentationcancelled/dataOnly/no facts; originalcart actions untouched.
  Newfixture restorescue for subsequent existingmovement/resettests. Fullscript
  green exit0; strictnative service graph tsc/lint/bundle PASS. Logs
  /tmp/pb-nov4-cue-cancellation-{red,final,types,lint}.log. Fixtureusesindependent
  temporaryProfile, fakeaudio/video, HTTPSprotocol blocksallactualmerchant IO.
  ActualnewS06maxbrowser4.46s/no8s; doesnotprovevendorneverunavailable.
  Next requested breadth: S01 intro/exclusion/price/riceadd/review exact5 in
  formalplan; continue ordinaryCUA, never countprefix/repairedcounterexamples as
  wholeflowpass. Old S01-S12 repetitions stillpending. Actualowncleanupauthorized,
  no submit/pay/credentials/configchanges. No subagents/rootTypecheck/commits.

  NOV4 CURRENT FINAL-POLICY POINTER (supersedes historical blocks below):
  Native Electron exec80458, original official runtime/Profile/login; API81778,
  Kiosk9815. Final S13-instructions exact9 PASSED after final prompt update;
  artifact restored-S13-instructions-sequence.json verified exact9/no failedMain/
  no falsePRESERVE/finalpork2/$20/no options/note. Ownpork2 cleared and UI verified
  EMPTY; normal newcustomer reset completed, UI verified ready Host and PB menu.
  No agent request in flight. CUA restoredKiosk bound resolved
  /private/tmp/pb-electron-alpha2-restore/runtime/Electron.app. nov4Send/evidence
  retained. Current latest source: broad KEEP removed, original purpose restored;
  only observed zero-change quantity (same name/count, oneSETdelta, cartContext,
  cartTarget, no completedEffects) asks independent judge_browser_preservation.
  PRESERVE=>fresh owned readonlyreview{} and receipt; CONTINUE=>originalpurpose.
  Host review{} normalization, optional retryanchor failure (strictrecoverykept)
  remain. General Main browser instructions now explicitly say pure review/keep
  uses browser_cart_review, no same-count quantity write, third-party quotes not
  owncancel authority; mixed actualchange still processed. This prompt was added
  AFTER S13-narrow round; final-prompt S13 now also fullyPASSED above.

  ACTUAL: restored-S13-narrow-sequence.json exact9 fullyPASS, no falsePRESERVE,
  finalpork2/no options/note/$20; own2cleared. Latest S06-instructions-sequence:
  search, aliasofficialquestion+answer, chicken2, preservation, finalreview all
  correct. PreserveactualMain firstproposedquantity2, independentPRESERVE true;
  no nativewrite afterkeep. BUT moviebackground got PBcontextread8s UNAVAILABLE,
  only companioncountIGNORE, so fullS06 NOTPASSED. Own2clearedEMPTY. Prior
  S06-narrow-sequence has searchcontexttimeout + preserveattemptremove failed.
  Preserve is only proven in no-opquantity path, not all possible Main proposals.
  Native passivespeech browser_present sometimes consumes8s before queued
  cart_get; caller sees PBcontextreadrejected. No cancellation/network diagnosis
  proven. Native readCatalog fetches use 8s signals; presentation.cancel() on
  requiredoperation does not abort catalog IO. Potential seam, NOT a fixed cause.

  VALIDATION: Server browserordering75PASS; Host3files129PASS; Server API2PASS
  (88notselected). Server+KiosktypesPASS and lintPASS. No root/fulltypecheck.
  Failed broadKEEP S13 retained in restored-S13-keep-regression-sequence: add
  refusal falseKEEP, laterremovewithoutreplacement, finalEMPTY. Do NOT restore
  broadKEEP. Latest formalplan + Kiosk README reconciled current policy/failures.
  Frozen renderer0.3s happened after HMR/prolongedrun twice; closed ownwindow and
  relaunched originalofficial runtime. Cause unknown; no flags/versionchanges.
  No submit/pay, newdeps, remoteconfigchanges, commits, or credentialcopying.

  Native add normalization already LIVEPASSED (S13 step7): repeated add of unique exact same
  product/configuration/price, if CartGateway.canEdit proves rowidentity and total
  <=99, compiles to setQuantity(existing+incoming). Uses exact before-cart, fresh
  prepared price/config/revalidation, full after-cart. Receipt remains incoming
  servings only for Hostcompletionaccounting. Differentprice/config, duplicate
  matches, uneditable rows or >99 total keep ordinary add. Required canEdit IO
  method added to adapter+unitfixtures, no optional compatibility shim.
  Red->green pbCart39PASS, strictowner2filetypesPASS, lintPASS, nativebuildPASS.
  Logs /tmp/pb-nov4-add-normalization-{red,green,types,lint,build}.log.
  After startup, fresh EMPTY/newcustomer, replay exactS13 1-9 promptly (<idleTTL),
  no long sourceanalysis betweeninputs. Existing twoidenticalrows are not
  retroactively solved by addnormalization; current ownduplicates alreadycleared.

  Previous S13 latest uninterruptedsteps1-7PASS (aliasquestions onlyrelatedformal,
  noearlywrite, pork1 -> confirmedchicken1 -> confirmedaddchicken1, noaddon/note).
  Step8 "不對，我是要排骨便當兩份，雞腿都不要。" FAILED: two identical
  chicken rows7995/7996 each1; Mainremove/addblockedcorrectly; single-rowreplace
  cannot removeboth, semanticcheckdemandsold2. Cartremainedchicken2/$20/no write.
  Artifact restored-S13-nov4-replacement-sequence.json. Long analysis between8/9
  triggered idlecustomerreset; 9 reviewed asnewcustomer/oldcartblocked, NOTsameflow
  evidence. Userinformed. Need wholepromptreplay after normalization, thencleanup.
  BEFORE fix S13-2 wronglyaskedall3/no writes; artifact
  restored-S13-nov4-before-discovery.json. Now testing sharedfragment discovery.
  Moved existing productFragment unchanged policy fromorder-menu menuIdentity to
  stage-shared/product-discovery (newexport). Only category label becameoptional
  forexternalreceipts; doesnotinventalias. OrderMenu uses same shared function;
  PBdialogue now literalquery -> currentlabel-fragments -> catalogfallback with
  explicitprecedence. Candidatequestionsonly, noautoSKU/add authority. Newdynamic
  fish/chicken fixtures prove relatedcandidate and genericcategory retainsboth.
  Red->green, Kiosk4files150PASS, Menu intents43PASS, lint/KiosktypesPASS.
  Menu scopedtypePASS.
  Vite cachedpackageexports causedoverlay despitecorrectsymlinkpackage.json;
  stoppedolddev36457, restarted SAME5169Kiosk dev exec9815; overlayresolved.
  No install/lock/config workaround. Current CUA restoredKiosk/nov4Send/evidence.

  Pending-question sequence fully PASSED: genericmeal1 -> realproductquestion ->
  companioncountIGNORE(1.2s) -> formalpork1/$10 -> "我點了什麼？先不要送出"
  correct10receipt -> cleanup "取消排骨便當一份" EMPTY/$0. Artifact
  restored-pending-nov4-sequence.json includes all, owner/cartfresh preserved.

  Active native32976 NEW rebuilt official runtime, same Profile/login. PB pickup
  Nov5/07:30, main meals10, rice5. No merchant submit/pay. Every prior own test
  cart cleared/visibly EMPTY before current seed. Last cleared own chicken2/$20
  (note incorrectly "不加購白飯"); do not treat that note behavior as passed.

  Latest acceptance:
  * Extended S04 fresh uninterrupted exact4sentences passed35->65->60->40, no
    user restatement, same-config normalization actual native quantity only.
    restored-S04-nov4-replay-{initial,quantity,partial,group}.json.
  * Notes fresh exact "排骨便當兩份，一份飯少，一份不要辣。" passed1+1/$20,
    remove飯少 preserved不要辣/$10, cleanupEMPTY. Artifacts
    restored-S05-nov4-notes-{contract,remove,cleanup}.json. Not formalS05 swap.
  * S06-r1 complete7 failed. r2 now movie and companion count bothIGNORE, search
    works; short "雞腿兩份" still asks all3 instead of related/formal confirmation.
    Added explicit formal-control input -> chicken2/$20 but refusal became note.
    "小明說他不要了，我的兩份先保留" wronglyclarified(no cartchange); final
    "幫我核對，還不要送出" UNAVAILABLE atJev2questions. Artifacts
    restored-S06-nov4-{r1,r2}.json. r2 includes extraformalcontrol, NOT unbrokenpass.
    Own2meals then manuallyclearedEMPTY. Do not claimS01–S13 complete/deployready.

  Completed Nov4 fixes:
  * Quantity-only scope extraction (observed target/config/product totals, no
    proposedcounts/note/prose); rejects impossible single-row edits and requests
    complete groupedlineRef+lineRefs arguments.69domain testsPASS.
  * Host group missinganchor returns specific schema repair without guessing.
    Complete selection preflight requires version/variantRef/choices and returns
    all missingfields + observed availableConfigurations. No autofill/authority.
    Host45PASS. Native tool descriptions: exact namedorders useproduct_getFIRST
    (alreadypresents); addone config/note percall. Nativebuild/lintPASS.
  * Staged planner-only (`requiresPlanner`) now reuses OLD independent recipient
    question moved unchanged index->prompt.ts (legacybehaviorunchanged); only
    utterance+activequestion enter recipient, no history/catalog. OTHER=>IGNORE,
    uncertain=>UNAVAILABLE; KIOSK then existing4-wayadmission. Same6questionbudget,
    no extraMain or remotemodelsettingchange. choose traces actual percall evidence.
    Server3relatedfiles176PASS+2skipped, scopedtypes/lintPASS.
  * Pending PB context no longer bypasses admission via delegateToAssistant.
    browserFastPath returns requiresPlanner without reading/consuming question;
    kiosk-fast-path special bypassremoved. Positiveanswers still goMain AFTER
    admission, originalquestionfreshness/consenthandlingunchanged. TwoKioskfiles
    82PASS red->green, scopedtypes/lintPASS. Live pendingnegative/answer/review/cleanupALLPASS.
  * Optional tests/experiments/pbAdmissionProbe.test.ts copies configuredJevprofile
    into isolatedlocalDB; neverchangesactiveconfig/merchant. Fixed6contrasts:
    original4/6,minimal3/6,rewrittencombined5/6,independentrecipient6/6; existing
    unchangedsharedrecipientalso6/6. Logs /tmp/pb-nov4-{admission,recipient,
    shared-recipient}-probe.log. These6controls are NOT full-flow acceptance.

  Native normalization: unique same-product/config at same price compiles replace
  to setQuantity(retained+incoming), fresh revalidation and exact full after-cart.
  Another matching row, price change, >99 single-row derived total rejects.
  Native unit34PASS, owner strict types/lint PASS, desktop finalbuild PASS,
  synthetic fixture PASS (21 PASS messages) /tmp/pb-equivalent-native-fixture.log.
  Actual equivalent quantity path now ALSO passed65. No native changes Nov4.

  Runtime: API exec81778, Kiosk9815, normal Electron42890 (Nov4 cart-review bundle; old72295 ended). API5168, Kiosk5169/kiosk, original
  Profile /Users/charleswang/.webnavior/kiosk-desktop, PB/device auth retained.
  Official46 alpha2 /tmp/pb-electron-alpha2-restore/runtime/Electron.app/Contents/MacOS/Electron,
  SHA b71d41d0c3da4c452d077e64013821d6f8e7d073ddc0e4831869b5196221d79d;
  Node24.22.1 checked. 41 runtime rejected by project guard. No codesign pass claim.
  Docker DB5434 restored by user; Docker UI not approved, don't retry CUA Docker.
  Native launch with KIOSK_DESKTOP_WINDOWED=1, KIOSK_DESKTOP_USER_DATA=originalProfile
  and apps/stage-kiosk-desktop/out/main/index.js. No CDP on normal App.
  CUA binding restoredKiosk; Nov4 helper nov4Send(id,text), nov4Evidence.
  AX roles now English, so old recoverySend (Chinese-only) is obsolete. New helper
  handles text entry area/button as well as Chinese roles, always fresh indices.
  First CUA after compaction rewriteDocumentation. Helper fresh AX per action.
  HMR contracts + API watcher can race bootstrap into registration UI; afterAPI200,
  click Host heading to focus, Cmd+R restores existing cookie. Never re-enroll.
  PB may retain cart/create; return立即點餐 + dismissnotice and readiness-read if
  control connection missing. Initially blank AX after restart was resolved by
  screenshot-guided notice click, not proof of a blank renderer.

  Durable code now:
  * browser-ordering/contracts.ts owns cartSnapshotSchema (renamed from answer-only
    schema; browserDialogue updated), servingSchema, additionGroupSchema/AdditionGroup.
    BrowserEffect carries fresh cartContext, raw completedEffects for purpose,
    opaque servingKey and completedAdditions[{servingKey,note,quantity}]. No keys/
    completed counters sent to model. Missing structured completion with existing
    prose receipts cannot authorize another add. Scope is one task/document.
  * Main purpose independently handles observed cartTarget (finite QUANTITY once
    caused wrong cart35). Fresh cart distinguishes initial split vs existing meal;
    this-turn verified completedEffects distinguishes progress from preexisting rows.
    Purpose instructions distinguish descriptor vs modifying content (quantity,
    cancel-meal-by-note vs remove-note). No remote model changes.
  * Main additions ALL independently checked, even blank note (earlier omitted
    both requested notes and got a wrong2plain). Exact finite-compiled adds keep
    fast path. Independent group model now outputs full productName, variantName,
    per-serving options[{name,quantity}], note, quantity for ORIGINAL full groups;
    code compares full configuration and note, subtracts only exact servingKey+note
    verified additions, computes option totals. No model matchesServing boolean.
    This is necessary: boolean check called plain2 a match for rice and emitted
    "加白飯" as a note, overrode correct planner rice1→2 and wrote unsafe50.
  * Full parsed groups are now preserved on effect check.groups and persisted in
    browser_semantic_decision, not merely a truncated diagnostic. Output bounded,
    no required prose. Replacement separately extracts incoming/outgoing meal
    counts+config/note consent. Semantic per-request30s/Host60s, cancellation stays.
    Redundant whole policies removed from tool description, max_tokens bounded.
    Live check dropped31s timeout to~1.5-4s, but passing time is not semantic pass.
  * browserCartTask VerifiedReceipt stores structured addition only AFTER native
    verified IO (normal+sealed-confirmed paths); unknown addition blocks further adds.
    Serving key uses actual product/variant/per-unit refs without freshness version,
    note separate. Fixed-price configuration.name is product label, not a variant:
    serving.variantName now empty when variantRef empty. Same-SKU anaphora needs
    semanticALLOW; different SKU/unrequested choices still guarded. Generic semantic
    clarification precedes literal-name full-menu question.
  * Replacement replay key ignores cart/selection freshness version, normalizes
    choice order, reuses only exact resulting cart version in same task. Prevents
    redispatch, not proof that whole demand finished. Terminal redundant present
    acknowledgment remains narrow no-effect/current last verified write; tool-limit
    warnings/repeated planning remain a known live issue.
  * pbCart structured options + verified after-cart receipts; pbControls complete
    source uniqueness + exact rendered option/note binding for equal name/qty/price.
    Fully identical hidden peers/unknown markup still fail closed; no positional guess.
    Same-price exact-note real removal PASSED after purpose descriptor fix.
  * serviceRecovery empty unused question accepted; clarify needs nonblank and
    contradictory assistant-with-question rejected. All DEBUG-pb-recovery removed.

  Actual outcomes (do NOT label old policy results as current full pass):
  * Initial split3/1rice once passed35 clean; rice1→3 passed65; original partial
    rice3→rice2+plain1 eventually60, then Main repeated swap/tool-limit => S04 not pass.
    Group plain total1 failed (single-row0 then irrelevant swap); added lineRefs
    repair reason when retained rows exceed requested total. Still needs live rerun.
  * S05 original double-note phrase "我要兩份排骨便當，不加購白飯，一份備註飯少，另一份備註不要辣。"
    PASSED directly new-session with prior boolean group schema, both1/$20, clean
    final (restored-S05-original-new-session-verified). Exact original removal
    "只取消備註飯少的那份排骨便當，備註不要辣的那份保留。" PASSED: only不要辣1/$10
    retained (restored-S05-note-remove-verified). Simple請移除排骨便當 then EMPTY pass.
    These are not yet retested after current explicit group schema.
  * Cart-only context S04 progressed2plain but purpose invented replacement for
    second group. Adding raw completedEffects fixed ADD purpose but group model
    subtracted/selected wrong config. Single followup newrice1 with no same-turn
    prefix PASSED35. Structured counter fix removed model math but exposed unsafe
    matching boolean: current explicit config schema fixes that in controlled tests.
    Evidence restored-S04-final-policy-initial / -cart-context / -completed-context /
    -structured-progress (unsafe50), current latest live still pending.
  * Every previous own35/50/20 cart cleared with exact contents and EMPTY verified.
    No submit/pay. Original S01-S13 full repeated reception, aliases/background,
    real ASR/hardware/Windows remain unfinished; user said assume ASR correct on Mac.

  Validation latest: domain63PASS /tmp/pb-full-config-domain.log; Kiosk3files105PASS
  /tmp/pb-full-config-host.log; Server/Kiosk scoped types PASS. API notes3PASS+87
  skipped /tmp/pb-full-config-routes.log. Changed lint PASS after test-template fix; latest native owner lint/types PASS.
  API diagnostic now records userEntryId; final scoped Server types and owner/API
  lint PASS (/tmp/pb-correlation-server-types.log, /tmp/pb-equivalent-final-lint.log). Before current domain change, synthetic
  native fixture PASS /tmp/pb-final-native-fixture.log, isolated Profile and intercepted
  vendor origin, NOT merchant acceptance. Cart30PASS/browser13PASS earlier. No root
  check/commits/deps. Native code was rebuilt for equivalent-quantity normalization; latest fixture PASS.

  Export read-only own test transcript: node --env-file=apps/server/.env.local
  /tmp/pb-restored-export.mjs '<exact own phrase>' SUFFIX (localDB network escalation).
  Artifacts output/playwright/pb-electron/restored-*.json, auth redacted. Latest
  user_text anchor within3h; before-Main rejection can anchor prior turn, don't
  misattribute. Earlier S05 exported files remain even after3h anchor window.
  Full original baseline99 inputs/12 dialogues had failures; not 99 unique cases
  or three-round pass. Formal plan/READMEs partly updated, reconcile final state.

  NEXT: settle current group re-test, inspect semantic diagnostics before theory.
  If pass40, cleanup own rows/new customer and replay S04 without retries. Recheck
  S05 full explicit-group schema, aliases/background/full S01-S13 still pending.
  Keep App usable/empty at cut, no deployment completion claim. No submit/pay.

- Nov1 first-response implementation DONE. KioskScene uses per-input fixed-text
  TTS preparation, service-admitted provisional turn adopted by Jev/Main, no
  duplicate receipt. useKioskWaitSpeech owns preparation/claim/cancel lifecycle;
  receipt mode skips ordinary1s grace. Timing marks first DOM/audio across handoff.
  Normal native UI menu x3 audio2.05–2.66s (median2.28), DOM median1.83s after
  simulated final ASR; Main price quote audio2.12s, one receipt, cart0 unchanged.
  89 targeted tests, Kiosk typecheck/lint, desktop build PASS. Formal top section:
  docs/plans/2026-10-28-windows-kiosk-electron.md. No physical mic latency claim.
  CUA extra trials FOUND unresolved semantic issues: companion utterance
  「小明，我們下班去看電影吧」went Main/greeting; search request
  「請在畫面搜尋雞腿便當」failed decision, no PB execution. Do not claim all
  background/search acceptance passed. This run read-only, no cart cleanup rights.
  Normal retained-profile Electron remains open; renderer HMR loaded response
  changes. New native data-mode diagnostic requires restart to load built bundle.

- Nov1 v3 implementation and relevant acceptance DONE; performance goal PARTIAL,
  not blanket25% or subjective waiter-feel approval. Authoritative TOP v3:
  docs/plans/2026-10-28-windows-kiosk-electron.md. User asked feasibility review
  then implementation. Do not restart this completed test campaign unprompted.
  No commits/root typecheck/new deps/deploy/submit/pay/subagents. Preserve dirty tree.

  NORMAL retained-profile Electron left open exec35329, log
  /tmp/pb-electron-local-pilot.log; official alpha2 executable +
  apps/stage-kiosk-desktop/out/main/index.js, KIOSK_DESKTOP_WINDOWED=1,
  KIOSK_DESKTOP_USER_DATA=/Users/charleswang/.webnavior/kiosk-desktop.
  No inspect/CDP/recording flags, NO test drivers remain. Final authorized test
  cart EMPTY/subtotal0, conversation cleared, same merchant doc/login retained.
  User explicitly approved new pork2/subtotal20 and this run's cleanup; removed
  those and ALL this run's added items. Future unrelated rows not authorized.

  Final six cases x3 actual normal simulated-ASR UI + live Jev/Main/PB PASS:
  chicken1=10; pork2 eachrice1=40; chickenqty2=50; replace chicken with braised2
  note不要辣=50; remove pork=20; remove braised=0. Every receipt verified, all
  UI steps completed/displayUpdatedtrue, native writes1/1/1/2/1/1. Three price
  inquiries unchanged cart0,0merchant writes. Final customer resets PASS.
  Evidence output/playwright/pb-electron/v3-{ui-sequence,write-acceptance,
  reset-acceptance}-{1,2,3}.json, v3-reset-acceptance-final.json,
  v3-read-acceptance.json and v3-comparison.json.

  Comparison SAME natural motion before/after last completion/cart-read changes,
  each3 valid samples, median UI->text seconds:
  single10.22→9.42; each-rice14.82→13.50; qty14.44→9.75;
  replace+note20.80→19.30; remove-pork13.33→9.94; remove-braised13.68→10.59.
  Single qty/remove Main rounds3→2; outside-native orchestration medians down
  51/46/35%. Not all background IO, no p95/SLA, not v2/v3 mixed-motion comparison.
  Complex demands remain slow; do not claim all speed targets achieved. No full
  frame-level proof of300ms first feedback. v2 original had one sample only.

  Implemented: PB-local distance-sensitive280–1200ms at900px/s,dwell180ms,
  press150ms; deceleration, rendered position across superseding moves; readiness
  overlaps dwell. Executor invokes press at actual accept; release independent
  of HTTP/verification. ServiceStep.arrivedMs + strict schema separate arrival.
  No shared owned-Menu timing change; no hidden cart API write. Independent IO
  may overlap, final freshness/cart/ownership checks retained. Verified cart
  identity decorates result without a whole-menu reread for completion labels.

  Main retry context single-flight original-demand anchor; manual retry still
  compares fresh live state; effects revoke even pending capture. Cart-only
  edit gate does not fetch product configurations. Optional HOST completion
  callback ONLY for exact whole literal remove/quantity AFTER Main selection,
  Server exact-plan admission and browser verified receipt. Negation/trailing/
  compound/uncovered wording continues Main. Recording orchestration persists all
  batch receipts before skipping prose-only round. No constant ALLOW or skipped
  Jev semantic policies. Progress/reply speech channels, revision+boundary+status
  clocks fixed; progress no longer deletes clock before final reply. Cancelled
  speech/turn never undoes a separately verified cart effect.

  Found and fixed live reset/cue race RED→GREEN: journal settlement must publish
  BEFORE FIFO advances, not delayed result.then. Host awaits advertised visual
  cancellation before admitting reset control revision. Native fixture immediate
  reset during passive cue now PASS, preserves cart and writes0. Initial final
  sample1 merchant sequence was valid but reset failed once before fix; manual
  reset then succeeded, later fixed reset proven live + samples2/3. Do not hide
  the failure or confuse it with merchant effects. One earlier Main proposal
  copied selection.version to cart.version; guarded rejection had NO write.
  v3-version-rejection.json retained; separate failed run, not successful timing.
  Added explicit tool-schema descriptions of both owners. No auto effect retry.

  Validation: Kiosk126 relevant tests, latest reset/completion80 tests, UI23,
  real silent-media2; scoped Kiosk types/lint/build and native fixture PASS.
  Logs /tmp/pb-v3-{task-final,reset-tests,ui-final,speech,types-final}.log,
  /tmp/pb-v3-reset-race-{red,green}.log, /tmp/pb-v3-reset-{build,lint}.log.
  READMEs kiosk/UI/desktop and formal plan updated. New bugs had test-only red
  reproductions. No root typecheck. No new implementation work pending.

  Demo output/playwright/pb-electron/v3-pb-gesture-demo.mp4 is REAL PB service
  viewport: source v3-videos/page@6c1ff60261dd2099ee81b92ffaac7740.webm seconds20–80,
  cropped ONLY blank recorder padding to1080x400. Portrait8.6s preview
  v3-portrait-synthetic-demo.mp4 uses production controls/operation/presentation
  with synthetic menu in true1080x1920 Chrome; v3-motion-preview.json also833.
  Mac native tall window was clamped to833; not actual portrait-hardware proof.
  Required variants/sets remain synthetic-only; Windows/mic/install/deploy outside
  equipment scope. No user decision pending. Subjective feel can be reviewed in
  clips; do not declare the user has approved it.

  Helpers in /tmp are diagnostics, NOT required launch services. Agent-browser
  CLI absent; existing Playwright fallback used. Old orphan drivers safely closed
  after auto-review caught duplicates; resolved, no outstanding permission/block.
  Driver now closes readline/exits after App+video close. No duplicate Profile
  drivers may be launched while one is running. Services/API/Jev retained.

- Nov1 v2 COMPLETE within agreed Mac/current-PB/synthetic scope. Five-phase
  authoritative status: docs/plans/2026-10-28-windows-kiosk-electron.md top.
  User approved original test row removal + this run's cleanup; all removed,
  final merchant cart0. No submit/pay/deploy/commits/new deps/root typecheck.
  No subagents. Preserve preexisting dirty tree. Do not repeat historical tests
  or restore an old baseline merely because an earlier note describes it.

  Final NORMAL retained-profile Electron is exec session47346 (may expire across
  threads), log /tmp/pb-electron-local-pilot.log. Runtime:
  /tmp/airi-esgpb-electron-alpha2-verified/Electron.app/Contents/MacOS/Electron
  apps/stage-kiosk-desktop/out/main/index.js. KIOSK_DESKTOP_WINDOWED=1,
  KIOSK_DESKTOP_USER_DATA=/Users/charleswang/.webnavior/kiosk-desktop.
  No inspect/CDP startup flags; test drivers closed. Existing API/Vite/Jev services
  retained. PB login and authorized30-day device cookie remain in this Profile.

  Final six consecutive actual normal text/simulated-ASR requests PASS:
  chicken1=10; pork2 eachrice1=40; chickenqty2=50; replace chicken with
  braised2 note不要辣=50; remove pork=20; remove braised=0. Exact native write
  counts1/1/1/2/1/1, all six receipts verified/displayUpdatedtrue and UI steps
  completed. Main's one bad add-on unit-price proposal rejected WITHOUT effect,
  corrected in same task; seven tool proposals are not seven completed operations.
  POST checkInvoiceData is PB read validation, separately classified by observer.
  Reset via real customer button cleared dialogue, retained empty cart/login and
  same vendor document. App restart with retained Profile read cart0 successfully.
  Proof output/playwright/pb-electron/v2-{ui-sequence,write-acceptance,
  reset-acceptance,read-acceptance,comparison}.json. Incomplete observer artifacts
  are NOT final acceptance. Single-sample canonical demand->reply7622→5005ms
  excludes prior Jev/ASR and later speech; not SLA/p95. Real UI->reply10.3–18.3s.

  Implemented: Server-issued Main exact plan or bounded Jev intent+literal slots,
  canonical user entry/readOnly binding, DB visitor row-lock one-use consumption;
  browser-plan normal path, old browser-effect not normal. Uncovered complete
  Jev request uses requiresPlanner/service admission then intact Main NEW_REQUEST.
  No constant ALLOW/no extra fixed purpose+quantity judge. Literal ambiguity,
  fresh config/cart/ownership and sealed clarification safeguards retained.
  Native pbControls own actual finite menu/cart UI actions; APIs READ ONLY.
  pbOperation actionability/final accept, pbPresentation real scroll/target/press,
  accepted writes always verify despite cancel. Required operations FIFO; passive
  speech cues cannot reject required reads or interrupt accepted effects. Queue
  captures binding/control revision; takeover/hidden/explicit cancel revoke UI.
  Reset excludes its own pending journal entry. Empty cart replaces continue link
  with actual 立即點餐 button; bounded empty-state route now supported and tested.
  No generic execution/login/submit/payment tools. Unknown writes never replay.
  kioskSpeech sentence MP3 lookahead/cancel and phase timing implemented; not
  provider streaming or word timestamps. Rapid next input may cancel prior TTS.

  Final validation: Server40 / Kiosk150 / browser21 / speech2 relevant tests,
  cart17 earlier, scoped Kiosk/Server/Desktop types, scoped lint/build PASS.
  /tmp/pb-v2-empty-{green,native,build,lint}.log final empty-state regression;
  /tmp/pb-v2-final-types.log, /tmp/pb-v2-kiosk-final.log, /tmp/pb-v2-server-final.log.
  Native isolated Electron fixture covers FIFO race, actual UI dedup/write1,
  empty-state return + delayed footer, reset, ownership and security boundaries.
  Remaining outside agreed equipment scope: Windows/install signing/mic-array/
  production deploy. PB mandatory variants/sets unavailable live; synthetic only,
  unverified merchant shapes stay gated. No new user decision pending.

- Oct31 Jev/product-cue/hand IMPLEMENTATION is now connected. Authoritative
  four-phase plan/status: docs/plans/2026-10-28-windows-kiosk-electron.md.
  Missing kiosk_fast_path_context formerly returned SYSTEM_ONE_DISABLED even
  with Admin enabled. Regression is red->green; now distinct
  SERVICE_CAPABILITY_UNAVAILABLE. Do NOT toggle Admin to fix diagnostics.
  runFastPath has an application-owned FastPathSource seam. browserFastPath
  reads fresh PB refs/config/cart per turn, offers separate search/add intents,
  compiles only covered literal single-product serving slots, and calls the
  same browserCartTask/session/dialogue/effect gate as Main. Optional add-ons,
  mandatory/variable specs, groups and compound speech remain Main, unchanged
  utterance. Pending PB questions explicitly delegate with
  SERVICE_DIALOGUE_PENDING; they must not be consumed by direct candidates.
  Own Menu behavior preserved; its serving parser and cursor timing moved to
  neutral stage-shared subpaths ordering-slots/product-presentation.

  Shared pbPresentation runs INSIDE the PB isolated document: pointer-transparent
  Shadow DOM frames/illustrative hand; actual scroll settle/remeasure, bounded
  travel/dwell/press, reduced motion, cancel on trusted input/navigation/hidden
  document, eight-second expiry. It never clicks/writes. The existing executor
  clicks once or validates/dispatches the cart effect once. Fresh unique refs
  resolve cards, optional known search locates a missing unique card; ambiguous/
  missing cards show limitation instead of guessed coords. Multiple available
  cards get frames. Presentation receipts carry refs/facts/cue/durationMs and
  completed only after verified cart effect. Host browserPresentation discards
  late old-turn events; ScenarioSurface reserves a summary row above native PB.
  Audio playing triggers whole-utterance cues, no guessed word timestamps.
  Host-only browser_present is excluded from Main and clears with [] on reset.
  Main product-choice receipts retain structured presentationRefs for cues.

  Oct31 18:00 user explicitly APPROVED removing the current subtotal10 test
  cart and cleaning this run's additions. DONE via native PB clear-cart UI;
  confirmed “購物車是空的”, returned to menu, retained login. No need to ask
  again. All this run's actual items have now also been removed; CURRENT cart
  was EMPTY/subtotal0 at that acceptance end; see v2 note above for later
  user additions. Do not restore any historical baseline row.

  FINAL actual NORMAL Electron Kiosk acceptance PASS, same enrolled/login
  Profile, CUA real text/ASR simulation entry and actual Jev/Main:
  “雞腿便當一份” -> Jev FAST_ACTION intent:add-item,6model calls, cart10;
  “請加兩份排骨便當，每份加一份白飯” -> Main, unit15/qty2/each-rice1, cart40;
  chicken qty1->2 -> cart50, remove pork ->20, remove chicken ->0/empty.
  Every step exactly1 raw cart-tool dispatch,1verified receipt, displayUpdated
  true, semanticChoice ALLOW, native presentation shown and completed. The
  receipt parser asserts all these, not just spoken success. Filtered proof:
  output/playwright/pb-electron/jev-cues-write-acceptance.json (no visitor IDs).
  New-conversation reset subsequently cleared dialogue and retained login/empty
  cart at that acceptance end; subsequent user activity is noted above. No
  submit/payment.

  Critical fix found by actual red->green write test: PB Fast Path started the
  visitor but did not persist user_text before decideBrowserEffect. Server
  correctly returned CLARIFY/unavailable because no current canonical demand
  existed. KioskScene now appends the admitted original once per utterance just
  before effect validation; aborts if persistence fails. ASR diagnostics remain
  separate. No Server guard bypass/change. Kiosk package typecheck, scoped lint,
  2targeted route tests binding effect to active visitor/latest demand and
  rechecking after model IO PASS. Main flow remains unchanged.

  New validation:173Kiosk relevant unit,43ownMenu candidate regression,32PB unit,
  10Kiosk browser(1080x833/1080x1920 input/native/summary),5native visual browser
  PASS. Kiosk package typecheck PASS after honest readonly test-client types;
  scoped lint PASS. Desktop build and isolated real-process fixture validate
  frame/hand no click, explicit open deduped to1click, trusted touch cancels,
  touch invalidates old cart version, fresh-version removal sends exactly1DELETE.
  Final rebuilt runtime fixture PASS, including configured quote15/30 and zero
  writes. Current live NORMAL app session56590, same Profile, no CDP flags.
  Own exact inquiry “雞腿便當加白飯要多少錢？” initially returned base10,
  then redundantly asked which bento. Read ONLY this own transcript from local
  DB (never printed credentials) to establish actual tools search->observe
  choose_product. Red->green fixes: new browser_quote_selection reuses fresh
  resolveSelection; Host refuses base-only quote when a current option is
  literally mentioned (does not decide inclusion/refusal); uniquely named meal
  cannot be replaced by a generic product-choice question. Configured receipts
  are recognized by questionPresentation. FINAL live query PASS: search->
  observe(data-only named config)->quote_selection, actual unit/total15,
  effect:none, native presentation shown(duration1848.5ms),0cart-edit tool calls,
  visible subtotal10 was unchanged during that earlier read-only acceptance. Filtered proof without visitor IDs:
  output/playwright/pb-electron/jev-cues-acceptance.json. Logs /tmp/pb-jev-*.
  All fixture PB network is intercepted, no merchant auth/submit/payment.
  No new deps, root typecheck, commits or deployment. Windows/mic arrays and
  unavailable real merchant variant/group contracts remain outside acceptance.

  Normal local app session56590 /tmp/pb-electron-local-pilot.log. HMR after
  singleton/module edits can leave an intermediate unbound host; rebuild/restart
  same dedicated profile for final live checks, preserving login/current cart.
  No extra Firefox controller/extension or OS pointer access was added.

- Oct31 layout follow-up FIXED: laptop text console was a body-level floating
  DOM window covered by native PB regardless of z-index. Electron now reserves
  a middle grid row (#kiosk-text-console-dock) between hero and native site;
  KioskConversation passes the target to TextConsole via typed props, deferred
  Teleport moves it there. Native console is relative/non-draggable with compact
  input+submit layout and bounded scrollable diagnostics. Collapse reclaims space
  for PB; voice-only mode has no reserved row. Browser host retains its floating
  console. Root uses border-box and min grid heights. No new dependencies.
  Red->green dock/input/hit-testing/submission at1080x833 and1080x1920;14browser
  console+ASR-panel tests and scoped5file lint PASS. Live normal Electron updated
  through existing Vite; real screenshot confirms no overlap. Physical pointer
  click focused input, paste entered query, physical button click submitted it.
  Live readonly Agent menu query returned all3real meals/prices; no cart mutation.
  Windows display scaling/actual portrait hardware still not certified.

- Oct31 CURRENT: Electron Mac local pilot integrated and accepted for the
  current PB store. Remote Kiosk/API/Agent/data remain remote; local
  stage-kiosk-desktop owns the visible PB WebContentsView at the original URL.
  User manually logged into Electron and APPROVED registering this test Profile
  with a30day device cookie. Restart retained both enrollment and PB login.
  Profile ~/.webnavior/kiosk-desktop; never copy Firefox/Chrome cookies or handle
  credentials/PIN. Runtime below remains an inspected alpha LOCAL PILOT only.

  User explicitly authorized deleting the original test pork meal, then also
  removing the two chicken/rice meals AND cleaning subsequent additions from
  this acceptance run. Both auto-review rejections RESOLVED by explicit user
  approval; cleanup executed. Do not ask again about those completed actions.
  At the END of that earlier acceptance cart was EMPTY/subtotal0; the current
  pre-existing subtotal10 row noted above was added later. Do not delete it
  under that earlier cleanup authorization. Do not restore
  /tmp/pb-electron-baseline.json or treat old test rows as still present.

  Real existing Kiosk ASR-text -> Agent acceptance PASS: menu/prices; chicken+
  rice1 at15; two meals eachrice1 at30; quantity1->2 retaining per-serving rice;
  actual displayUpdated=true for add/quantity/cleanup; customer reset cleared
  dialogue, revoked prior consent, retained login/cart; new visitor write was
  blocked and exact old cart preserved. Final authorized cleanup verified empty
  and absent PB footer. Public default pickup rolled to Nov1 without manual code
  edits. No submit/payment. Filtered proof output/playwright/pb-electron/acceptance.json.
  Earlier two referential/compound removal phrasings conservatively refused;
  explicit “請移除購物車裡的雞腿便當” passed. Cause not established, no speculative
  semantic changes. Never force an ALLOW to make tests pass.

  Current usable app: session90476/PID8245, /tmp/pb-electron-local-pilot.log,
  NORMAL startup with NO inspect/CDP flags; same Profile. Final ordinary launch
  again passed real Agent menu query through CUA. Stale DevToolsActivePort file
  does not mean a debugger is running. No separate Firefox/PB controller needed
  for Electron. Temporary acceptance observer stopped/deleted before restart.
  Existing API5168/Kiosk5169 development services remain; no deployment done.

  Durable fixes: connectDesktop copies only ownership keys (ready binding URL
  must not enter strict RPC); pbRoutes parses PB public Ziggy JSON, validates
  verb+exact bounded URL without main-world route() access; host resets at
  navigation commit so old pagehide sequence cannot supersede new preload;
  PIN dialog role/aria + layer110 hide native PB and outrank diagnostics.
  PB refresh_cart listener is inactive: verified writes use approved same-menu
  Inertia link, bounded finish+Vue render wait, close only the known announcement,
  recognize absent empty-cart footer. Pending marker remains during navigation;
  display failure preserves verified receipt, never replays a write.

  Validation PASS:32PB tests,5desktop policy tests,3transport tests,3browser
  placement/PIN hit tests,2targeted enrollment/revocation tests, package desktop
  types/build and scoped lint.13real-process SYNTHETIC checks also passed,
  /tmp/pb-electron-final-runtime.log, including delayed rendering and empty footer.
  Host media check+request callbacks admit only configured Kiosk main-frame media;
  vendor/iframe denied. Actual synthetic devices passed. Physical ASR/mic arrays,
  Windows/touch, installer/signing/update, generic sites and persistent cross-crash
  reconciliation remain outside acceptance. Default1080x1920 subject to OS work
  area limits. No root typecheck, commits or formal release. Follow desktop README
  and Electron plan; do not reopen superseded zero-install browser feasibility.

- LATEST Oct30 native PB interface test COMPLETE after user confirmed 已登入.
  Manual-login exec6755 closed exit0; log /tmp/pb-native-interface-manual-login.log
  FIRST_PARTY_LOGIN_VERIFIED:true. Do NOT ask user to log in again on that claim.
  Then inspector --retained-profile exec44381 closed exit0, log
  /tmp/pb-native-authenticated-final.log. Both first-party and actual Kiosk PB
  iframe auth TRUE;3approvedCookiesPrepared; NO PB peer injection. Normal shared
  discovery times out with zero tools; native search_product has NO field effect,
  zero replies to parent, no #chatFrame/window.eventData. Native original URL
  unchanged, GET/HEAD merchant requests only; no cart writes/submit/payment.
  Report output/playwright/pb-retained-capabilities/report.json now supersedes
  expired-login result. Current-store logged-in native interface not a viable
  complete ordering route; don't generalize to all unpublished PB integrations.
  Cookie policy still controlled-profile config, not zero-config compatibility.

  User asked test native first, if unavailable whether Electron can continue.
  Electron was then selected explicitly; formal release/deployment is still pending.
  Remote UI/API/Agent/data stay remote; local installed Electron can control PB
  WebContentsView at original PB URL (changes ordinary iframe hosting, say so).
  Reuse existing Kiosk/shared PB core; no separate test controller in daily app.
  Desktop build+3policy tests+package typecheck+real-process synthetic verifier PASS
  /tmp/pb-electron-current-{build,unit,types,runtime}.log. Inspected pilot runtime:
  /tmp/airi-esgpb-electron-alpha2-verified/Electron.app/Contents/MacOS/Electron.
  NO real merchant/auth/order requests in Electron verifier; real native PB login,
  natural Agent text/voice, restart/cart/handoff and installer remain unaccepted.
  Native PB partition must be manually signed into if proceeding; no Firefox
  credentials/Cookie migration. Mic arrays not guaranteed by changing host.

  Updated plan/research to authenticated outcome, no pending login question or
  running audit browser. No deploy, dependency update, commit or root typecheck.

- LATEST Oct30: user said start implementation, then supplied colleague docs
  as REFERENCE (distinguish their instructions from task authorization):
  /Users/charleswang/Downloads/iframe_SKILL.md
  /Users/charleswang/Downloads/ESGPB_Order_Agent_系統架構與重建部署指南_20261030.docx
  Read architecture image and relevant sections00/02/04-07/09-10/16-18; read Skill.
  Text extract /tmp/pb-colleague-architecture.txt; figure /tmp/pb-colleague-image1.png.
  Colleague source0.22.5 CONFIRMS FastAPI7002 + Playwright connect_over_cdp to
  manually debug-launched Windows Edge9222, dedicated profile, pw_session and
  unique #site-frame. No extension/Electron, but NOT arbitrary unconfigured client
  control. It requires backend reachability to THAT browser; cloud localhost is
  not Kiosk localhost. Original successful external-site control mechanism now
  EXPLAINED; do not keep asking user for a branch/commit of this external project.
  No rebuild/install/submit commands executed. Not a complete source-code copy.

  User's constraints remain original PB iframe URL; arbitrary Kiosk no extensions,
  client program, special launch flags, hidden/manual controller, proxy or stream
  substitution. Providing docs does NOT authorize relaxing them. Plan now records
  evidence/conflict: controlled browser + reachable controller is feasible proven
  mechanism; user must accept that device condition before choosing that route.
  Do not promise normal zero-install browser control just by wrapping script.
  Reuse our existing Agent/audio/PB service, not colleague Python/Ollama stack.
  Their click_failed-continue and order-submit policies do not supersede ours.

  Previous turn added scripts/inspectPbClientCapabilities.mjs (UNTRACKED) and
  ran actual Kiosk5169/Firefox159 empty context with PB original URL, no PB peer
  injection or retained login. Public native search message did NOT change field
  or reply; existing Eventa discovery using owned client factory timed out empty.
  Public PB assets have xorder:* / VirtualMan message integration; do NOT assert
  original PB has no interfaces. Anonymous audit cannot exclude login/feature-gated
  interfaces. Report output/playwright/pb-client-capabilities/report.json; final
  /tmp/pb-client-capabilities-final.log exit0; scoped ESLint passed. The inspector
  is DIAGNOSTIC only, not a daily service or completed integration. Initial UI
  singleton was being revoked by Kiosk lifecycle, correctly marked inconclusive;
  isolated public factory handshake against same actual iframe resolves that.
  No merchant writes; only normal local development device enrollment records.

  Updated plan/research/README; no deploy, service shutdown, profile changes, new
  deps, commits or root typecheck. Superseding plan front section is authoritative;
  old Companion sections historical. No new request pending for colleague docs.

- Oct30 Firefox browser compatibility COMPLETE for the current Mac/PB menu.
  User explicitly completed manual login. Scope remains browser first; do not
  change deployment URLs or require mic/Windows hardware. No commits/root
  typecheck/deploy/submission/payment. Preserve all preexisting dirty work.

  Run `node scripts/tryWebnaviorPbPrototype.mjs --firefox` with existing API5168
  and Kiosk5169. Installed Firefox159 via public Playwright1.60 moz-firefox BiDi,
  1080x1920, own ~/.webnavior/pb-prototype-firefox. NEVER open this upgraded159
  profile with bundled150, clear it, copy Chrome cookies, or touch personal Firefox.
  User login survived repeated actual controller restarts and PB iframe auth check.
  Firefox artifacts separate: output/playwright/pb-firefox/. Current visible
  controller session39396 intentionally retained after PASS --addon-cases;
  /tmp/pb-firefox-addons-repair.log. Close that controller/window before another
  launch against the same profile. API session49325 remains; existing Kiosk5169.

  firefoxBrowser.mjs owns launch policy: stock BiDi persistent startup awaited an
  about:blank load that159 never emitted (reproduced empty profile). Explicit
  matching startup args + ignoreDefaultArgs=true skip only that default-page wait;
  actual target navigation still awaited. NOTICE/removal criterion in source.
  Restore normal Lax and cookieBehavior5 through firefoxPreferences.mjs. Mozilla
  privacy.restrict3rdpartystorage.skip_list exact pair localhost5169/PB shares
  unpartitioned login only there. firefoxIframeLogin.mjs prepares only3approved
  fresh unpartitioned Lax cookies as None/Secure preserving all other attributes.
  No global cookie/security bypass. Earlier requestStorageAccess and enterprise
  policy experiments were unsuccessful and REMOVED; do not retry those paths.

  pbBrowserBridgePrototype admits empty referrer but rejects a contradictory
  supplied referrer; exact Eventa parent origin/window checks remain. Stock159
  synthetic verifyFirefoxPbBridge.mjs passed valid no-referrer search + wrong
  parent refusal. verifyFirefoxCookiePolicy.mjs passed stock persistent startup,
  first-party Lax control and PB pair-positive/foreign-parent-negative cases.

  Stock BiDi Request.postDataJSON is always null (own dependency BidiRequest
  hard-codes postDataBuffer=null). Controller observes only its Kiosk's actual
  JSON fetch inputs for customerTurn/staff-review assertions; no PB requests,
  headers or credentials captured, calls forwarded once. Other optional fault-
  injection cases still using route.postDataJSON were NOT accepted on BiDi.

  Real Firefox PASS catalog lookup, handoff (old consent revoked, previous cart
  redacted, writes blocked until explicit reviewed resume, login retained), and
  3natural paid-rice cases: add one / explicitly omit / two meals each with one.
  Every case preserved its fresh original cart. Current original cart includes
  a preexisting排骨便當1; do not clear it. Evidence catalog/addon/handoff-cases.json.
  Initial two-meal failures exposed missing tool quantity units and wrong unit
  price. PB descriptors now explicit per serving. Cart pre-dispatch price mismatch
  reports effect:none + expectedUnitPrice; PB adapter returns bounded proposal
  correction (not a write/unknown retry). Regression red->green proves no commit,
  cart unchanged and corrected proposal executes. Shared browser/Electron core.

  Validation: 18Firefox iframe client cases,25PB product/cart unit cases,2login
  prep unit cases,2stock Firefox synthetic scripts, scoped eslint all PASS.
  No root typecheck. Formal usage apps/stage-kiosk/README.md; evidence/reasons
  docs/research/2026-10-29-webnavior-pb-integration.md. Mic array, Windows and real
  native Electron login/order acceptance remain outside this browser acceptance.

- Oct30 LATEST non-microphone implementation after user authorized continuing
  BOTH hosts: PB runtime extracted to stage-ui/services/pbBrowserService.ts;
  browser window peer and pbBrowserNativeEntry share the exact operation policy.
  interactiveServiceClient now coordinates a neutral ServiceConnection factory;
  window transport keeps source/origin checks, native transport uses bounded
  preload RPC through Eventa. NativeServiceSurface emits ready once per placement
  identity (not resize/occlusion); ScenarioSurface binds the common client.
  Electron ServiceSurface injects bundled PB code in world1001, finite
  discover/execute/inspect only, and checks trusted host IPC source + active
  service/document + approved PB path + navigation generation before/after IO.
  No raw code/selectors/Electron APIs exposed to vendor or Main. Native wait
  cancellation never implies a committed effect was canceled; recovery inspects
  accepted IDs through the same client. Browser prototype is STILL a controller,
  not production Companion pairing/revocation/persistent operation journal.

  Native package build now runs scripts/buildKioskPbService.mjs before
  electron-vite to produce out/service/pb.js. No dependency added. Mac inspected
  Electron runtime unchanged (embedded Node24.22.1). Native manual login is a
  separate profile: do not copy Chrome cookies/storageState or claim native real
  PB ordering is accepted. Existing Electron display peer for owned Menu is not
  implemented; automation scope remains the approved PB menu.

  PASS: shared client3+native cancellation2 unit cases; existing iframe browser
  client18 cases; native Vue placement2 and ScenarioSurface1 browser cases;
  desktop policy3; PB cart16. Electron real-process synthetic PB URL fixture passed
  visible search, discovery, isolated main-world privileges, receipt dedup/inspect,
  wrong document/arbitrary-code rejection and navigation scope denial. Its https
  protocol is intercepted in a disposable session; NO real merchant/auth requests.
  Real Webnavior/Chrome PB add/quantity/remove passed with original fresh cart
  retained (/tmp/pb-shared-service-real-kiosk-final.log). First attempt was refused
  BEFORE any write by recovery-read error; a new read-only diagnostic returned
  canRetry:true, then fresh run passed. No guard relaxed or old write replayed.

  Relevant checks: /tmp/pb-native-{unit,connection-unit,desktop-unit,ready-browser,
  vue-browser,browser-client-final,electron-live,shared-types,desktop-final-types,
  kiosk-final-types,bridge-final-types,complete-lint}.log. No root typecheck,
  commits or deploy. Stage-ui already has vitest.interactiveService.config.ts with
  VITEST_BROWSER_CHANNEL=chrome; use that focused config (do not change/download
  browser runtime just for tests). Main-config browser run hit missing cached
  Chromium; using installed Chrome passed18. agent-browser absent, existing
  repo Playwright verifier used. No new library chosen.

  Runtime now: existing Web5167/Kiosk5169 dev servers were already present; own
  restart attempts correctly failed strict-port and were not used. API5168 own
  session74237, /tmp/pb-native-api.log (non-watch). No controller remains; final
  session76754 closed exit0. Dedicated Chrome login retained. Docs updated in
  stage-ui/Kiosk/Desktop READMEs, same plan/research; native audio untouched.
  User will provide microphone details later; don't block independent work on it.

- Oct30 on pb_order (HEAD e8491ec, no_mcp merged), LOCAL ONLY; no commits,
  deployment or root typecheck. Preserve the large preexisting dirty/untracked
  tree. Roadmap: docs/plans/2026-10-28-windows-kiosk-browser-companion.md.
  User wants consecutive work unless a decision is necessary. LATEST decisions:
  only current three bentos + paid rice are available; user cannot change vendor
  data. Validate on Mac, assume ASR text correct. No physical kiosk is available;
  Windows/touch/mic checks are deferred, Electron may be a future packaging route.
  Do not ask for those data/hardware again. Five stages are NOT all complete.

  Previously accepted actual1080x1920 Webnavior/PB: D01 multi-add, D14 quantity,
  D13 two-to-one replacement, remove, D11/D12/D04 queries, three generic replies,
  eight selection/correction/cancel/confirm/replay turns. Paid rice, batch config,
  same-document scope denial, faulty-target guards,13 effect/12 answer provider
  cases also passed. Historical original pork rows7531 qty1/7543 qty2,total30 were
  preserved in those runs. CURRENT fresh PB later returned order:null/details:null/
  subtotal0 (not historical30); latest smoke/add-on tests restore that fresh empty
  baseline. Cause of older order disappearance is not established. Never claim
  historical30 is still present, clear the shared cart, submit or pay.

  NEW local customer ownership: browserCartSession persists only opaque owner by
  service origin/path. Fresh empty cart can admit a visitor; nonempty unowned or
  previous-visitor cart blocks writes and redacts old lines from Agent. Catalog
  inquiries still work. Owner changes during semantic IO reject. Staff-only
  browserCartHandoff.vue in PIN admin panel shows a freshly read cart, requires
  explicit reviewed checkbox and same owner/service/document/version before
  claim. Unknown/pending effects NEVER unlock through review. This is local
  admission, NOT upstream multidevice cart isolation. Live handoff including pending confirmation AND open product draft/note/search
  PASSED in /tmp/pb-proposal-handoff-live.log. Zero PB writes before staff review;
  exact new request succeeds afterward, all isolated test rows restored.
  Tests authenticate a local staff-session fixture; PIN authentication is NOT
  under test. Artifacts handoff-cases.json/draft-reset-cases.json under
  output/playwright/iframe-probe-20261029; do not infer success from stale files.

  PB order:null is now supported ONLY with zero subtotal and missing/null/empty
  details. readCartPage rejects contradictions; clears stale orderHash. Context
  is structured orderRef/date/time/manualRevision. First add may create orderRef
  only from empty identity-free state, while pickup/manual/effect checks stay
  strict. Real empty-cart add/quantity/remove smoke PASS.
  Host-only browser_customer_reset closes known unsubmitted product draft, clears
  search, verifies whole cart unchanged, increments manual generation and renews
  Host binding while keeping the same PB document/login/cart. Owned Menu retains
  reload behavior. PB's role=dialog is on el-overlay-dialog OUTSIDE .menu-dialog;
  first draft test reproduced the selector bug, smallest real-site reset now PASS.
  It never clicks generic confirmations or reloads to clear a cart. Public observe
  hides previous note/search; recovery digest can still inspect them locally.

  Latest actual add-on matrix PASS: one meal +one paid rice (15), one meal explicitly
  no rice(10), two meals each +one rice(30); all precise configs/quantities/subtotals
  verified and isolated rows removed. Unselected mentioned option becomes a zero
  omission constraint; Main independently extracts0 for refusal/positive amount
  for a required repair. Only option constraints may authorize zero, never a zero
  product/cart mutation. Logs /tmp/pb-reset-addon-live.log and addon-cases.json.

  Main confirmation construction now returns bounded pre-effect proposal_rejected
  for invalid config version/price/selection instead of generic tool errors. Three
  red/green regressions pass; correction only creates a fresh full confirmation,
  never writes. Host selection shape parsing also returns known-no-effect repair.
  Controller preserves non-JSON tool errors in evidence instead of masking them.

  Native fixed-product form uses BASE unit_price + per-serving attrs and fresh
  pickup/config. Required radio maps to attrId; optional/multi maps attrId=>qty,
  including zeros. Full-cart reconciliation and store-scoped persistent unknown
  latch remain. Fresh category index/counts, batch full configs and schema hashes
  handle observed fixed products/options without product mappings. Variants/groups
  writes remain closed; unavailable real data means no live acceptance. Pure
  daily change tests cover seven products/three categories/new IDs/names/prices.

  Browser question tickets bind visitor/document/cart/config/price/120s; selection
  only issues full add confirmation, read never writes, later add must exactly
  match saved plan. Answer route uses recorded current question/latest user before
  and after IO. Whole relation is judged without candidate IDs, then selection;
  uncertain gets bounded Main. Actual Main qwen36, Jev openjev/Qwen/Qwen3.5-4B;
  do not change settings or claim mock SLM checks as live acceptance. Effect guard
  classifies whole purpose then independently extracts requested quantities without
  proposed quantities/prose. One repair;4normal+2 known-no-effect repair batches,
  global16/deadline, verified receipt reuse only while resulting cart version stays
  current. Generic Host replies reuse existing bounded conversation. Quotes
  supplement other explicitly named product presence/base facts only.

  Current checks PASS: Kiosk7files117 tests, PB3files29, Server effect26, real Chrome
  handoff UI4, Kiosk/Server package types, strict bridge tsc and affected-file lint
  (see /tmp/pb-customer-final-*and /tmp/pb-handoff-complete-* logs). No full/root typecheck. Prior wider
  scoped tests recorded in formal research doc; avoid repeating without changes.
  Latest user direction: retain BOTH browser+Companion and Electron. Electron is
  motivated by microphone-array capture/noise concerns, not abandoning web Kiosk.
  The earlier forced binary choice is superseded. Share ordering/Agent/PB policy;
  separate host execution and audio acquisition. A shared native audio worker may
  serve Companion or Electron; no native library/SDK selected or implementation
  claimed. Browser audio is not normatively capped at2 channels; actual capture
  depends on browser/OS/device/driver. A processed DSP mono/stereo output can be
  appropriate; raw array channels require processing, not just more channels.
  Electron renderer getUserMedia still uses Chromium, so packaging alone does not
  bypass capture limitations. Current audio-device.ts uses browser constraints
  with AEC/NS/AGC enabled; no explicit channelCount/native array path. Hardware
  model/driver/channel mapping/DSP output unknown; no physical machine requested.
  Still needed beyond current Mac slice: formal capability/mode and Companion
  pairing/revocation/single executor/persistent operation journal; upstream shared
  cart isolation; unknown-result maintenance (never auto-unlock). Windows/real ASR
  and unavailable product shapes are explicitly deferred. Existing apps/stage-kiosk-desktop now has the bounded PB peer described above;
  native real-account ordering and formal deployment remain unaccepted.

  Runtime: Web5167/API5168/Kiosk5169/kiosk/#/. Own API now session74237,
  /tmp/pb-native-api.log (non-watch; restart after Server source changes).
  No prototype controller remains; last session49599 closed exit0. Successful
  /tmp/pb-proposal-handoff-live.log supersedes failed /tmp/pb-draft-handoff-* runs.
  Stop own controller and await exec closure
  before reopening ~/.webnavior/pb-prototype (0700). Manual shared login persists;
  no storageState/credentials/account fields in logs. Freeze runtime sources during
  acceptance, including lint --fix. Restore only proven isolated test deltas.

- Oct28 user switched priority to existing browser/iframe + local CDP companion;
  main roadmap: `docs/plans/2026-10-28-windows-kiosk-browser-companion.md`.
  Planning only in latest turn: dedicated Edge, authenticated outbound companion
  channel via Server (not yet implemented), same-document ownership, external
  Agent adapter, Admin mode/policy/health and phased Windows acceptance. First
  milestone is actual Kiosk login/binding, then Agent cart tools. No new runtime
  integration, deploy or dependencies in this planning turn. Electron plan is
  explicitly alternative; pause its expansion, retain its work.
  New `scripts/verifyIframeCookieCompatibility.mjs`
  + Kiosk `scripts/browserCookieCompatibility.mjs` pass real ESGPB login/reload,
  M oolong/light sugar/light ice add/readback/remove and original-attribute restore
  in isolated Chrome156.0.8078.48 (Edge absent on this Mac). Original $35 retained,
  no order/payment. Raw Network ExtraInfo exposes schemeful Lax blocking; only
  order_session/XSRF-TOKEN plus necessary srvkey routing are adjusted. Public
  controls prove backend-specific JS hashes: missing sticky routing caused404.
  Gate follow-up Fetch requests until Cookie writes settle, otherwise login
  rotation can race its redirect and return anonymous. Clear only scratch cache
  after negative control; don't force clicks past a non-hydrated website mask.
  Six focused Vitest cases pass; Kiosk README has command and limits. This is a
  loopback iframe fixture, NOT Windows Edge/Assigned Access or actual Kiosk/LLM
  bridge acceptance. Next: same-page companion transport/tool integration into
  existing Kiosk; no new website config source, no stored/shared raw credentials,
  no real-site order submission. Keep Electron optional rather than mandatory.

- Oct28 Windows11 Kiosk planning is now followed by LOCAL phase1 implementation:
  `docs/plans/2026-10-28-windows-kiosk-electron.md`, new `apps/stage-kiosk-desktop`,
  neutral `stage-shared/kiosk-desktop`, and Kiosk `NativeServiceSurface.vue`.
  Existing Admin URL/draft/publish retained; idle reload fetches assigned Profile,
  no new live-profile sync. Native bounds/modal hiding/input activity, per-service
  storage and host-reload sequencing are implemented; web iframe remains.
  Desktop3 unit / Kiosk3 Chrome / native7 acceptance checks, scoped desktop/Kiosk
  types, affected lint and desktop build pass. No root typecheck, commit or deploy.
  Eventa beta.8 renderer type patch fixes removed sendTo requirement at owning
  declaration, not via casts/stubs. No generic Agent browser tools, native owned-
  Menu protocol, installer or Windows hardware acceptance yet. User can operate
  and log into host; don't block feasibility on edition/account details. Future
  confirmed Agent order submission is desired, customer pays; CURRENT real-site
  tests must never submit. Official test site will be supplied later. Common vs
  personal vendor login undecided. Do not demand those decisions for read/display
  and cart feasibility. Current user authorization is plan AND proceed with
  implementation without routine confirmations.

- Oct28 ESGPB Electron experiment is LOCAL ONLY, not Kiosk/Agent integration.
  See `apps/stage-kiosk/README.md` Electron prototype section and its two scripts.
  Native WebContentsView login/reload works with original Lax/Secure cookies;
  programmatic M oolong/light-sugar/light-ice add/readback/remove passes, retaining
  the original $35 cart. No order/payment. Host nvm24.22.1 installed/default set;
  existing shells/processes need explicit switching/restart. Isolated official
  Electron46.0.0-alpha.2 embeds24.22.1; workspace41.2.1 remains old and is rejected
  by prototype preflight. Do not ship the prerelease as a production approval.
  Security details/remaining dependency findings are in Oct27 security audit's
  Oct28 local-prototype section. Initial macOS DYLD popup was Python ZIP
  extraction losing framework symlinks, fixed using `ditto -xk`. Driver must wait
  for translated form before fill (hydration otherwise erases input), and click
  visible Element Plus radio labels. Next: select a supported patched desktop
  runtime and design browser-tool integration into existing receipt/ownership
  contracts; native hosting alone does not supply tools to the Kiosk Agent.

- Oct29 user explicitly authorized plain-language batch commits after field
  deployment. Commits:907db15 new-device defaults;9c702f6 staged routing, SLM
  transport and verified character replies/retry guards;efd8e82 admin SLM
  selection;bd70eb3 historical fixtures/runners/results; documentation follows.
  Commit validation:Server213, Kiosk123, Menu26 and Chrome3 tests pass; Python
  coverage provenance checks7 pass. Initial full typecheck found a new browser
  test name-type mismatch; resolved by looking up the issued Menu definition,
  then scoped Kiosk and full-project typecheck passed. Changed-file ESLint and
  all normal commit hooks pass. Root lint initially2373 errors:3 current JSON
  formatting errors fixed;2370 previously recorded errors remain out of scope.
  Recorded inspection request/response manifest hashes preserved. Only tests
  and documentation changed since deployment; production sources still match
  the release snapshot. No push, model inference rerun, redeployment or profile
  switch in this commit task.

- Oct29 user requested field deployment: API, management Web, Kiosk and Menu
  published to https://webnavior.aikcitri.qzz.io for testing. API restarted
  17:57:33 Taipei, PID503794; readyz DB/Redis and Bridge health pass. Isolated
  public browser verifies all75 HTML/linked asset hashes, no page errors;
  admin SLM form discovers local DMR models including Qwen3.5-4B. Existing
  RTXPROjev remains active; existing1060-character custom policy preserved.
  Restore/save default explicitly to adopt concise policy; staged routing is
  already active. No new SLM profile saved/activated, DB migration, dependency
  installation or Nginx change; subsequent commits are listed above. Fresh browser Kiosk loads enrollment;
  no test device, cart or payment created. Existing Kiosks need reload after
  finishing any transaction. Backup (verified pg_dump, old three frontends,
  staged builds, source hashes, logs, release.json):
  /tmp/webnavior-slm-field-release-20261029-05dh4hst. Standard systemctl timed
  out and sudo required password; verified owned launcher was killed and
  unchanged systemd on-failure/control-group restarted it. This deployment
  proves availability, not model semantic acceptance; limitations below stand.

- Oct29 user-authorized implementation: candidate tree + selectable SLM DONE
  and subsequently field-deployed/committed above, no profile switch. Runtime HTTP hardcodes
  `routing:staged`; direct flat API remains frozen diagnostic policy only.
  Four-way admission -> demand -> legal family/leaf, <=6 choices/question,
  no candidate truncation. Independent writes additionally require operation
  purpose + whole-effect coverage. Typed live answers retain exact ticket;
  rich conditions hand to read-only Main, not partial filters.
  `kiosk-system-one/slm.ts` compiles/parses strict one-token letters, thinking off,
  no tools/reasoning, no fabricated confidence. Adapter alone stamps unscored;
  Jev cannot spoof it. Checkpoints/UI progress preserve that stamp. Admin adds
  slm, /models discovery, model selection, real readiness and existing encrypted
  lifecycle; SLM label says field test. TEXT implementation needs no DDL.
  Concise default affects post-admission interpretation; custom text preserved.
  New Menu ordinary intent lease follows shared 60s turn budget; state revisions
  still bind execution. Question-dependent effects keep question expiry;
  independent orders do not inherit unrelated deadlines; confirmation stays15s.
  Tests reproduced old20s expiry + unrelated30s cap, then verified these guards.
  Real evidence:1114-source first-gate protocol,1115HTTP,0 errors,29min,NO semantic
  accuracy; all44 SLM guarded22/43+1gap, resolver all40 12/39+1gap; same44 Jev
  18/43+1gap,104HTTP,normal responses,NOT model ranking/full recovery acceptance.
  SLM Menu all26 after lease fix:6/26 original route labels,0 execution errors,
  no observed query/background cart increases. Most mismatches hand to Main;
  ignored/unfinished valid requests remain. p32/p35 add proposals now hand off;
  query-portion originally cart2->3, now guarded. Two16s valid adds now cart2->3.
  Initial/guarded/lease versions retained separately under results/*staged*;
  exact table/limits in docs/plans/2026-10-28-kiosk-slm-evaluation.md.
  DO NOT call collection completeness semantic success or claim replacement
  acceptance. No further model tuning/reruns needed this unit; all real jobs
  have completed. No live Main/audio/multi-device/POS certification.
  Scoped verification:119 Menu question/configuration/clarification/intent tests,
  31 routing/checkpoint tests,72 Kiosk tests and3 Chrome tests pass;profile/SLM
  wire/admin tests passed in focused Server runs. Server/Web/Kiosk/Menu scoped
  typechecks,changed-file ESLint and diff check pass;root typecheck not run.
  Live semantic suites intentionally exit nonzero after retaining all rows.


- Oct29 FULL SOURCE SLM evaluation COMPLETED after user rejected sample shrink.
  Safe artifact test_prompt/turnClassifierPoc/results/slm-full-20261029-summary.json;
  source1114 records/986 distinct literal texts,1382 assessments including44
  complete route-layout controls (same source caseIds,not new samples).1380
  actual local DMR requests,65.1min batch elapsed.771 scorable source records,
  1038 scored assessments;338 unscored,3 missing prompts,2 source candidate gaps
  (p24 appears twice across layouts).No aggregate accuracy across unlike tasks.
  Core full44 route:question-first26/43,state-first30/43;resolver21/39;forms294/400.
  Semantic setup18/26;chains50/64 step labels,NOT real Main/tool/UI execution.
  Legacy requirement profile84/130 fields,only1/26 all fields;generative projection
  62/160,only1/40 all fields;not adopted runtime contracts. Review16/29,3 pre-model
  domain rejections. Recent provisional form gold40/104,22 unscored;older316
  outputs all unscored,NOT passed accuracy. Keep original gold,do not rerun failures.
  Decision:do NOT directly replace Jev with this SLM connection. Neither full
  layout passes historical contracts;not a current Jev-v-SLM ranking and not a
  conclusion against all SLM designs. Earlier ten-case9/10/4-way10/10 are only
  controls,NOT substitution acceptance. At that earlier study adapter/admin did not yet exist; see the completed
  implementation above. Calibration and full Main/ASR/UI acceptance remain
  unvalidated. No deployment.
  All model sessions DONE;no further inference needed this unit. Private logs:
  /tmp/webnavior-full-coverage-20261029-031307.log,then
  /tmp/webnavior-full-coverage-pending-20261029-034833.log,
  /tmp/webnavior-full-coverage-older-20261029-040325.log,
  /tmp/webnavior-full-coverage-state-first-20261029-041551.log;each has manifest.
  Frozen manifests /tmp/webnavior-full-coverage-{manifest,pending-manifest,
  older-manifest,state-first-manifest}.json;full request/response only private.
  First batch had one harness deadline truncation p40 at3224ms;no captured answer.
  Declared continuation completed it once,original attempt retained explicitly in
  interruptedAttempts. No other provider/format errors or remaining NOT_RUN.
  Upcoming runner reserves full request deadline before starting. Summary verifies
  input/parent hashes;ordinary errors and semantic answers cannot be overwritten.
  Model inspect confirms unchanged d5b494629720… Qwen3.5-4B GGUF digest.
  Scripts under test_prompt/slmDecisionInspection/:captureFullCoverage.py (readonly
  SQL,no LIMIT),prepareFullCoverage.py (all sources,new snapshot labels must be
  reviewed),summarizeFullCoverage.py (safe report),testFullCoverage.py.52 offline
  checks pass (19 transport,26 semantic fixtures,7 provenance/privacy/continuity),
  changed TS ESLint and diff check pass;no full-project typecheck. Pure fixture
  moved unchanged to order-menu experiments/semanticReplayCases.ts;shared test
  compact contract slmRoutingQuestions.ts. No production behavior change this
  quantity task,no config/order mutation,commit or deploy. Prior repair local.

- Oct29 latest user four-goal unit: real bounded routing experiment completed,
  slmRoutingExperiment.test.ts,60 requests in202.8s. Nine archived synthetic
  historical-family cases + greeting control; frozen gold/hash, no retuning.
  Original Jev3/10,SLM4/10; same candidates/count/order/state with concise
  instruction+descriptions both9/10; separate4-way service task both10/10.
  Four-way is coarser,NOT full operation success or isolated candidate-count
  effect. Both concise variants miss p29 compound -> ADD only. SLM supports a
  simplified first-gate alternative,NOT drop-in full replacement acceptance.
  Summary test_prompt/turnClassifierPoc/results/slm-routing-20261029-summary.json;
  private /tmp/webnavior-routing-experiment-20261029-024744.log*. No config/Main/
  order mutations. Existing earlier results below remain scoped diagnostics.
  Local code: unresolved UNCERTAIN_OPERATION without effect handoff now read-only
  all phases; explicit qualified NEW_REQUEST still writable. Completed no-tool
  unverified prose + fresh context becomes owned assistant clarification,never
  fake success; KioskScene records recovery and owns next answer. Tool attempts/
  transport failures keep receipt/error policy.124 Kiosk unit +2 Chrome +22
  Server reply/SLM transport +12 Menu context tests,Kiosk typecheck pass. Browser uses presenter/
  real component/Menu,not live Main or physical speech. Still uncommitted and
  undeployed; production SLM adapter/admin and full-flow acceptance NOT done.

- Remaining actual-flow acceptance: verify loaded Server/Kiosk/Menu identity
  and final model-visible facts;keep requested effects distinct from tool
  success;run small6-family full-flow acceptance from the repair plan. Latest
  local guards are not certification of the field cancellation chain. Quick
  31/32,historical5/26 and latest routing scores are different task contracts,
  not model ranking. Main thinking-on comparison remains unperformed.

- Oct29 new attachment cancellation/fulfillment issue investigated READ-ONLY.
  Audit appended to docs/research/2026-10-26-kiosk-conversation-error-audit.md.
  Attachment sha3395857c…,matched116 live entries; original private log/session
  /tmp/webnavior-20261029-{main-diagnosis-private.log,session-private.json}.
  Main NOT crashed in this case: utterance7 model562ms,1 round,0 tools,reply
  ignored cancellation and asked fulfillment; presentation rejected unverified-
  reply. Earlier utterance6 cancellation actually called SET_FULFILLMENT takeout,
  receipt still bento+dumplings; model draft falsely claimed bento removed.
  Receipt rendering suppressed fake removal but accepted unrelated actual mode
  operation. API live/ready and DB/Redis healthy; no Jev timeout/CUDA in trace.
  Root21 choices,instructions3618chars,state1497,criteriaJSON1943. Open-source
  OpenJev/colibri examples separate short single-property questions; architecture
  suggestion:4-way service/greeting/background/uncertain first,operations later.
  Not implemented or validated; do not just shorten text or allow all prose.
  No new model calls,config changes,restart,tests,commit or deployment.
  Follow-up: also inspected Strands before_tool_call intervention, Together tev1
  examples/decide.py,Colibri,kataras SDK and public1000 challenge (not run here).
  Strands grounding/prematurity questions illustrate a seam,NOT adopted thresholds
  or a reliable new semantic gate. Effective Redis Main is webnavior/chat ->qwen36,
  enableThinking=false,timeout60s. Router overrides per-upstream thinking each
  round;caller flip alone cannot enable it. Keep field setting unchanged pending
  bounded isolated Main off/on comparison (proposed6 synthetic chains x2,8min).
  Important: tool-result compaction can strip cart/selection when latest context
  has catalog,so raw stored cart != exact model-visible cart. Context refresh was
  recorded,but full upstream request was not. False removal is proven; whether
  model ignored visible cart or misread projection is not. Audit records limits.

- Oct29 user clarified: test SLM against prior Jev problems only, no need to rerun
  Jev. slmHistoricalFailures.test.ts now selects27 archived baseline contract
  failures from existing frozen44; p24 missing expected candidate is Application
  gap,26 testable. SLM-only26 HTTP in188.6s:5 expected root choices,21 mismatches,
  zero transport/format errors. Live test deliberately FAILS semantic assertions.
  Exact archived synthetic state/candidate descriptions; frozen concise SLM
  instruction instead of old long Jev policy,thinking off,label token,no retuning.
  Original gold; needsAll root accepts MULTI_ACTION or NEEDS_ASSISTANT before run.
  Wrong query->ADD,mode->defer,compound->partial persist. Do not directly replace
  Jev with this adapter configuration based on historical evidence,NOT speed or
  current Jev ranking. Root pass does NOT prove old full-flow failure recovered.
  Correct progress overcount:27 selected/26 testable,not28/27. No Jev/Main/DB/order
  calls,config change,commit/deploy. Stop this bounded evaluation; no hours-long
  expansion or repeated user instructions. Evidence /tmp/webnavior-slm-history-
  20261029-014652.log and manifest/summary.18 offline transport tests pass,history
  guarded by env;ESLint/diff pass. See plan for family breakdown/scope exclusions.

- Oct29 urgent comparison completed: slmQuickComparison.test.ts ran16 synthetic
  cases x2 candidate orders x2 real providers,64 calls in63.6s. Expectations
  frozen before inference; same semantic inputs, short label SLM prompt,no tuning.
  Jev31/32,SLM30/32,zero transport/format/defined non-operation-to-operation
  errors. Both unstable on isolated 對; SLM also INFO/CLARIFY on audio query.
  Not a quality ranking,holdout,32 independent cases or full-flow acceptance.
  Preregistered candidate rule (>=Jev,>=29/32,no unsafe,no instability) not met.
  Retain Jev for urgent field repair;SLM remains viable alternative. Withdraw20s
  as primary rejection rationale: short-prompt SLM median1.615s, Jev0.218s under
  different hardware,not model speed ranking. No evidence switching alone fixes
  UI/recovery. No more hours of tests or repeated user instructions this round.
  Private raw/source manifest /tmp/webnavior-slm-quick-20261029-013907.log*.
  Live collection passed;quality rule not passed.18 offline transport tests pass,
  quick skipped by default;ESLint/diff check pass. No activation/commit/deploy.

- Oct28 SLM evaluation implementation STARTED with user approval. Plan/results:
  docs/plans/2026-10-28-kiosk-slm-evaluation.md. No admin/production provider
  wiring, activation, DB settings change, commit or deployment. Existing 4B is
  loaded via authorized test calls; no download/configure/restart.
  New test-only slmDecision transport supports strict JSON and one-token labels,
  rejects invalid/thought/tool output, never fakes Jev confidence.18 unit cases
  pass. Opt-in slmCapabilityReplay saves private raw requests/responses and hashes;
  actual71-request controls show partial prefix reuse1901 tokens (13.7s->3.0s),
  cache0 on short repeats/changed early state. Shortened instructions caused
  GREET/ADD->SEARCH;71 repeated controls35match is NOT independent accuracy.
  Aligned lookski-template9 controls6match; no gold changed, both failures kept.
  Thinking on/off and enum conflict live probes2 pass (3HTTP), no CUDA error.
  DMR1.1.14/client1.2.6, llama.cpp fingerprint b1-3191462, existing4B digest
  d5b494629720…, Q4_K Medium per load logs, CPU_Mapped/CPU_REPACK buffers;
  GPU acceleration not verified. Do not compare hardware timing as model merit.
  KIOSK_SLM_SHADOW=1 captures24 Jev inputs and evaluates AFTER original scenarios
  to avoid changing deadlines. Actual24/24 valid,22 agree (not gold accuracy),
  root median20.03s/followups1.62s. Top20 covers all candidate labels22/24; two
  omit2 of20. Missing probabilities cannot be zero-filled or used as confidence.
  Raw log/manifest/summary /tmp/webnavior-slm-shadow-20261028-083255.log*;
  cap evidence /tmp/webnavior-slm-replay-{CXKwOR,X7GYcV}, live-extra log.
  Original Jev/Main pilot still5/6 with D09 unresolved; no SLM-path acceptance.
  Corpus26 semantic+44 experimental+20 chains overlaps unknown; historical3
  partial/3missing. Manifest/gold/calibration/holdout still pending; not training.
  Fairness audit: NO winner/accuracy conclusion. Both shadow disagreements are
  D03 explicit-but-unclear help: Jev INCOMPLETE/BACKGROUND vs SLM
  NEEDS_ASSISTANT/UNCERTAIN; SLM may better fit clarification, not two errors.
  Jev-selected checkpoints and Jev-developed contracts are drop-in diagnostics,
  not neutral system comparison; hardware/quant/template also differ.
  Next quality gate: source/family manifest and independently reviewed gold,
  equal tuning budget, untouched holdout, fixed-checkpoint paired comparison
  followed by each provider's own full path. Alternative SLM decomposition is
  a separate system experiment. Cache/performance work remains separate.
  Preserve current Jev behavior and all logs; no production/admin activation.

- Oct28 integrated conversation repair is implemented locally, NOT committed or
  deployed. Plan/status: docs/plans/2026-10-28-kiosk-conversation-repair.md.
  Server-only respond_to_customer tool -> shared typed reply -> Host current-fact
  rendering; malformed prose gets one no-commerce repair, then neutral clarification.
  Service admission now requires richer meaning review before Main handoff.
  Retry uses original text/lineage through normal queue/decision flow with fresh
  session/iframe/domain revisions; display/recommendation/write attempts cannot
  transparently replay. Ordinary uncertainty is not a technical error prompt.
  New enrollment overrides observation/greeting/reminder/voiceDiagnostics=true,
  triggerMode=mixed, delegates these five fields locally; old records unchanged.
  Scoped Server517, Host256 and Chrome5 passed; later two JSON/SSE repair tests
  also passed. Menu757 baseline passed; Kiosk/Menu builds pass. See plan for final
  type/lint status and exact limited browser coverage.
  Actual configured Main-only information cases2 pass. Combined-model pilot1
  2/6 pass exposed quantity-total, incomplete-meaning and missing-query issues;
  fixes now have local regressions but full-model acceptance remains OPEN.
  User repaired active Jev/CUDA; actual inference now works. Restored pilot
  20261028-050538:3/6; two failures were harness missing synonym 查不到 (fixed
  assertion without changing outcome/gold), one real request-for-help IGNORE.
  Clarified existing admission/speech instructions: explicit help with unclear
  purpose is service, not background. Pilot20261028-050654:5/6,61 outbound HTTP
  including health, no provider/CUDA failures. D01/D03/D05/D06/D11 pass; D09 retry
  of intentionally unfinished inquiry returns INCOMPLETE, expected clarification.
  Keep this as unresolved behavior/expectation discrepancy; do not lower gates,
  force all incomplete speech to Main, or change frozen gold to claim acceptance.
  Full20x3/reserved, complete Browser matrix, audio/two-device checks pending;
  no new queue implemented, no commit/API/Bridge/frontend deployment.
  Logs/manifests /tmp/webnavior-conversation-repair-pilot-20261028-050{538,654}.*.
  Actual Main-only information cases2 also pass. Historical originals stay local.
  Earlier CUDA fault is historical and not proven cause of morning complaints;
  local AMD openjev restart was unrelated to actual external endpoint recovery.

- Oct28 two-device conversation complaint investigated READ-ONLY, no runtime fix,
  commit or deployment this turn. New trace sha ac3fcb5a… and actual365 entries
  across3sessions/2devices (09:39–09:45 Taipei). See Oct28 continuation in
  docs/research/2026-10-26-kiosk-conversation-error-audit.md.13Main tasks,6 presentation
  unverified-reply rejections, all6 zero tools; all sessions active/noProgress0.
  This is not touch_preferred escalation or the old modelRounds0 transport chain.
  Main outputs natural prose while currentContextInstructions requires4 JSON
  selectors; independent-conversation prompt also permits plain clarification.
  Host only fetches replyContext for JSON-looking answers. Invalid format has no
  bounded repair and becomes generic "use screen" error. Do NOT allow all raw
  prose: captured draft also falsely claims card support. Valid selectors can
  still be irrelevant (audio-test utterance -> fulfillment modes); menu_recommend
  clarify repeated price/category question on fruit and possible payment speech.
  Recovery promotes weak Jev to service without resolving meaning. Original audio/
  TTS echo and actual two-client loaded bundle IDs remain unverified. API/DB/Redis
  healthy; server HTML matches dist. Private captures are /tmp/webnavior-20261028-*
  (0600), do not commit/send original sessions to models. Existing reply tests
  pass but do not cover complete noisy multi-turn pipeline; next work must unify
  output contract/recovery and test relatedness, not lower confidence or remove
  operation/receipt guards.
  Follow-up: retry of same "是 是 帶刀刀" at6pNT8 seq187 issues query水果
  (seq191), NONE receipt193 -> presented207/message208. Main retry stores only
  string and calls sendConversationMessage with no original decisionState or
  utterance correlation, bypassing ASR/Jev recovery; fresh snapshot is read but
  original uncertainty/handoff lost. Do not replay stale state/tickets to fix it;
  preserve request meaning/correlation and revalidate fresh browser ownership.

- Oct27 security repair is DEPLOYED and committed in Oct28 batches on no_mcp:
  1a046a8 Node runtime, 283a298 security dependencies/tests, 6af4536 POS
  device authentication/cart validation; audit/handoff documentation follows.
  Details/remaining work: `docs/research/2026-10-27-security-audit.md`.
  User explicitly requested restoring original test sign-in and six-digit
  development enrollment on Oct27. Extra public-origin identity restrictions
  are withdrawn; original flags/NODE_ENV rules apply. POS auth/validation and
  security package upgrades stay. Do not disable these test flows again without
  a new request. Chrome verified test status enabled:true, invalid test-login
  and numeric-enrollment bodies400, POS writes401, catalog7. Read-only identity
  avoids bootstrap auto-replacement while validating payment devices. Scoped
  restore tests31 plus3 route cases and Bridge44, types/lint pass. Checkpoint
  path is recorded in `/tmp/webnavior-current-development-restoration-path`.
  Unauthenticated POS writes still401.
  Existing23 device credentials retained. Node24.22.1 installed with official
  SHA256 check (not GPG); API/Bridge actual processes must both use it. Hono4.13.14,
  adapter1.19.17, Better Auth family1.6.33, Vitest4.1.12; runtime ws/Zod/nanoid and
  scoped protobuf/gRPC patches locked. Menu now uses `/api/kiosk/pos` BFF;
  private fetches include existing HttpOnly device cookie. Bridge verifies with
  owning API read-only `/api/kiosk/identity`, isolates Site/device resources and payment
  reuse; cart totals/options server-checked, uncertain writes never retried.
  Simulator ownership/idempotency remain in memory: no live payment approval.
  Six-digit enrollment is restored; a future controlled enrollment is not
  part of the user-approved change now.
  Root env remains development/flags true: sudo requires a password; the
  original test flows are intentionally enabled by user choice. Do not clear all device
  credentials/sessions or claim no compromise; review existing-session evidence.
  Supervisor restarts used own launchers after systemctl timed out, checking
  on-failure/control-group/ownership and no recent customer entries first.
  Rollback `/tmp/webnavior-security-repair-20261027-f7gtcwga`: private env/config,
  verified pg_dump, sources/patch, web/menu/kiosk before assets, release.json.
  Scoped types5 apps, affected lint/builds pass; Menu757/Kiosk249, Chrome61,
  Bridge44, auth/body-limit39 and Kiosk routes61 tests pass. Public66 JS/CSS
  hashes match. No production payment write, session mint or device enrollment.
  Oct28 commit gate: full-project typecheck passed once; Server31, Bridge44,
  Menu757 tests and affected-file lint pass. Root lint has existing errors;
  its one task-file YAML key-order error was fixed and scoped lint rechecked.
  All commit hooks run normally. This commit-only pass did not redeploy or restart.
  Remaining (not automatically authorized): controlled enrollment, persistent real-POS ownership/reconciliation,
  device/Site AI quota and concurrency, CI security checks, OTel family upgrades,
  root-owned env/service isolation and other-project firewall coordination.
  Full-workspace prod audit still9 critical/124 high; not deployed exploit counts.

- Oct26/27 conversation reliability repair is DEPLOYED Oct27 for FIELD TESTING,
  originally from a source snapshot, then committed Oct27 at the user's request:
  364f162 Menu controls, 5989a5e recovery/verified replies, 4d03c4a whole-utterance
  ASR, baf9f83 browser test setup, plus this audit/handoff documentation batch.
  Evidence, integrated plan and exact validation/limits are in
  `docs/research/2026-10-26-kiosk-conversation-error-audit.md`. Missing Menu tools
  no longer hand off to Main; context failures have their own reason. Same-document
  recovery inspects original operation IDs and waits for settled calls, never
  replays writes/reloads carts, and releases only the host's acknowledged/issued
  task owner. Pending/missing/failed results or replacement documents stay blocked.
  Structured information/clarification replies render fresh facts; operation and
  display receipts remain required. Offered payment labels are separate from
  phase-specific execution permission. Final VAD audio uploads use <=20s chunks,
  preserve sample ranges/one utterance UUID and reassemble fully before decisions;
  failed/empty/cancelled/expired chunks never execute partial speech.1MiB remains,
  ASR413 is explicit; Oct27 separates15s ASR inactivity (renewed only after a
  successful chunk) from15s ready-transcript queue freshness; published9999s VAD
  remains. Regression reproduced3x6s chunks expiring before the fix; whole18s
  success, stalled/empty later chunk, reset and stale queue protections now pass.
  Empty cart now exposes real fulfillment controls. Empty history pages stop.
  Initial62s field hang remains unproven. Menu757/Kiosk249/relatedServer506 unit
  tests pass; scoped types5 packages, lint
  and Menu/Kiosk builds pass. Oct27 Chrome18 transport +13 CheckoutActions/Focus/
  FieldState pass, including never-settling presentation and lost refusal receipt.
  Previous browser startup stall was root/Kiosk Vitest peer-instance mixing;
  use `pnpm -F @proj-airi/stage-kiosk exec vitest`, not root runner with app config.
  OpenCC prebundle resolves through owning stage-ui package. POS response-loss/
  checkout-domain16 pass. Two synthetic
  configured-model explanation cases pass with read-only live config/scratch cart;
  no original customer log or production POS write. Oct27 configured ASR accepts
  synthetic60s quiet-boundary and46s crossing-boundary recordings (three chunks,
  two-to-three correction, bento and no-checkout facts preserved, one complete
  queue delivery). New opt-in `tests/experiments/kioskAudioReplay.test.ts` uses a
  supplied canonical synthetic WAV and read-only audio config; credentials stay
  in env. No physical microphone/payment acceptance or Main semantic proof.
  Private logs `/tmp/webnavior-reliability-*` and configured-explanation log are
  outside Git. User authorized field deployment Oct27; matching Menu/Kiosk/Server
  are now live. API restarted11:33:56 Taipei via systemctl, PID1530427;
  livez/readyz and DB/Redis pass. Public Chrome verifies all48 HTML/linked assets:
  Menu index-CtKt2yT4.js, Kiosk index-DUYoK-kc.js. Bridge health/catalog7 pass;
  live oversized-ASR probe returns413 KIOSK_AUDIO_TOO_LARGE before auth/provider.
  Fresh unauthenticated Kiosk loads device setup; no test device/order created.
  Old frontends, verified PostgreSQL dump, changed/base sources, patch, build
  logs and release.json (deployed-verified) are at
  `/tmp/webnavior-reliability-release-20261027-e363hd7n`. Baseline HEAD eac50945;
  source hashes identify the deployed snapshot; committed non-doc sources match
  it. No dependency/schema/Nginx/management/Bridge changes or manual db:push.
  Oct27 precommit root typecheck passed once; root lint has the same2370 existing
  errors, while changed-file checks and all commit hooks pass. Retained old
  hashed assets; reload existing Kiosk after ending any unfinished transaction
  before starting field acceptance. Physical microphone/payment and original
  initial62s cause remain unproven.

- Oct22 user explicitly requested plain-language batch commits and deployment for
  FIELD TESTING. Code/test commits on no_mcp: 6666541 Menu/browse/cart/fulfillment,
  1eaf6a4 Server decisions/receipts, 2ab99ec Kiosk verified replies, 5795db6 historical
  fixtures/evaluator/configured-model tests and docs. Those Oct21/22 local changes
  below are now committed and DEPLOYED through 5795db6; old not-deployed labels
  describe their implementation-time state. Public origin:
  https://webnavior.aikcitri.qzz.io. API restarted Oct22 16:30:18 Taipei,
  PID4107684; local livez/readyz confirm DB/Redis ok. Menu index-CC4ZOIK-.js and
  Kiosk index-CLs9SjEN.js plus all 2/44 HTML-linked resources match staged SHA256.
  Public /menu-api/health and catalog7 pass. Bridge process, management frontend
  and Nginx unchanged. Backup/verified DB dump/staged artifacts/release.json:
  /tmp/webnavior-field-release-20261022-e7vo7dwm (deployed-verified).
  Deployment reused installed dependencies (no lock/dependency changes), rebuilt
  schema package/Menu/Kiosk, no manual db:push or schema change. Standard sudo
  restart required a password and direct systemctl timed out; verified owned pnpm
  launcher was terminated, and existing systemd on-failure/control-group policy
  restarted/cleaned up the service. No service policy or privilege changes.
  Precommit checks: Menu757/Kiosk233/Server482 tests, focused Chrome2, one root
  typecheck, changed-file lint and builds pass. Root lint has the same2370 existing
  baseline errors, not fixed. Known mixed add+inquiry live-pilot failure remains;
  this release supports field testing, not full model/ASR/physical POS acceptance.
  Reload existing Kiosk pages. Historical sources remain partial3/missing3;
  committed source projections are sanitized, private capture/log/DB dump are not
  committed. A follow-up documentation commit records this deployment.

- User authorized configured Jev + LLM. First live smoke run on Oct22 used
  Jev lookski Qwen/Qwen3.5-4B (runtime health confirmed) and configured Main alias
  webnavior/chat -> qwen36 (actual upstream checkpoint not independently verified).
  Existing Server `tests/experiments/kioskProviderReplay.test.ts` now has eight
  synthetic cases and current per-round task/context/tool/reply wiring. Specified
  state checks: 7 pass, 1 FAIL; not Jev semantic accuracy or DOM acceptance.
  Mixed add+price inquiry was classified INQUIRY, handed off UNCERTAIN_FILTER
  read-only with unresolved price; Main's seven menu_get calls were rejected,
  five rounds exhausted, cart empty. Do not loosen guards or increase rounds as
  a substitute for preserving both demands. Multi-add succeeded through app guard
  and Main despite Jev SINGLE; bare 對 also selected index0 but was app-blocked.
  Main's multi-add final reply names only the last dish, so reply completeness is
  not proven. No failure retry or product prompt change. Live DB read-only enforced;
  scratch visitor/health DB and POS simulator, real configured model requests.
  Run 20261022-081236 log: /tmp/webnavior-configured-multidemand-20261022-081236.log.
  Full findings/limits in the multi-demand plan's live-pilot section. No pre-run
  frozen manifest, so not formal baseline; 48x3 and fixed12 Main still pending.

- Multi-demand evaluation first historical batch IMPLEMENTED locally, no commit
  or deployment. Plan/results: `docs/plans/2026-10-22-kiosk-multi-demand-evaluation.md`.
  Order Menu `src/evaluation` owns sanitized source projections/provenance,
  per-demand fact evaluator and offline runtime controls. R03/R04/R05 are partial
  original excerpts verified from two local captures, with source/row hashes and
  original dialogue/ASR/questions/receipts; R01/R02/R06 originals remain missing,
  explicitly unscored. R03 includes the actual customer correction to TWO total:
  truthful reporting of recorded THREE is not fulfilling that correction.
  Test-only evaluator detects omissions/duplicates/options/prose-only completion,
  missing presentation and unrelated cart writes when before-state is supplied.
  Reply tests belong to Kiosk (`historicalReplies.test.ts`); importing them into
  Menu pulled Kiosk recording/model types and was corrected at the test boundary,
  without tsconfig changes. Both apps now have `test:history`: Menu54/Kiosk5 pass,
  one known recommendation diagnosis skipped. Full Menu757/Kiosk233 pass with
  existing optional skips; both scoped types and changed-file lint pass. No new
  live inference, POS writes, DOM acceptance, root typecheck or product changes.
  The 48 synthetic cases' full model runner, baseline144 turns, fixed12 Main
  sessions and optional structure probe are still planned, not executed. Prior
  Oct7 five-question extraction failed0/26; do not revive it or equate safe Main
  handoff with semantic understanding. Keep historical contradictions, repaired
  controls and actual live model outcomes separate.

- Oct22 collective-choice fix is local, NOT committed/deployed. Separately named
  ADD subjects hand off whole requests rather than becoming one-target choices;
  shared aliases/category ambiguity still clarify. Shared negative assent guard
  prevents high-confidence provider indices from interpreting bare 對/是的/好 as
  a target. Server uses existing recipient admission then CLARIFICATION; Menu
  rejects bypassed execution while retaining the pending demand. Question copy
  explicitly asks for one name/position; 第N項 now resolves alongside 個/筆.
  Historical collective diagnostic is now a default regression. Before-fix nine
  focused assertions failed; Menu748/Kiosk231/decision422 and Chrome7 now pass.
  Menu/Server scoped types and changed-file lint pass. The effect PoC c09 current
  fixture now expects domain handoff before inference; frozen semantic gold and
  experiment results are untouched. This prevents a partial add, not proof Main
  completes every multi-dish demand. Remaining six historical families are not
  addressed. See the Oct22 investigation's follow-up section.

- Historical regression audit now covers Aug31 initial Menu/Kiosk baseline through
  Oct22: 17 dated groups in the existing Oct22 field investigation, not an audit
  of every historical production session. Added two cross-flow tests for food
  exclusions/price/catalog/reset and old-clear-confirmation isolation from a new
  same-dish cart. Menu737/Kiosk231/decision422/proactive24 pass; Chrome23 pass,
  two completion-simulator tests skipped. Nine opt-in diagnostic assertions still
  fail across seven families: collective multi-meal yes, mistaken fresh-vs-more,
  off-topic admission (two), typo/fragment candidates (two), low-filter query,
  weak-route new request and fulfillment. Conservative Main handoff and fragment
  guards are not automatically bugs; original FAST expectations need contract
  review. The first three families need priority. Two stale provider stubs now
  supply explicitly synthetic recipient/admission answers so failures reach the
  intended boundary; recorded route/relation and expected results are unchanged.
  Final diagnostics: /tmp/historical-{menu,server}-diagnosis-final.log. No product
  code, live model, POS write, deployment or commit in this audit. Cross-origin,
  management login/SW and full Scene ASR failure acceptance remain separate gaps.

- Oct22 field fixes are implemented locally, NOT committed/deployed. Source:
  `docs/plans/2026-10-22-kiosk-field-investigation.md` (investigation, plan and
  implementation validation). Its historical-regression matrix maps Oct21/22
  reports to existing tests and live-acceptance gaps, with scoped replay commands.
  Menu fieldRegression also tests browse-first/fulfillment-first sequences around
  real 1+2 merged quantities and a later add, guarding cross-flow state leakage.
  Decision payment IDs accept current linepay/jkopay;
  Menu/POS still validates execution. Unknown no-tool operation prose is rejected;
  known effects require same-turn matching receipts. JSON/SSE model text is draft
  service_event; Kiosk stores the validated assistant reply once. Service FAQs and
  bare greetings remain usable. Catalog inclusion no longer removes legal tools.
  Fulfillment uses exact visible controls; missing target fails before cart writes.
  An unpaid-checkout mode change issues one-use confirmation, then cancels checkout
  before applying the mode; pending/uncertain payment remains locked. Whole menu is
  `menu_get({scope:'catalog',display:true})`, includes seen dishes and updates actual
  grid; other recommendations release precise subject scope. Named display:false
  reads do not replace the grid. Context carries rendered item IDs/query scope,
  and Menu awaits async Vue presentation callbacks. Standalone acknowledgements
  no longer become greetings/recommendations; invoice question omits internal rules.
  Menu733/Kiosk231/Server482 tests and scoped types/lint pass; domain422 rechecked
  after final semantic edit. Chrome21 and Menu/Kiosk builds pass. Optional live
  tests skipped. No root typecheck, real-model replay, service restart or deployment.
  Prior local Oct21 Menu dialog/viewport changes below are preserved. Historical
  field evidence (25 sessions/1122 entries) is in 0600
  `/tmp/webnavior-20261022-{api.log,entries.json,decisions.json}`. Live field/model
  acceptance remains necessary; public site still runs the older deployed build.

- Oct21 post-add Menu behavior is implemented locally, NOT committed/deployed.
  User chose 「關閉選單並保留目前菜單」. Selection no longer rewrites the
  recommendation grid/category; closing restores the pre-selection viewport.
  Successful add resumes an older unadded meal's question without reopening its
  dialog. Test-only reproduction failed before the fix; Menu728 tests, scoped
  types/lint/build pass. Isolated Chrome + local simulator verified dialog count0,
  category便當, scrollY300 unchanged and one added便當. No live order/payment writes.
  Root typecheck not run. README documents the new behavior.
  Recent live session WpW9YM6aK7lDFgT-V1m3e exposes separate UNFIXED issues:
  actual order_add_item x1 then x2 (seq22/28) merged to3; later Main claims
  2/4/5/7 quantities, phone320 recorded, and displayed menu/price results without
  matching tools. Only cart writes in the bounded session through seq330 are
  those two adds. Route/serviceRequest/recovery can promote weak/background or
  incomplete speech into UNCERTAIN_OPERATION Main; no-tool Main prose is accepted
  as assistant_text and can pollute later history. Examples at15:18–15:22:
  電話號碼是320; 再用電池; 一 二 三 四 五 六 七. Some recovery rounds correctly
  ignore background; do not claim every admission has the same failure path.
  Audit artifacts (0600): /tmp/webnavior-quantity-session-audit.json and
  /tmp/webnavior-latest-parsed-decision-log.json. No new live model replay,
  semantic thresholds/prompts, history or production services were changed.

- Oct21 Kiosk OpenCC through 29962bf is DEPLOYED and verified. Public Kiosk
  index-BR-bjDae.js and all 44 HTML-linked assets match staged SHA-256 hashes.
  Clean Chrome stays at /kiosk/#/ without page errors; the deployed converter
  maps 请确认这份订单。 to 請確認這份訂單。. Backup and release.json:
  `/tmp/webnavior-opencc-release-20261021-561pnnz2` (deployed-verified).
  Frontend-only release; API PID 2642311 and its start time, Menu, management
  build and Nginx unchanged. API/DB/Redis/bridge and 7 catalog items pass.
  Reuses stage-ui's Taiwan Traditional converter for conversation/streaming
  text, errors, visible ASR, welcome/progress and diagnostic transcript headings;
  speech synthesis also receives converted text. Display copies preserve original
  model history, ASR, simulation input, tool payloads and raw diagnostic traces.
  Kiosk 228 unit tests, 7 focused Chrome tests, changed-file lint, production
  build and the once-run root typecheck pass. Root lint reports 2370 errors in
  unchanged baseline files; no unrelated cleanup. Browser tests prebundle OpenCC
  to avoid mid-run optimizer reloads. Changes are grouped into display, speech
  and documentation commits on no_mcp; no remote push. Reload existing Kiosk
  tabs to load the OpenCC frontend.
  This does not fix background admission or unverified model success claims.

- Oct21 `no_mcp` through efcce39 is DEPLOYED and verified at
  `https://webnavior.aikcitri.qzz.io`; the implementation-time "not deployed"
  notes below are superseded. API restarted at 13:37:43 Taipei, PID 2642311;
  livez/readyz report DB/Redis ok. Public Menu index-By0DmB8Z.js and Kiosk
  index-BSfgpFRX.js plus all HTML-linked assets match staged SHA-256 hashes.
  Bridge and 7 catalog items pass; Nginx, Origin-Trial and management build
  unchanged. Backup: `/tmp/webnavior-no-mcp-release-20261021-0rrftbgb` holds old
  static trees, staged builds, verified DB dump and deployed-verified release.json;
  its previousRelease records the Oct20 master release. Frozen install, builds,
  Menu/Kiosk/stage-ui scoped types, Menu725/Kiosk227/Server497 unit tests and
  Kiosk54/cross-origin15 Chrome tests pass. No root typecheck or live model,
  camera/microphone, real POS/payment acceptance in this deployment.
  Root HTTP redirects to /kiosk/; clean Chrome stays at /kiosk/#/ without errors
  or a controlling SW. User reports intermittent admin routing only in normal
  browsing, not incognito. Existing SW/cache is suspected, not proven; current
  management SW excludes root/Kiosk/Menu navigation. Suggested unregistering
  only this origin's SW, closing its tabs and reopening, preserving local device
  storage. No routing/configuration changes were made for this report.

- Oct21 service recovery is implemented and committed locally; source of truth:
  docs/plans/2026-10-21-kiosk-service-recovery.md. Valid Jev service uncertainty
  permits one fixed Main verdict, then one richer no-commerce review only for
  a valid UNCERTAIN. Invalid/provider failures cannot trigger semantic retries.
  Admitted requests hand off with the original utterance; no invented Fast Path
  action/confidence or restarting Jev. Existing finite phone resolution runs first.
  Recovery caps are 8s/12s, with a combined 20s including progress checkpoint
  waits, within the same 60s model turn. Checkpoints expire within 15s and are
  owner-bound/one-use; cancellation settles even an uncooperative provider.
  Separate typed Main progress/counters; text immediately shows receipt/time
  and a terminal state; unadmitted voice stays silent. A clarification cue is
  versioned/expiring and read-only, never an order/payment confirmation ticket.
  Metrics record stage times/request bytes/provider tokens without prompt bodies.
  The old clarificationDiagnosis failure was an incomplete serviceRequest mock;
  tests now supply every question explicitly and retain the complete two-item
  request, with valid uncertainty and invalid-response cases kept separate.
  Unit/integration: Server477/Kiosk227/Menu725 passed (optional tests skipped);
  final combined-deadline/HTTP subset25 passed. Live provider replay, target
  device/POS/payment and comparative p50/p95 remain unrun. No deployment.
  Browser: Kiosk15, cross-origin15 and ScenarioSurface1 passed separately.
  Commit gate root typecheck found Menu's virtual validator declaration missing
  in the stage-ui consumer. The owning production entry now references its d.ts;
  stage-ui scoped typecheck passes after the fix (no second root run).
  Changed TS/Vue/JSON lint passes; root lint still fails in untouched baseline
  chats/audio/provider/research/PoC files. Do not describe root lint as green.

- Oct21 Main-context integration is implemented and committed locally (not deployed).
  Source of truth: docs/plans/2026-10-21-kiosk-main-context-and-ordering.md.
  Neutral stage-shared/kiosk-conversation contract; host-only Menu snapshot with
  complete compact catalog after phone entry, fresh cart/checkout/questions/tools.
  Kiosk refreshes every model round and validates task ownership; refreshConversationState
  explicitly maps neutral ingredient/price constraints to HTTP task fields and retires
  old questions/focus. Server sends one current projection, compacts repeated menu
  receipts, intersects tools and rejects inconsistent context phase/read-only/revision.
  Runtime guards known handoff effects/line IDs and snapshot revisions; only own accepted
  writes advance a same-batch version. Unknown/fragment products cannot grant writes.
  Shared aliases; separate possibleItems; menu_confirm_item owns explicit add/replace
  consent, original constraints/replaceLineId/quantity and question validation. Fragments
  bypass old name-only Fast Path confirmation and go through Main's explicit proposal.
  Exact repeated named removal returns already-absent instead of reviving old 排骨飯.
  Removal reveals/animates the actual line control, checks revision, removes once and
  returns to menu; Main combo defers return until END. Missing control preserves cart;
  return failure retains accepted receipt, including END failure without repeated delete.
  Server main_round_metrics records real payload/section bytes, duration, SSE first
  output and provider inputTokens only if supplied; Kiosk main_task_metrics records
  orchestration time/rounds/tool count. No prompt bodies logged or extra LLM calls.
  No Jev order/threshold changes or Stage Web edits. No new external model replay
  authorization: live semantic/device/POS/payment and comparative p50/p95 remain unrun.
  The later recovery work fixes the incomplete clarificationDiagnosis mock;
  Menu now has no failure in the relevant complete suite. Real DOM removal and
  cross-origin transport checks are also covered. See both plans for validation
  and remaining live-model/device/performance acceptance.

- Oct21 attachment a553fda2: 大腸臭臭鍋一份 has no product/category match;
  recorded scores correctly recover weak INCOMPLETE through serviceRequest to
  Main UNCERTAIN_OPERATION. Same-text local session UGmY-FToOvrROt9GPBGMA
  records Main customer_skip_phone rejected INVALID_PHASE, then a requested
  menu_get without receipt. Recording loop intentionally stops on the rejected
  batch after obtaining the continuation, so the later lookup is never executed.
  General Main now never receives host-owned customer_skip_phone, including
  phase-less continuations; finite phone resolver/Fast Path still owns skipping.
  Tests cover tool exclusion, rejected-loop behavior, exact-score handoff plus
  actual unknown-name lookup/customer reply/empty cart. No live model replay;
  attachment alone has no session correlation key, so same-text DB evidence is
  not proof that every matching UI failure has the same cause.

- Oct21 attachment b0b98800: local recording confirms 鱔魚意麵3份，不要蔥花，
  一份大辣兩份小辣 incorrectly executed order_add_item beef-noodle-soup x3
  (450). The defect is unauthorized product substitution, not missing options
  on the wrong dish. No eel product matched; sole 麵食 member was
  treated as identity. Server now hands sole-category/no-product ADD to Main,
  retaining original wording; browser resolveIntent independently blocks that
  automatic target for ADD/SELECT. Multi-target category clarification remains
  available. Multiple values in one option group cannot collapse into one
  cart-line option; Main resolves splits/corrections. Existing category-one
  auto-purchase expectations changed to handoff, with named-item positive tests
  retained; requirement PoC n13 capability expectation updated, semantic gold
  unchanged. Recorded high scores and actual runtime verify zero added lines.
  Generalized at Main's task boundary: exact current products bound eligible
  selection/configuration/add IDs; category-only/possible/overflow evidence
  cannot grant a product choice, regardless of category size or successful
  alternative/full-menu lookup. Task BEGIN replaces bounds; menu revision/expiry
  invalidate them. No-lexical-evidence contextual replies retain existing flow;
  this does not claim full semantic identity/consent validation. resolveIntent
  now uses derived item constraints rather than reusing old transcript names
  that could bypass the sole-category guard. No new Jev questions or thresholds.
  Source only; no existing live cart was edited, no external model replay.

- Oct21 attachment c1d194f6: previous 「那我要排骨便當」 produced duplicate
  quantity prompts before a correctly handled 一份. Menu beginMeal returns the
  same question as customerMessage and pendingCustomerChoice; Scene’s local
  customerMessageFrom concatenated both before replyWithQuestion. Receipt
  presentation now lives in questionPresentation.replyFromReceipt, used by Scene:
  compose the explicit outcome with the validated question once; no raw pending
  fallback. Cart summary behavior remains. Actual runtime regression red -> green
  and shared composition tests cover identical/already-contained/absent outcomes.
  No intent/threshold changes, provider replay or deployment.

- Oct21 handoff audit: added short-answer cases 一份/不要辣 alongside 內用/一位
  and topic-change-to-store/menu checks. Reliable concrete answers recover weak
  routes without granting checkout consent or executing guessed actions.
  Confirmed store FAQ gap: a strong generic NEEDS_ASSISTANT with no reason/no
  food matches inherited requireMenuRead. API now uses bounded Main
  resolve_service_scope only for unclassified, non-phone, unmatched handoffs;
  SERVICE_INFO -> GENERAL_QUESTION; food/order/mixed/unknown/error retain
  the original guard. General service tasks are read-only. Trace serviceResolution
  is separate from Jev counters. API53/Kiosk209 and relevant Server domain
  tests/scoped types pass. No phrase list, live provider replay or deployment.

- Oct21 attachment e2821679: typed 略過 -> service REQUEST0.7406, phone
  SKIP0.5227, serviceRequest BACKGROUND0.3255 ended silent before the existing
  Main phone resolver. API now also permits bounded phone validation for
  customer_entry UNAVAILABLE/UNCERTAIN_SERVICE_REQUEST with an issued skip
  candidate. Only SKIP_PHONE rejoins Fast Path; all other/invalid/failed answers
  preserve the original silent result. This never admits open conversation or
  menu tools. Confirmed background/uncertain recipient still do not invoke Main.
  Exact-score segmented/nonsegmented tests cover skip/keep/uncertain, retaining
  the3 Jev counts and separate phoneResolution evidence. No live provider replay.

- Oct21 user clarified the phone gate: filling a valid phone OR explicit skip is
  required before ALL menu reads/recommendations/ordering/checkout. This
  supersedes phone-stage factual browsing. MENU and ORDER both return
  CUSTOMER_ENTRY_REQUIRED; Main at customer_entry receives only optional session
  history, no commerce tools. Menu runtime rejects reads/writes from Agent and
  manual callers; host phone controls and customer-entry questions remain. Host
  checks live phase before presenting old receipts; reset restores the gate.
  Store facts/identity/phone explanations remain available. Removed the obsolete
  once-only post-query phone reminder. Entry tests7, Server domain378/API45,
  Kiosk206 and scoped types pass. Full Menu run has684 passes and one existing
  clarificationDiagnosis expectation mismatch: UNCERTAIN_SERVICE_REQUEST vs
  UNCERTAIN_OPERATION (phase clarification, unrelated to entry gate); untouched.
  No live model replay or deployment.
  Earlier no-reply wording remains customer-facing. Internal dataOnly reads still
  do not finish a read-only presentation after entry.

- Oct21 user-provided 周氏蝦捲 service facts are saved/published in the local
  test Site profile revision52 through the existing draft/release service.
  agentInstructions:11:00–14:00, cashless payment, electronic invoice; order at
  Kiosk/online/table QR; self-pickup or robot delivery to table. No assumed
  operating days/payment brands/URLs/delivery guarantees. Other profile fields
  unchanged; prior release51 remains immutable. Sessions pin their original
  release, so new sessions use the new facts. No global store default changed.
  Jev service scope/GENERAL_QUESTION now includes store-service information,
  including weak-route relevance recovery; Main uses supplied site facts and
  distinguishes explanations from live operations. No live-model replay.

- Oct21 ordering is restored to intent-first per user accuracy preference.
  The standalone recipientAdmission.ts and its obsolete order tests were removed;
  authenticated decisions call index.ts directly. Existing per-intent recipient,
  relation/price/food checks remain. Kiosk shows progress only on confident
  service intent plus recipient checkpoints (or serviceRequest REQUEST), never
  recipient/route confidence or ASR completion alone; customer text is appended
  only on accepted final paths or real read receipts, preventing silent outcomes
  from leaving unanswered bubbles; microphone indicators/operator diagnostics remain.
  Recorded 「哈哈哈 好啊好啊」 GREET0.7487 -> greeting IGNORE0.5559
  exposed an untagged UNAVAILABLE retry. UNCERTAIN_GREETING stays silent through
  shouldShowDecisionRetry, alongside unknown recipients, IGNORE and INCOMPLETE.
  No phrase whitelist/threshold changes, live replay, commit or deployment.
  Movie traces weak IGNORE0.4215/0.4658 -> recipient KIOSK0.9931/0.9941
  exposed a second issue: recipient-only recovery promoted chatter to Main.
  Final abstention recovery now asks serviceRequest (valid Kiosk service demand
  or answer); BACKGROUND ignores, REQUEST alone admits Main, weak/unknown scope
  stays silent UNCERTAIN_SERVICE_REQUEST. Weak unfinished-speech recovery also
  rejoins this gate: recorded 「你有看過流星嗎」 INCOMPLETE0.2323 -> service
  REQUEST0.9336 -> speech REQUEST0.2382 must not borrow recipient confidence
  to admit Main. Recorded-score tests retain genuine service recovery.
  Uses current references and unexpired
  questions, never operations; intent-first order and thresholds remain.

- Oct20 recorded 「有水餃或牛肉麵嗎？多少錢？」 price INFORMATION0.359
  reproduced UNCERTAIN_FILTER handoff with unresolvedPrice blocking even Main's
  menu reads. Server now uses Main's bounded resolve_price_choice checkpoint
  before binding that task; only issued IDs survive, and the task remains
  read-only. Trace priceResolution is separate from original Jev counters.
  Mocked recorded-score replay and segmented/nonsegmented route tests pass;
  no live provider replay, commit or deployment for this change.

- Oct20 `no_mcp` Kiosk + localhost:5166 Menu migration is implemented locally,
  uncommitted and NOT DEPLOYED. Stage Web/DaMai are explicitly deferred; Stage
  Web's native adapter/health export are unchanged, but updated Menu no longer
  registers native tools. Plan and acceptance scope:
  `docs/plans/2026-10-20-webnavior-without-native-webmcp.md`.
  Eventa window-message uses exact origin/Window, connection/document IDs and
  a challenge; execution caches in-flight receipts per operation ID. Only
  discovery retries. Lost execution receipts revoke admission; no write replay.
  Kiosk keeps the `webmcp` registry namespace for existing toolset prompts.
  Menu runtime/authorization remains in webmcp.ts; static contracts moved to
  toolDefinitions.ts. Ajv8.18 validators compile/bundle at Vite/Vitest load time,
  preserving dynamic POS enums without browser eval. Tool inputs and receipts
  retain native JSON semantics (including Vue readonly inputs); no proxy cloning.
  Menu682/Kiosk195 unit and Kiosk52 browser tests pass; focused cross-origin
  suite15 passes; it covers combined add, multi-tool work, recommendation, task locks, phone,
  source isolation, dedupe, late replies and simulated checkout/payment/completion.
  Run it from root with `VITEST_BROWSER_CHANNEL=chrome pnpm exec vitest run
  --config packages/stage-ui/vitest.interactiveService.config.ts`; run Kiosk
  browser tests with its package-scoped command to share its Vitest runtime.
  Scoped Menu/Kiosk types and builds pass; no root typecheck, live Jev/Main,
  target-device, physical payment/POS acceptance, commit, push or deployment.

- Oct20 commit validation: changes are grouped by ordering, floating console,
  local presence, greeting defaults, assets and documentation. Changed-file
  commit hooks pass. Root lint reports3182 existing errors in files outside this
  change set (including test_prompt and older audio/provider tests). Root
  typecheck was attempted once, then its remaining parallel Vue workers were
  terminated to release resources; it did not complete and is not a pass.
  The earlier affected-package typechecks and targeted tests remain passing.
  No deployment or remote push is part of this commit task.

- Oct20 local camera voice admission is LOCAL, NOT DEPLOYED. With observation
  enabled, voicePresence.ts requires an in-zone candidate with quality>=0.5
  within the existing1500ms loss grace and currently observing camera status.
  First valid sample admits voice; greeting dwell/sample gates are unchanged.
  Unknown/starting/failed camera blocks voice; the user explicitly confirmed
  strict mode in the async preference reply after implementation. Observation
  now runs in standby even with greetings/reminders off. Disabled observation,
  touch and simulated text retain service. KioskScene checks before ASR, after
  ASR, on dequeue, before delayed Fast Path actions/Main handoff and proactive
  playback. Lost presence cancels proactive work only, not an issued commerce
  request or its receipt. Camera/settings resets discard old admission evidence.
  Kiosk195 unit tests, scoped typecheck/lint and production build pass; no real
  camera/microphone acceptance or deployment. README documents the policy.

- Oct20 typed 略過 trace established REQUEST0.7406 / SKIP0.4977, then
  UNCERTAIN_OPERATION -> read-only Main unable to skip. Unrelated to the camera
  gate. Server now resolves admitted weak phone meaning through Main's bounded
  resolve_phone_choice tool (SKIP_PHONE/KEEP_PHONE/UNCERTAIN), independent of the
  weak Jev proposal. Only SKIP_PHONE rejoins the original browser skip candidate;
  no general Main mutation authority or threshold/phrase-list change. Other or
  malformed results keep the read-only handoff. Original Jev counters remain
  separate from trace.phoneResolution choice/duration; no fabricated confidence.
  User explicitly authorized this exact 略過 replay to the existing Jev/Main
  endpoints. Live Jev passes; recorded weak scores + real Main/browser runtime
  skip successfully, and the three previous withdrawal/compound cases pass.
  Targeted Server domain354/routes5 and Kiosk100 tests pass, including segmented
  continuation; Server/Kiosk scoped types and changed-file lint pass. Local
  source only, not deployed. Server README documents the flow.

- Oct20 unified semantic-abstention policy is LOCAL, NOT DEPLOYED. The public
  decideInteraction boundary now hands valid low-confidence semantic outcomes
  to Main after independent recipient admission; it reuses existing admission,
  does not recheck an uncertain recipient, and respects the question budget.
  Malformed replies, confirmed background/unfinished speech and post-execution
  review/receipt recovery retain separate paths. No guessed action, price choice
  or question-answer IDs survive the new handoff. Kiosk no longer forces a menu
  read for UNCERTAIN_OPERATION; protected phases and checkout-entry questions
  remain read-only. Separate unfinished fragments can accompany Main as
  unverified context, never concatenated or treated as confirmed quantities.
  This covers the reported phone REQUEST0.8808 / ORDER0.3861 retraction too.
  Oct20 release checks: full relevant Server400, Kiosk187, Menu684,
  proactive24 and Chrome15 tests pass. An invitation integration fixture needed
  the new independent recipient answer; production logic was unchanged there.
  Server/Kiosk/Menu builds pass; Kiosk needs CHOKIDAR_USEPOLLING=1 on this Mac
  to avoid EMFILE from filesystem watchers. Scoped types and changed-file lint
  pass. Real Jev category replay and Main category replay pass. User explicitly
  authorized both reported dumpling utterances to configured Jev/Main too:
  mainScopeReplay semantic-handoff cases cover phone/order retraction and
  quantity-plus-addition against synthetic carts, then assert the actual host
  reply selection. All4 final Main cases pass (including category). First replay
  caught raw Main falsely saying an empty cart had been edited after cart_get;
  shared instructions now distinguish read receipts from successful mutations.
  Its focused16 tests pass after that change. No physical mic/VAD/noise,
  hardware payment/POS acceptance or deployment performed.

- Oct20 text-mode input/timing/trace now lives in kioskTextConsole.vue, a
  floating console composed by KioskConversation. Header-only VueUse dragging,
  collapse preserving the draft, reset position and viewport clamping; voice-only
  mode still has no text input. Local source only, not deployed. Chrome15 tests
  cover submission, drag bounds, collapse and narrow-screen resize.

- Oct20 shared initial greeting dwell is now300ms in the local source, not
  deployed. Device defaults derive dwell from the shared interaction policy;
  explicit device/local overrides retain precedence. User clarified this was
  global initial configuration, so the unintended DEV-088065 local300ms change
  was restored to its original500ms (settings revision14, audited). Sampling
  cadence, sample-count gate and enabled defaults are unchanged.

- Oct20 compound quantity/addition fix is LOCAL, NOT DEPLOYED.
  Attachment44310a20 / session kXF5nbdV-N5IZSd3okoaI: 水餃改一份好了 然後我要再一碗牛肉麵
  selected ADD0.7289, purpose OPERATION0.8458, coverage SINGLE0.3983 and stopped.
  Reliable route + operation purpose with weak SINGLE coverage now verifies
  the isolated recipient before handing the original utterance to Main as
  UNCERTAIN_OPERATION; no Fast Path action or fulfillment answer is authorized.
  Recorded-value regression and recipient/invalid-evidence contrasts pass;
  Kiosk projection retains order-edit capability. Oct20 real Jev/Main/local
  Menu replay now passes: dumpling quantity2 becomes1 and one beef noodle
  is added, without rejected tools. No deployment; thresholds unchanged.

- Oct20 category inquiry fix is LOCAL, NOT DEPLOYED. Reported
  session pNjTf7VrgOG7-0Gxp7lRZ entries19–26 shows Main called
  menu_get(category:便當,display:true), rejected by the explicit query-action
  contract; Kiosk correctly stopped its attempted retry with tool-rejected.
  Main instructions and menu_get field descriptions now route category display
  to menu_recommend(action:update). Real Main/local Menu replay passes without
  rejection or a retry. Jev also reproduced weak filterRequirement after a
  strong read route; its overlapping category/preference definitions are now
  disjoint, and the original-utterance replay passes. Server focused332 and
  Menu query-actions8 tests pass. Expanded synthetic Jev contrasts remain
  opt-in and were not run: auto-review limited external transmission to the
  supplied replay. No thresholds, rejection policy or order behavior changed.

- Oct20: the accumulated Oct19 ordering changes are now grouped into commits
  for spoken prices, checkout/phone UI, menu-query/voice routing, and docs.
  The older UNCOMMITTED labels below describe deployment-time status only.
  Commit preparation updated stale test calls to the explicit query-action
  contract and supplied the separate filter-presence checkpoint response.
  Menu 684, Kiosk 175, Server 368 unit tests and 20 Chrome UI tests pass;
  env-guarded live-provider tests were not enabled. Full-project typecheck
  and changed-file lint pass. Root lint reports existing errors outside this
  change set, including test_prompt JSON formatting; no unrelated cleanup.

- Oct19 explicit conversational query actions are DEPLOYED, UNCOMMITTED.
  Main must choose continue/update/reset/clarify for Agent menu_recommend calls;
  browser owns queryState, group changes and exclusions. Trusted host more:true
  stays internal. Plain condition updates include shown matches; explicit
  alternatives use excludeShown, continue/reset exclude history. Reset retains
  dietary/ingredient restrictions and cart. Relative words are not product names.
  Exhaustion/clarify return canonical speech without a new presentation/card;
  JSON/SSE completion settles that receipt without another provider call.
  User requested deployment. Backup: /tmp/webnavior-query-actions-release-20261019-w67wqnw1.
  Menu index-D75tOMir.js public index/bundle verified; bridge/catalog7, DB/Redis,
  unchanged Kiosk/Nginx verified. User restarted API at22:19:54 Taipei, PID603743;
  active/livez/readyz, DB/Redis and public bridge verified; release deployed-verified.
  Existing Menu tabs should reload because Agent action is now required.
  See order-menu/server/stage-kiosk READMEs and queryActions.test.ts.
  Local Menu684, Kiosk77 and Server51 tests, all three scoped typechecks,
  changed-file lint and Menu production build pass. No root typecheck.
  User explicitly authorized existing credentials and synthetic conversations
  to the configured Main/Jev endpoints after auto-review initially rejected it.
  Final real-provider suite: all41 pass (22:15:12 Taipei, 110.57s), log
  /tmp/webnavior-main-scope-live.log. First full run reproduced stale other-dishes
  intent leaking into a plain changed-price query via excludeShown:true. Tool
  description and Main instructions now require that request in the CURRENT
  utterance; all41 pass after the fix. No phrase whitelist or threshold change.
  Main qwen36: https://syqvzpveyn.aikcitri.qzz.io/v1;
  Jev: http://projev.aikcitri.qzz.io/v1/systemone.
  Test: apps/stage-kiosk/src/services/mainScopeReplay.test.ts, env guarded;
  isolated synthetic sessions only, no real orders or payments. Scoped lint and
  Menu production build rerun after prompt change; pass. Deployment verified above.

- Oct19 price-handoff context isolation is DEPLOYED, UNCOMMITTED (API only).
  User requested deployment. Backup and API-before state:
  /tmp/webnavior-budget-api-release-20261019-qc279oms.
  User restarted API at21:19:20 Taipei, PID521926. Source hash matches release;
  livez/readyz DB/Redis and public bridge pass. Public Menu/Kiosk and Nginx hashes
  unchanged. Release deployed-verified. No frontend/schema change.
  Visitor KW8V27ebW…: after SHOWN120 returns none, then catalog120 returns dumplings,
  一百三以下呢 reaches price but UPPER_INCLUSIVE confidence0.5368 (0.5181 with 的),
  so UNSUPPORTED_PRICE caused the misleading unsupported-budget response.
  Prior live tests covered a different conversation order. Expanded live cases
  first reproduced both new-order failures. handoffMenu now sends original current
  utterance + literal amounts only to the finite price checkpoint; old budgets,
  scope answers, dish references and unrelated state remain outside that decision.
  No lowered thresholds or phrase whitelist. Live regression also exposed weak
  RANGE vs RANGE_MAX_EXCLUSIVE for explicit102–104 after isolation. Price question
  now explicitly distinguishes inclusive defaults from exclusions stated in the
  current utterance, and explains literal amounts are not separate budgets.
  All6 live Jev/Main/Menu cases pass: both conversation orders, both wordings,
  120–140 and102–104. Correct bounds apply and cart stays empty. Server317 tests,
  scoped Server/Kiosk types and changed-file lint pass.
  This changes the handoff checkpoint only, not finite action/filter checkpoints.
  Above/strictly-above boundaries have unit coverage but were not live-tested.

- Oct19 short budget-follow-up recovery is DEPLOYED, UNCOMMITTED (API only).
  User requested deployment. Source/state backup:
  /tmp/webnavior-budget-api-release-20261019-mv7b6bgi.
  User restarted API at21:09:10 Taipei, PID508956 (previous497185).
  Source hash matches prepared release; livez/readyz DB/Redis and public bridge pass.
  Public Menu/Kiosk index hashes and Nginx unchanged. Release deployed-verified.
  Visitor wu0beMfO… entries26–30: 一百三以下的呢／一百三以下呢 parsed130,
  but Jev chose recommend-more at0.5906/0.5351, then weak OPEN_REQUEST and
  UNAVAILABLE before price. Fixed-value tests reproduce both failures first.
  Existing weak read recovery now includes recommendation routes without an
  owned pending question. Independent strong recipient + pure menu inquiry are
  required; price is qualified before read-only Main handoff. No lower thresholds,
  automatic batch change or mutation; invitation answers retain their own checks.
  Server decision-domain316 tests pass. Live2 real Jev/Main/Menu replays retain
  reported dialogue, replace120 with130, include125/130 items after catalog scope,
  and leave the cart empty. API restart verified above; no frontend change.

- Oct19 meal-confirmation floating card removal is DEPLOYED, UNCOMMITTED.
  Menu index-DHBGGZSD.js and Kiosk index-CJRtGvLN.js published with backups at
  /tmp/webnavior-voice-ui-release-20261019-ata1w7qx. Public hashes, bridge/catalog7,
  unchanged Nginx and Origin-Trial checked. User restarted API at21:00:16 Taipei,
  PID497185; livez/readyz and DB/Redis verified. Release state deployed-verified.
  User chose launch simplicity: remove the extra Yes/No meal card while retaining
  the owned voice question, conversation text, expiry and repeat limits. No direct
  ordering shortcut. Phone, item configuration, idle protection and completion
  windows remain unchanged. Removed the component and click-only browser tests;
  repeated unclear speech no longer instructs customers to use removed buttons.
  meal_confirmation remains a business phase; interactionState reports the actual
  screen. Menu48 focused tests, scoped typecheck, lint and production build pass.
  Menu publication and selective voice recovery API restart are complete.

- Oct19 selective voice recovery is DEPLOYED, UNCOMMITTED. User clarified that
  surrounding speech is not necessarily the customer; do not make every failure
  produce a spoken retry. Broad UNAVAILABLE/error speech, repetition caps, phone,
  invoice/scanner capabilities and checkout timing remain unchanged in this task.
  Main decision-guidance no longer forces clicking. Persisted/wire touch_preferred
  is retained but now pauses unsolicited prompts and serves directed voice requests.
  An unresolved cart-target clarification no longer consumes its cancel candidate
  or tells the customer to use touch: Kiosk keeps the owned question/deadline.
  Server now admits this spoken retry only with strong CLARIFICATION + separately
  qualified KIOSK recipient; OTHER→IGNORE, weak/unknown→UNAVAILABLE. No confidence
  reduction. Target instructions compare full attributes/negation, allowing omitted
  names when uniquely identified. Live 不辣那一份 first failed (weak CLARIFICATION),
  then passed after this general instruction; customer re-question + companion case
  also pass (live3). Unit recipient matrix5 and host unresolved→bound answer test
  verify no premature mutation/cancellation. Server317 + Host76 pass; scoped
  Server/Kiosk types, changed-file lint and Kiosk build checked. Kiosk publication
  and API restart verified above. No new customer controls or real payment/POS effects.

- Oct19 Taiwanese spoken prices are DEPLOYED, UNCOMMITTED.
  Public Menu index-CehhbAJB.js index/bundle hashes verified; Kiosk unchanged.
  Backup: /tmp/webnavior-taiwan-price-release-20261019-ensyulmp.
  API restarted at20:11:12 Taipei, PID448038; livez/readyz and DB/Redis pass.
  Public Menu hashes, unchanged Kiosk and bridge/catalog7 verified; Nginx unchanged.
  Origin-Trial was verified at publication. Price handoff repair is loaded.
  Session tVUWid2B_4UvHrFMVl-x2: 一百二到一百四 had empty amounts because
  pricing.ts deliberately rejected omitted trailing places. Existing amountFrom
  now resolves 百二→120, 千二→1200, 千二百三→1230, 萬二→12000; explicit零
  preserves102/1002/10002. Optional leading一, 兩/两, 萬/万 and NFKC supported.
  Full token spans include unsupported higher units, avoiding partial extraction.
  Approximation, unsupported mixed notation and spoken fractional currency remain
  non-executable; 十二塊五 must not become12, and 元兩份 stays a quantity.
  Real Jev exposed a separate low-confidence COVERED handoff missing priceChoiceId;
  it now uses existing handoffMenu to qualify prices before read-only Main.
  Fixed-value regression first reproduced that missing qualification. No thresholds
  lowered. Menu focused119 + decision-domain299 pass. Live2 real Jev/Main/Menu
  cases verify120–140 inclusive vs explicit102–104 after previous119, empty cart.
  Scoped Menu/Server/Kiosk types pass; targeted lint/build checked. Menu publication
  and API restart verified. No schema/lockfile change or POS submission/payment.

- Oct19 natural scope replies + floating-panel removal are DEPLOYED, UNCOMMITTED.
  Public Menu index-DKDaE4FB.js index/bundle hashes verified; Kiosk unchanged.
  Backup: /tmp/webnavior-scope-voice-release-20261019-2_lrhdcy.
  API restarted at19:55:27 Taipei, PID430265; livez/readyz and DB/Redis pass.
  Public Menu hashes, unchanged Kiosk and bridge/catalog7 verified; Nginx unchanged.
  Origin-Trial was verified at publication. Scope prompt is loaded.
  Session -IQxJ9IOqXiIewQHNA86c reproduced Main SHOWN for 剛才推薦 but ASK for
  剛才的 / 剛才的推薦. Prior local prompt change binds omitted nouns/temporal
  references to the active question's two search universes, without a whitelist.
  Expanded live replay now starts with recommendations, real Jev price admission
  and Main read before answering the scope question. All27 scenarios pass, with
  strict automatic acceptance for clear replies and holdout phrasing only in tests:
  剛剛的, 前面的, 你之前介紹的, negated corrections, fresh price100 and background.
  No new prompt/phrase rule was needed for these additional forms.
  Unclear spoken replies now explain the two universes (not repeat the initial
  question); original question ID,120s expiry, revisions and conditions remain.
  ASK-without-speech context/validation probes remain read-only. Unit17 pass;
  after this clarification change, targeted live4 unclear→natural answer flows
  pass with120 preserved. Other27 live results: /tmp/webnavior-scope-generalization-all.log
  and -all-results.json; latest4 results use /tmp/webnavior-scope-clarification-final.log.
  Menu/Kiosk scoped types, changed-file lint and Menu build pass; no root types.
  App no longer mounts/imports the floating scope UI; handler/busy state, component
  and obsolete3 touch browser tests removed. Owned voice question remains. Menu
  build index-DKDaE4FB.js has no floating-panel styles and is published. API
  restart is verified; reload the full Kiosk to obtain the updated Menu.

- Oct19 unsolicited recommendation expansion and weak search recovery are DEPLOYED.
  Public Kiosk index-Cv8z9P3a.js matches staged index/bundle hashes; Menu unchanged.
  Website/source/database backup: /tmp/webnavior-recommendation-release-20261019-2zjh0v9n.
  API restarted at19:33:58 Taipei, PID405914; livez/readyz, DB/Redis, public
  bridge/catalog7 and Origin-Trial pass; Nginx unchanged. Both Server repairs loaded.
  Same session entries14–21: `推薦幾個餐點` caused menu_recommend(limit3), then
  unsolicited more:true; menu reply aggregation narrated6 dishes plus6 prices.
  Kiosk recording now owns one recommendation presentation per send() turn.
  After an accepted recommendation receipt it withdraws recommendation/show
  tools from continuation definitions; repeat recommendations and broad visible
  menu_get calls receive a correlated data-only acknowledgement, without tool
  execution or customer receipt. Same-batch repeats are also suppressed. Named
  comparisons, internal evidence and authorized operations continue normally.
  Next customer send resets the budget, permitting an explicit request for more.
  Server instructions also constrain more:true and decision-guidance to prevent
  unsolicited expansion. This is separate from weak-price-entry repair below.
  Kiosk focused55 + Server26 pass; real Main/Jev replay12 pass, including the new
  completed-recommendation continuation (no second tool request). Scoped Kiosk
  types/lint and Kiosk build pass. Kiosk and API deployment are verified.
  Reload the full Kiosk to activate its per-turn guard.

- Oct19 post-deployment weak search recovery is DEPLOYED in the release above.
  Session -_n4bX6MRFcoRGilxK9-_ entries22–23: `120以下有什麼？` selected
  search-menu at0.597; filterRequirement OPEN_REQUEST at0.3999 then returned
  UNAVAILABLE before Main or the query-scope question. Weak finite search now
  uses the existing independent recipient + pure menuInquiry qualification
  before a price-qualified read-only Main handoff. No threshold lowered and no
  mutation permission added. Fixed-value reproduction fails before the change;
  recipient/background, mixed-operation and uncertain inquiry cases stay closed.
  Decision-domain298 tests and live Jev/Main/Menu11 pass; new live case starts
  before price interpretation with the reported bento conversation and reaches
  pendingCustomerChoice. Original10 live cases only started after scope creation.
  Server types/lint pass; this recovery needs no extra frontend change.
  API restart verified above. No POS order or payment.

- Oct19 query-scope flow and price-handoff repair are DEPLOYED, UNCOMMITTED.
  Menu index-R0AKYPEi.js remains current; initial Kiosk index-f7hMuxg8.js is
  superseded by index-Cv8z9P3a.js in the recommendation repair above.
  API restarted successfully; livez/readyz, DB/Redis, public bridge and7 catalog
  items pass. Nginx unchanged; Origin-Trial present; old assets retained.
  Verified website/source/database backup: /tmp/webnavior-scope-release-20261019-ne9ul3yh.
  New broad price/dietary reads after a visible recommendation ask once whether
  to filter the shown batch or the whole catalog. Menu owns a120s revision-bound
  queryScope question and immutable conditions; the original floating UI is now
  removed locally as described above.
  Pending voice goes through the real Main chat model checkpoint in authenticated
  /interaction-decisions (SCOPE_CHOICE, temperature0), not Jev. Only question text,
  ordered option labels and confirmed conditions reach that checkpoint; opaque
  IDs/expiry remain browser authority. ASK retains the pending question; NEW_REQUEST
  clears the old question and reruns ordinary Jev on the entire current utterance.
  Price evidence forces fresh qualification even if Main misses the new amount.
  Complete labels/ordinals use the existing bound-reference parser; real Main
  still proposed SHOWN for 第二個, and application correctly resolved CATALOG.
  Do not call this100% model accuracy. Invalid/unavailable interpretation falls
  back to conversational clarification. Provider/activation failure cannot grant normal chat
  writes while a scope question remains pending.
  Scope execution has a private per-call admission, not a global bypass flag.
  Confirmed item universe is separate from food exclusions, retained on more,
  reset by fresh queries; UI title/reply names the selected scope. Stale answers,
  order changes and resets retire the question. Main cannot invent a named scope
  for a customer-wide price query: BEGIN now requires the source transcript.
  All BEGIN fixtures and KioskScene are updated. Host-only tool names are shared
  in order-menu/src/hostTools.ts so kiosk_query_scope never reaches Agent tools.
  Recording stops at an owned scope question without another model continuation.
  Real qwen36 + real Jev + production route/host/Menu replay10 pass including
  120→100 and synthetic add2. Some earlier paraphrases required touch fallback;
  acceptance permits preserved ASK + explicit click, not wrong automatic scope.
  Menu648, Host69, HTTP3 and Chrome13 checks pass; Menu/Kiosk/Server scoped types,
  changed-file lint and both frontend builds pass. No root typecheck, POS order,
  payment or commit. Physical microphone/scanner remains unverified.
  See research section17 and READMEs. Menu + Kiosk + API are released together;
  reload the full Kiosk because the BEGIN contract changed.
  The older ordering release below is retained as deployment history.

- Oct19 price-handoff fix is DEPLOYED with the query-scope release above,
  UNCOMMITTED. Reported
  session `7hsfZq4mzTs1YZvCTCdXg`: after a99 recommendation, `120以下有什麼`
  made Main Agent correctly call menu_get(maxPrice120), but unresolvedPrice
  blocked it; ordinary empty receipts prompted retries119/115/110/109.
  Menu handoffs now qualify the browser-issued priceChoiceId before host task
  creation, retaining existing contextual price input. A reliable read route
  can hand off uncertain filter scope read-only, with independent price
  qualification; weak route plus weak scope still abstains. Price-only changes
  are distinguished from food preferences in scope instructions. Menu's
  unresolved-price refusal returns ok:false to stop the tool sequence.
  Real Jev→Kiosk→Menu synthetic replays99→120 and120→99 pass with exact bounds,
  including the120 boundary; six existing food-preference live replays pass.
  These replay actual tools with synthetic dishes, not full live Agent speech.
  No threshold reduction, schema change or commit. Menu and API deployment
  are verified in the query-scope release above.

- Earlier Oct19 ordering release (superseded by the scope release above) deployed to
  `https://webnavior.aikcitri.qzz.io`: scanner focus, checkout cursor, scroll
  destination and open preference queries. Menu serves index-pOjsIocX.js;
  Kiosk serves index-BphV_JC4.js. Both public bundle SHA-256 hashes match the
  staged builds. User restarted API at16:25:42 Taipei, PID199010; livez/readyz
  pass with DB/Redis ok. Public Menu Bridge and all7 catalog items are readable.
  Nginx configuration hash is unchanged, Origin-Trial header remains present,
  and older assets are retained for already-open clients. Static trees,
  working-tree patch, new builds and a pg_restore-list-verified database dump
  are backed up at `/tmp/webnavior-ordering-release-20261019-bm1wpslt`;
  release.json records verification. Host pg_dump has no installed client, so
  backup used the existing matching postgres:16 container and configured DB
  role. No schema/lockfile change, commit or push. Changes remain uncommitted;
  physical scanner and full Agent/voice acceptance remain unverified. No order
  or payment was executed during deployment checks.

- Oct19 scanner-focus follow-up: carrier/citizen invoice fields now autofocus
  on mount, option selection/reselection and Agent unlock. App passes the same
  lock as its inert main; locked fields disable/blur before regaining focus
  after DOM updates. Tax-ID output is now a labelled digit input, retaining the
  touch keypad, eight-digit validation, draft and explicit confirmation. Its
  scanner Enter suffix does not confirm; invoice valid-form Enter keeps existing
  behavior. Tax-ID cursor target registration is cleaned up on unmount. Chrome
  keyboard-wedge simulation and checkout-animation regression10, checkout
  unit14 pass. Physical scanner remains unverified. Deployed in the ordering release above; changes remain
  uncommitted. No scanner SDK, new dependency or global keyboard interception.

- Oct19 open food-preference follow-up: Jev routes the whole utterance to Main
  Agent via read-only MENU_QUERY rather than adding phrase/category candidates.
  A finite-read hypothesis first checks whole-request scope; OPEN_REQUEST exits
  before ingredient-slot questions. Direct reads retain bounded validation.
  Main Agent instructions preserve negation, combinations, corrections and cart
  state, clarify ambiguity, then use catalog-grounded query tools. menu_get and
  menu_recommend accept validated excludeItemIds; batches retain/extend them on
  more:true and reset on a fresh request. Existing dietary/ingredient/price
  filters intersect with exclusions. Internal menu_get(display:false) receipts
  now carry dataOnly:true and are not narrated by Kiosk. Server tool-result
  compaction preserves composition facts intact. Deployed with Menu, Kiosk and API together in the release above;
  changes remain uncommitted. Real Jev replay: five
  clear preferences reach MENU_QUERY; ambiguous 不想吃飯 reaches Agent for
  clarification without executing a filter. Focused tests, all six live routing
  cases, Menu/Server/Kiosk scoped types and changed-file lint pass; no root
  typecheck. Agent end-to-end speech/hardware validation remains outstanding.
  Candidate pruning and follow-up timing remain
  separate pending work.

- Oct19 checkout cursor follow-up: runtime checkout announcements lacked
  control IDs and checkout components did not register targets. Registered the
  real review/invoice/tax-ID/payment controls and wired them through App; checkout
  start first reveals review, then animates confirmation. Transitions wait for
  animation and execute once without a synthetic DOM click. Tax-ID dictation
  targets the draft; explicit skip/donation and return-to-order touch actions now
  match supported voice transitions. Unpaid QR pages retain payment-method
  buttons; pending/authorized/uncertain states still lock navigation. Deployed in the ordering
  release above; changes remain uncommitted. Chrome regression covers target registration,
  pre-transition ordering, switching unpaid QR method, touch actions and locks
  (11 browser tests, including existing review regression); Menu93 unit tests,
  Menu/Kiosk scoped typechecks and changed-file lint pass. No root typecheck.
  Actual microphone/hardware remains unverified.

- Oct19 scroll content-destination follow-up: original session
  NOSb3gdRfHaSE-uu_s7wB selected UP .8065 for 往下一點 at viewport0. Public
  direct DOWN moved0→720, so the owner is functional. Menu candidates now name
  earlier content near its beginning / later content near its end, not finger
  motion. Jev verifies EARLIER/LATER before mapping to an offered UP/DOWN action.
  Actual generated-candidate replay still chose initial UP .7481 for 往下一點;
  verification corrected it with LATER .9298, so the extra one question remains.
  Six clear position commands execute correctly; two composite gestures may
  abstain, never execute opposite (8 acceptance cases pass, not 8 successes).
  Bare finger-only probes remain inconsistent; do not claim general gesture
  interpretation is solved. A gesture-only fourth choice degraded core commands
  and was removed. No lexical executor, threshold change, new tool or dependency.
  Server83/Menu41 tests, scoped types/lint pass; prior real Chrome viewport test
  passed and geometry is unchanged. Deployed in the ordering release above;
  changes remain uncommitted. See `research/2026-10-02-menu-scroll-options.md`.
  Open preference/exclusion support is described above; candidate pruning and
  checkout-question timing remain separate pending work.

- Oct19 invoice skip follow-up: moved **略過，捐贈發票** below invoice entry,
  above Back. Retained session zloUV_0YpdMnMhQlGEFvp entries7/9 recorded literal
  略過 as INCOMPLETE .621 while already in checkout_invoice with no presented
  question; a real-provider synthetic replay reproduced it. Invoice routing now
  uses a concise current-phase instruction and sanitized checkout summary rather
  than stale meal/cart context. Other checkout phases retain their prior route.
  No lexical execution shortcut, threshold change, donation-code invention or
  payment initiation. Regression covers summary privacy, no-question routing,
  UI footer order and weak-choice refusal. Final live invoice8 + payment1 pass;
  Menu36/Server116 unit tests, scoped types and changed-file lint pass. An earlier
  broader live replay routed 走走走 去那邊 to NEEDS_ASSISTANT in ordering; that
  unchanged ordering case is outside this invoice fix. Actual microphone/touch
  hardware remains unverified. Menu frontend deployed Oct19 as index-BsE53J15.js;
  public bundle matches the build. User restarted API Oct19 at14:07:42 Taipei;
  new PID60954 is active/running. `/livez` and `/readyz` pass with DB/Redis ok,
  and the public Menu still serves the expected release. Both invoice UI and
  Server routing changes are now deployed. Backup:
  `/tmp/webnavior-invoice-deploy-20261019-3snye5oy`. Changes remain uncommitted.

- Oct19 voice-entry UI is deployed, with local changes still uncommitted. Public
  Kiosk now serves index-C00sQvW4.js: saying “略過” is the primary entry cue,
  phone/touch controls are secondary, VAD readiness drives the microphone label,
  and the existing idle hint gives spoken-order examples. Browser component11,
  Kiosk types and changed-file lint pass. Kiosk-only build/publish preserved
  the WebMCP Origin-Trial header; API readiness reports DB/Redis ok. Previous
  Kiosk assets and the source patch are backed up under
  `/tmp/webnavior-voice-entry-20261019-nc7fru6x`. No API restart or real speech,
  order or payment test was needed for this static UI release.

- Oct19 release: four code commits through 5f2c5f1 are deployed to
  `https://webnavior.aikcitri.qzz.io`; API restarted via systemd at11:17 Taipei
  (PID584043). Public `/` and `/kiosk/` serve index-0t8K34cR.js, `/menu/`
  index-9m9pfTsn.js, and admin index-Bd2h2EYE.js. Browser smoke: unregistered
  Kiosk shows device setup without errors; Menu loads all7 actual dishes and
  no cart/order/payment was attempted. API readiness reports DB/Redis ok.
  Root typecheck passed once; root lint reports3184 pre-existing errors in16
  unchanged files. All staged-file commit hooks and focused Shared21/Kiosk74
  tests pass. Old static assets and a pg_restore-list-verified database dump are
  retained in `/tmp/webnavior-release-20261019-rpf1ss90` (ephemeral backup; move
  to managed storage if longer retention is needed). No remote push, real login
  round trip, voice/hardware or payment acceptance test.

- Oct19 cart replacement (same session, entries76/78): 牛肉麵幫我改水餃 chose
  ADD .5474, purpose OPERATION .5638, coverage HANDOFF .5137, then UNAVAILABLE.
  Independent recipient and replacement-semantic checks now recover weak HANDOFF
  coverage and weak MULTI_ACTION before inquiry-only recovery. No threshold was
  lowered; Agent still validates targets and uses atomic replaceLineId. Live
  configured-provider replay completes noodle→dumplings and reverse replacements;
  eight cart-change controls pass, including absent pizza preserving the cart,
  add/quantity/remove and companion speech. Server decision268 tests pass
  (75 opt-in skips), Server scoped types and changed-file lint pass. Released
  Oct19 as recorded above; no voice/hardware test.

- Oct19 food hallucination (session hIHA3DAvjhrG8x0RjggBa): read-only DB audit
  confirms 我不想吃飯 received invented 麻醬麵/酸辣湯麵 without any tool call.
  Plain Agent handoffs now require menu receipts even with zero catalog matches;
  GENERAL_QUESTION explicitly admits identity/service dialogue. Reprojection
  retains requireMenuRead. Both prompts prohibit inferring a substitute from an
  ambiguous refusal. Host regression reproduced the gap before the fix; Kiosk73
  and Server140 targeted tests pass (2 skipped), scoped types checked. Oct19
  continuation used `/etc/webnavior/server.env` for the actual deployed provider
  configuration. Local `.env.local` REDIS_URL now matches that authenticated
  connection; standard apply:env Redis authentication/PING passes. The food-refusal
  replay chose IGNORE, producing no invented menu reply. Host evidence-guard
  regression independently verifies rejection if an Agent does generate prose.
  Released Oct19 as recorded above; voice/hardware remains unverified.

- Oct18 routing/auth follow-up: public HTTPS `/` and deployed entry bundle already
  redirect to `/kiosk/`; local Nginx agrees. Preserved pre-existing root/PWA edits
  and added the missing root redirect to the deployment script. Oct19 correction: API 401 after
  failed token refresh automatically starts local Webnavior OIDC login; the
  previously added opt-out/banner was removed at user direction. The callback
  restores the original safe local route instead of `/`.
  Entry/login changes were deployed Oct19. Third-party non-WebMCP control remains a
  pending choice (Chrome extension / Electron / local CDP); see
  `plans/2026-10-18-webnavior-routing-and-browser-control.md`. Public Maifood
  HTML was read only; no cart/order/payment or real browser validation.

- Oct18 test-release commit cut: current work is grouped into shared contracts,
  continuation Bridge, ordering/Jev core, welcome administration, Kiosk host,
  and deployment documentation. User explicitly authorized these commits; no
  push or deployment was requested. Full root typecheck passed once. Root lint
  fails on pre-existing unmodified research/other-module files; every commit
  still runs the normal staged-file hook. Menu626, Bridge37 and Kiosk162 unit
  tests pass. Server profile/HTTP53 pass after updating old recipient/price mocks
  and verifying the staged route's four actual questions. Old experiments now
  follow current payment-method selection and bounded query contracts rather
  than expecting removed confirmation behavior or unsafe partial actions.
  Broad parallel checks caused substantial load and database-test timeouts;
  subsequent checks use one worker/package at a time. No check remains running
  after completion. Python cache and unused phone-modal screenshots are left
  untracked. Before deploying, read the test-release section in
  docs/ubuntu-webnavior-kiosk-server-deployment.md: static deployment scripts
  do not start the Order Menu Bridge or preserve an additional proxy by magic.
  Configure its service, allowed origin and public HTTPS URLs first. Payments,
  post-order table binding and pickup changes remain simulated/test-only;
  continuation tokens remain in memory for30min and vanish on Bridge restart.

- Oct18 unfamiliar menu-query recovery (attachment a4c50e1a): 有魚排便當？
  while fulfillment was pending chose NEEDS_ASSISTANT .3454; recipient KIOSK
  .9987 still hit the unconditional weak-handoff refusal. Ordering now separately
  qualifies a pure menu inquiry after recipient verification; weak mutations,
  compound operations, unrelated speech and invalid/weak verification still
  receive no operation authority. No dish-name branches or threshold changes.
  Product-resolution none now distinguishes UNRESOLVED_SUBJECT from category,
  general recommendations, price numbers and ingredient requirements. An
  unfamiliar named dish must retain its literal subject for Agent lookup.
  MENU_QUERY and unresolved filter reads require fresh menu evidence even with
  no known product/category match. Query/filter/price handoffs carry readOnly;
  Kiosk binds it to the existing Agent task and resends inquiry context on every
  continuation. Ordinary mutation/checkout snapshots remain first-request-only
  to avoid stale phases. Server offers read tools only; owned Menu independently
  blocks writes, fulfillment and question effects, even after successful lookup.
  Its read-only cart snapshot creates no new question; new customer tasks reset
  authority. Tests first reproduced the refusal, missing task guard and dropped
  continuation context. Actual configured Jev/Main replay passes four unfamiliar
  queries with/without old fulfillment and four category/general/price/ingredient
  controls; each unfamiliar reply says 查不到 the original name, cart unchanged.
  Server domain267, focused HTTP/coverage50, Kiosk97 plus3 no-evidence guard cases,
  and Menu43 pass; scoped Server/Menu/Kiosk types and changed-file lint checked.
  Live commands use a90s whole-process watchdog, not unbounded provider waits.
  No browser/hardware/voice test, root typecheck, dependency or commit. Routing
  remains probabilistic; the read-only task boundary is enforced independently.

- Oct18 first-order regression correction: attachment aa9a2bda's 水餃一份
  correctly chose ADD .9676, then the combined read/coverage guard misread it as
  READ_ONLY .5171 and refused. Prior live replays seeded carts directly through
  tools, so their claimed coverage missed the first spoken Jev order. Split
  literal requestPurpose (inquiry/operation) from original four-way cartRequest
  coverage. Browser-matched subject supplies balanced purchase/query examples;
  quantities and word order are contrasted without dish-specific code/settings.
  Weak purpose grants no authority and does not veto independently reliable
  route+coverage checks; a weak original route still only hands off after verified
  recipient/coverage. This preserves cancellation and replacement support. Thresholds stay
  unchanged. The extra binary question costs 0.29–0.74s in this replay; twelve
  first orders total1.63–2.24s Jev, excluding TTS. New opt-in provider tests now
  actually skip phone then run the first speech through Jev and inspect the cart,
  with realistic menu candidates and both default/current saved prompt policies.
  All22 first-order/inquiry cases pass (three dishes, one/two/three/five servings,
  Chinese/Arabic numbers, reversed order, explicit 我要, price and variety queries).
  Server252 unit tests pass;
  Kiosk31/Menu81 targeted tests, Server scoped types and changed-file lint pass.
  Final eight-case cart replay also passes: plain add/quantity/remove, whole
  swaps, unknown target preserving original, and companion speech. Actual Main
  completes both swap phrasings; browser guard blocks its attempted deletion
  after missing pizza. One earlier run correctly handed off 水餃換牛肉麵一份
  but Main only queried menus and retained dumplings; the final replay passed
  without Main production changes. Keep this probabilistic execution limitation
  visible; routed requests and mocked tests do not prove completed swaps. No browser/hardware/voice test,
  full-project typecheck or commit.

- Oct18 menu-query / hallucinated-variety repair: reported session
  McJ8clPpBKvNt_XMYWFRq had no-tool invented noodle examples; its later variety
  question was a weak refusal, not literal IGNORE. All current-product/category
  ordering handoffs now project requireMenuRead, beyond MENU_QUERY; old cart
  references alone and non-factual phone fallbacks do not. Shared intent rules
  distinguish dish mention from purchase, and names from extra ingredient filters.
  Proposed ADD/REMOVE/quantity/option effects now check whole-request authority
  even for the first item. READ_ONLY recovers through existing search/conditions,
  never a quantity draft. Recipient qualification uses isolated literal speech;
  conditions retain their original contextual state (isolating prices too caused
  live regressions). Valid question answers/recovered reads do not repeat scope.
  Weak handoff scope may only silence companion speech, never promote a weak
  action; relation NEW_REQUEST verifies recipient before admission. No thresholds
  lowered, per-dish branches, dependencies or merchant settings. Extra finite
  checks add latency (first-item guard superseded by the correction above); reads add
  recipient qualification before conditions. Main also once removed an old dish
  after a failed replacement lookup: existing browser Agent task now latches a
  missing/unavailable named subject and blocks partial order edits until the next
  customer task; late old reads cannot latch a successor. Runtime tests cover
  mixed queries, sold-out targets, fresh-task release and task replacement.
  Live synthetic replay passes30 Jev cases across four tests (including14 prices,
  food varieties with/without history/cart, companion speech and cart changes),
  with six real Main/SSE/owned-Menu flows. Provider replay now initializes accepted
  Fast Path receipts through the actual entries endpoint and binds Agent tasks,
  matching the real host. Targeted Server247, Menu81 and Kiosk31 pass; scoped types
  and lint checked. Browser automation remains disabled; no hardware/voice test,
  full-project typecheck or commit. Arbitrary model wording remains probabilistic;
  the browser guard prevents the reproduced partial deletion independently.

- Oct18 waiting-feedback trial: Kiosk now shows neutral localized progress as
  soon as idle ASR/simulated speech enters Jev, including weak first routes.
  This is display-only; it never admits speech, takes a turn or displaces an
  active Agent/spoken reply. Main progress takes over and retains real tool
  status across SSE continuations/drafts until receipt-grounded presentation.
  useKioskWaitSpeech starts fixed-copy live TTS concurrently for admitted Agent
  work (and deliberate typed retries); playback requires one second still
  pending plus ready audio, once per turn. Fault/disabled-System-One fallbacks
  have no verified recipient and stay text-only. Optional output owns a child
  abort signal, not the order signal: final results, cancellation, new turns,
  manual handover and disposal cancel stale synthesis/playback without touching
  order phase/authority. TTS failure leaves text and execution intact, no retry
  within the turn. Shared existing player now settles/cleans on interruption;
  final audio takes priority. No new settings, dependencies, model calls for
  wording, prepared audio bank or service startup; uses current Site TTS voice.
  User says TTS service is OFF and wants live synthesis once enabled. Unit35,
  scoped Kiosk types and changed-file lint pass; existing Vite scene transform
  HTTP200. Browser UI automation remains disabled; no actual voice/hardware test
  or root typecheck/commit. To preview, refresh Kiosk :5169, skip phone, add
  水餃一份 then say/simulate 水餃不要，改牛肉麵. Visual feedback works with TTS
  off; enabling the existing speech service enables the optional phrase.

- Oct18 cart replacement: attachment 8a3a6bcd's 水餃不要，改牛肉麵 chose
  ADD .3114 while dumplings were already in cart. Previous tests covered draft
  switching, not this whole-request gap; Oct7's similar diagnosis is superseded.
  Existing-cart ADD/REMOVE/quantity/option routes now check single-effect coverage
  before execution, adding one small Jev call. Verified replacement/weak-route
  handoffs additionally isolate recipient (one call); thresholds stay unchanged,
  background speech stays silent, original trace and fulfillment survive. First
  item originally added no calls (superseded by the first-order guard above). Real Jev needed explicit effect descriptions and contrast
  examples: generic proposal descriptions misread 換 as SINGLE; combined recipient
  scope admitted 小王. Final eight synthetic Jev contrasts pass, including pronoun,
  unknown replacement, plain add/edit/remove and companion speech. Main initially
  exhausted the existing host budget because only the latest tool result survived.
  Server now retains paired compact tool exchanges of the latest customer turn
  (four batches/sixteen calls), clearing payloads on a new utterance. Prompt-only
  add-before-remove still failed, so existing order_add_item gained replaceLineId:
  validates both targets/options, retains omitted quantity, synchronously commits
  once and merges matching destination lines. Missing/unavailable/selection-failed
  replacements, invalid config, stale cart/menu/checkout or ambiguous old variants
  cannot remove the original. Receipt contains replacedLine; no extra Jev intent
  or new tool, round-budget increase, third-party transaction guarantee or commit.
  Actual Jev/Main/SSE/owned-Menu replay passes two swap phrasings and absent pizza
  (original retained); one earlier run hit a transient Jev provider failure, then
  the full eight-case replay passed. Server services235, HTTP context regression1,
  Menu85 + machine9, scoped Server/Menu types and changed-file lint pass. Broader
  HTTP suite has an unrelated old price assertion expecting maxPrice in initial
  state although the current contract carries literal amounts; not changed. No
  full-project typecheck, browser/voice/hardware test. Arbitrary compound commands
  remain probabilistic; this fixes bounded routing plus owned-page whole-line swaps.

- Oct18 continuation pickup change: the order-continuation page now offers
  改為自取 before/after table binding, with explicit confirmation and 保留內用.
  POST /v1/continuations/:token/takeout requires confirmed:true and atomically
  changes the test snapshot's required fulfillmentMode to takeout, clearing its
  table. Original POS receipt/payment/order ID/items/total/expiry stay intact;
  this is explicitly a test-only override, with no external POS mutation or
  additional submission/payment. Replays retain pickup; stale table writes get
  409, expired/unknown tokens404. UI updates only after success, clears its own
  pending table-scan token, hides binding controls and keeps pickup on reload.
  Lifespan stays30min/in-memory. Client/SSR9 and backend22 tests, Menu/Bridge
  scoped types and changed-file lint pass. Browser access remains disabled;
  no real DOM interaction test, dependencies, commits or full-project typecheck.

- Oct18 missing table-binding QR after repeated demos: browser gateway kept one
  idempotency key for its entire lifetime, so a later paid dine-in received an
  earlier pickup/expired receipt, showed rewards but got no continuation. Keys
  now correlate with payment IDs and retain late-retry identity. Real in-memory
  Bridge/simulator regressions cover pickup→dine-in, expired dine-in→new dine-in,
  and lost accepted response/replay without duplicate POS submission. Targeted17
  and Menu scoped types/lint pass. Browser completion test now waits for the
  automatic five-second payment and asserts both reward and order QR; browser
  access is disabled, so it was not run. Pickup intentionally has no table QR.
  User later confirmed their reported order was pickup, so its display was
  expected; the independently reproduced repeated-order bug was still fixed.

- Oct18 order-item display focus: 「炸排骨便當2份」 → fulfillment question →
  「還要一份水餃」 added correctly but retained the old visible lookup. Shared
  revealItem now validates operability, focuses the actual catalog card before
  cursor movement and retains it after adding; visible-dialog continuations
  still skip reopening. Display focus updates conversational references without
  resetting recommendation filters/seen history or answering fulfillment.
  Voice/Agent/stepwise contrasts cover dumplings and noodles. Targeted80, Menu
  scoped types and lint pass. Broader recommendationFlow still has the known
  review cursor assertion omitting order:view; unrelated to this change. No
  extra model requests, dependencies, browser/hardware verification or commits.

- Oct18 direct payment-method selection: LINE Pay / 街口支付 now select
  immediately through voice or Agent, without a second confirmation. Latest
  demo shows a genuine QR encoding plain TEST ONLY metadata (no payment URL),
  labels it non-payment, then counts five seconds after image generation and
  requests the existing simulator automatically. No physical scan/button is
  needed. usePaymentSimulation owns cancellation on method/amount changes,
  ineligibility or scope disposal; stale QR work cannot restart it. QR failure
  does not pay; rejected/uncertain results do not auto-retry. Only verified
  simulator/order results advance completion/rewards. Selection still returns
  `selected`, retires the method question and preserves execution/phase locks.
  Follow-up14 (including real QR generation), total targeted96, scoped Menu
  types and changed-file lint pass. Earlier configured-Jev2/host69 also passed.
  Checkout's separate 30s timer returns only an unselected payment page to
  review; invoice/tax-ID never auto-skip. Kiosk idle is 3min then 15s confirmation;
  question-ticket30s expiry grants no choice. Known broader Menu expectations
  still omit clarify/order:view and use the old ingredient-filter title. No
  browser UI, real scanner/payment/hardware test, dependencies or commits.

- Oct18 price evidence and semantic scope: unitless comparisons such as
  `有價格130以下的嗎？` now issue literals alongside unitless ranges; Jev still
  owns interpretation, and the browser owns amounts/execution. Coverage includes
  inclusive/exclusive upper/lower bounds, exact price, independent range ends,
  ascending order, currency/Chinese/full-width forms, new budgets and empty
  batches. Quantity/clock literals remain excluded. Approximation, relative/total
  budgets and unsupported descending order cannot supply executable conditions.
  Key model failure: repeating proposed price descriptions in customer state
  made 不到 choose the inclusive proposal confidently. State now carries literal
  amounts only; alternatives belong to their own question, and food capability
  checks do not repeat them. Food-filter presence explicitly excludes pure
  prices. Exact/range/sorting contrasts use clear finite criteria; thresholds
  were not lowered. A factual phone MENU_QUERY qualifies prices before handoff,
  and host presentation permits its read-only recommendation tools while still
  blocking order edits/skip authority. Configured Jev/Main replay passes14 cases
  through actual runtime and fresh-phase host presentation; Menu123, decision207
  (75 opt-in skips), host68, scoped Menu/Server/Kiosk types and changed-file lint
  pass. Browser UI access is disabled; verified presentation IDs/replies, not DOM
  automation. No voice/hardware, dependencies, commits or root typecheck.

- Oct18 reactive phone-stage greetings: the entry scope now distinguishes
  HELLO_ONLY / REQUEST / BACKGROUND. Reliable HELLO_ONLY maps to existing GREET
  and fixed host “您好！” after one Jev call, without phone skip, question
  acknowledgement or Main Agent. Mixed greetings follow their request. Small
  contrast examples were necessary: adding GREET to the later phone classifier
  diluted order confidence, and broad greeting criteria confused identity
  questions/companions. Final configured-Jev replay passes 22 synthetic phone
  cases, including identity, recommendation, factual menu, skip and companion
  contrasts. A companion may also fail closed as UNCERTAIN_RECIPIENT; the test
  accepts only this quiet refusal, never provider errors or greeting responses.
  Phone unit14, host51, scoped Server types and changed-file lint pass. No voice
  or hardware testing, dependency changes, commits or full-project typecheck.

- Oct18 phone recommendation/ordering prerequisite: phone classification now
  separates factual MENU from ORDER (recommendation, more recommendations or
  ordering). ORDER returns CUSTOMER_ENTRY_REQUIRED, and Kiosk presents fixed
  localized fill/skip guidance plus test number0912345678 without Main Agent or
  WebMCP execution. Explicit skip remains its own authorized transition; factual
  food/identity/phone queries remain available. Agent fallbacks reread live entry
  phase before presentation: recommendation/order tools while pending show the
  same hint, including empty recommendations and blocked writes, not “no matching
  dishes”. Completed entry retains its real result. New diagnostic route labels
  entry waiting explicitly. Jev12 synthetic contrasts, decision199 (75 skips),
  host67 and Server/Kiosk scoped types/lint pass; no voice/hardware test.

- Oct18 category ellipsis / unfinished speech repaired: shared scope understands
  category names with 呢／的有嗎／之類的 as complete browsing. In ordinary
  ordering, an INCOMPLETE with weak confidence or current category evidence
  gets small recipient then speech checks. Only a reliable QUERY can rejoin the
  existing SEARCH/filter/price path; background/unknown recipient grants no
  read, admitted unclear/complete needs reach Agent, and reliable unfinished
  speech still waits. Original route remains rawAnswer; semanticCheck/exchanges
  explain recovery. No fulfillment answer, cart mutation or changed thresholds.
  The first recovery prompt overlapped REQUEST with genuine unfinished speech;
  tightening the mutually exclusive criteria fixed its live contrast. Six real
  Jev category cases plus background/unfinished and three recorded-first-route
  recovery contrasts pass (11 cases total) through the owned runtime. Cart and
  pending fulfillment are retained. Server decision195 (75 opt-in skips), host50,
  Server scoped types and changed-file lint pass. A background contrast can
  take the existing UNCERTAIN_OPERATION refusal instead of IGNORE; both forbid
  read/Agent/old-question effects. The test checks that safety contract without
  lowering thresholds. No ASR/TTS/hardware test.

- Oct18 simulated-ASR trace copy: its expandable System One trace offers
  localized full-source copying with success/failure feedback, following the
  shared error panel's native clipboard pattern. New trace clears old status;
  an in-flight write cannot label a replacement trace copied. Existing panel
  browser10 and Kiosk scoped types pass. No dependency change.

- Oct18 optional phone query reminder: the Kiosk appends fixed localized copy
  once after a verified successful factual menu reply if a fresh service-state read still
  reports customer_entry. Fast Path and Main Agent share this presentation
  policy; identity replies, pending operation questions and failed lookups do
  not consume it. Customer reset clears it; skipped/filled entry during a lookup
  suppresses stale reminders. Acceptance-test modal and reminder now offer
  0912345678 without pre-filling or submitting it. Unit15 and Phone browser9 pass;
  no new model request or voice/hardware testing.

- Oct18 hallucinated menu / ignored corrections: a scoped read of the reported
  local test session confirmed that its second recommendation had NO tool call;
  Main Agent invented three names. A completed no-tool answer was previously
  trusted as dialogue. Phone routing now distinguishes MENU from ordinary ASK;
  normal ordering also admits a MENU_QUERY handoff for disputed menu claims.
  Host projection carries requireMenuRead, JSON/SSE gateway requests require a
  fresh menu_get/menu_recommend call, drafts stay service events, and Kiosk
  rejects no-receipt food prose as a retryable error. Identity/phone FAQs remain
  natural. menu_get verifyClaim with named queries gives an explicit correction
  for absent names or real page availability for present ones; copy is in i18n.
  Current-meal “不要水餃” and “不是要點，只是問有沒有” were both wrongly
  rejected as background by the clerk-context recipient prompt. Classification
  now isolates customerUtterance; current-meal purpose choices are mutually
  exclusive CANCEL/INQUIRY/CONFIRM/NEW_REQUEST. configure:<id>:inquiry consumes
  the live answer, drops only that unadded draft, reads the same dish and never
  revives its quantity question. Other cart lines/drafts remain intact.
  Seven correction/subject-switch contrasts and ten phone/menu/identity live
  contrasts pass with synthetic data, without lowered thresholds. Menu74,
  host82, browser12, Server decision112 (3 skips) and related HTTP cases pass.
  Older route/flow provider mocks were updated to the existing service/purpose
  and phone question contract. Scoped Menu/Kiosk/Server types and changed-file
  lint pass. Configured-provider replay now passes six synthetic cases through
  actual Jev, Main Agent (webnavior/chat -> qwen36), SSE route, owned Menu tools
  and host reply validation. Alternatives call menu_recommend(more:true), disputed
  names call menu_get(verifyClaim:true), and corrections/cancellation leave cart
  empty without returning to quantity. Initial four menu turns took 2.5–4.6s.
  A fresh timing replay separates phone-stage Jev flow (two service/phone calls,
  1.18–1.54s), Main Agent (two SSE round trips, 1.32–2.71s), local tools (1–4ms)
  and total (2.69–4.27s). These include network/application time, exclude speech,
  and are individual samples rather than a latency SLA. Opt-in replay is documented in
  Server README; cross-app fixture belongs in tests/experiments, not Node-only
  src. User excluded voice testing; ASR/TTS/hardware remain unverified. No
  dependency changes, commits or full-project typecheck.

- Oct18 page-availability acceptance trials: development Kiosk admin now has
  **點餐體驗情境測試**, using host-only `kiosk_test_menu` on the development
  owned Menu. Four in-memory states share touch and voice evidence: available,
  sold-out, unknown, selection-failure. No counts or inventory/POS integration.
  Selection failure keeps other cart lines, becomes unknown and produces a known
  item-selection receipt; Kiosk speaks that explanation rather than an uncertain
  write-failure message. Unavailable names remain valid read targets.
  Meal-confirmation availability follow-ups use `inquire-meal:<questionId>`;
  Jev classifies READ and the browser consumes only that live revision-bound
  proposal for a lookup, without purchase/quantity prompts. Different named
  items/categories and conditions cannot inherit this shortcut. A combined
  prompt misread corrections as NO and companion questions as queries. Corrective
  wording now routes correctly; READ additionally verifies recipient using only
  customerUtterance (two calls); ordinary YES/NO stays one call. Background/weak
  recipient results stay silent without lowered thresholds. Synthetic live
  contrasts9, Menu104, Server124 (3 skipped), browser11, Menu/Server/Kiosk scoped
  types and changed-file lint pass. The broader order-machine suite exposed three
  older expectation mismatches (clarification tool list, review cursor action,
  recommendation title); not changed here. Real microphone/ASR/TTS acceptance and
  third-party pages without WebMCP remain unverified/deferred. Reload Menu to
  reset fixture states; admin refresh only rereads them. No new dependencies,
  commits or full-project typecheck.

- Oct18 phone entry now renders as a local host overlay in Stage Kiosk's
  ScenarioSurface ordering region, not a restyled Menu page. Document-wide
  showModal blocked the upper controls; nonmodal show plus a region-local mask
  now keeps avatar/conversation interactive. The 25% mask has no blur and keeps
  the underlying catalog visible/inert. Old Menu phone page is removed; standalone
  Menu opens catalog directly. Host-only kiosk_customer_entry_start offers entry
  for an untouched order, never reopening after phone choice/cart activity.
  The dialog scrolls within short regions. Browser regressions8 cover bounds at
  500/240px and upper clicks. useKioskCustomerEntry observes
  admitted WebMCP discovery/execution and reads phase; submit/skip close only
  after entry advances. Replaced documents/disposal revoke old reads and drafts.
  Host-only kiosk_customer_phone uses phase/10-digit validation
  and callback to its existing transaction phone storage; no phone is echoed
  into decision state. Kiosk and Web exclude this tool from Agent tools.
  Deploy Menu/Kiosk/Server together; no original full-page entry remains.
  Phone-stage food queries now allow Agent menu_get/menu_recommend/
  menu_show_recommendations without consuming the phone choice. A reported
  identity question worked but “我想吃飯” failed: both the broad-exploration
  guard and the entry tool/authorization gates blocked reads after a correct
  NEEDS_ASSISTANT handoff. All those gates now admit menu browsing only;
  selection/cart/checkout still require explicit phone/skip choice. Regression
  covers broad/named queries, recommendations and presentation, preserved phase
  and rejected order writes. Synthetic Jev handoff and phone browser regression
  pass; no model prompt/threshold change or automatic skip.
  Live reproduction: generic entry routing classified a short skip as INCOMPLETE;
  single combined phone classifiers also misread negation/companion speech.
  Final entry uses separate small recipient and SKIP/ENTER/ASK/MENU questions, with
  only customerUtterance as classification data so the clerk's invitation cannot
  be mistaken for consent. Existing confidence gates are not lowered. Seven
  synthetic Jev contrasts pass, including permission questions and negation;
  phone modal browser cases8 plus existing meal cases2, Menu49, Kiosk45 and
  Server107 pass. Physical microphone/ASR-to-TTS acceptance remains unverified.

- Oct18 owned-menu simple clarification implemented: browser issues a unique
  real-item proposal, host-only kiosk_fast_path_clarify creates a 30-second
  confirm-meal question, and voice/touch consume the same revision-bound ticket.
  YES/NO only resolves that item and continues slot collection; no payment or
  guessed quantity. Jev's subject-switch/fragment path separates service admission
  and purpose; ambiguous recipient stays silent. Confirm-meal uses short YES/NO
  in one call. This replaced an unsuccessful broad new-choice prompt in synthetic
  tests; no confidence thresholds were lowered. Normal price evidence stays on
  its bounded path. Unadded meals suspend/resume with their own slots, including
  returning to an already queued item; reset/clear/checkout revoke confirmation.
  Repeated unclear replies stop speaking after one repeat, keeping controls.
  Agent writes cannot bypass an active meal confirmation. New standalone copy
  lives in packages/i18n/src/orderingMessages.ts. Synthetic Jev contrasts and
  touch browser tests passed; real customer histories were not exported.
  Physical kiosk/complete ASR-to-TTS acceptance remains unverified. No new
  dependency, model changes, commits, or full-project typecheck.

- Oct18 welcome modes: existing effective `proactiveVlmEnabled` now selects
  fixed (false) or VLM-generated (true) welcomes, exposed as an explicit admin
  selection alongside its text under **互動體驗 → 開場招呼**. Device overrides
  keep precedence. The selected bank is shown; switching preserves unsaved text.
  Fixed bank and VLM guidance remain independently editable/retained.
  Profile `greetingPhrases` contains 1–50 spoken openings, 500 characters each;
  shared Server/editor constraints show an inline count and block invalid saves.
  A reported 12-phrase save reproduced the former five-phrase limit; its original
  payload was restored to the local draft only, without publishing. Profile
  persistence/boundary tests21 and welcome editor browser tests3 pass.
  Dashboard content editing/publication retains them. Unset uses localized
  generic openings. Kiosk prepares entry/menu audio sequentially and reuses a
  scene-owned in-memory bank across visitors; locale/phrase/device changes or
  disabling/VLM selection/unmounting abort prior preparation. Reload after Server
  TTS changes. Fixed entry welcomes append optional-phone/skip guidance. VLM
  welcomes use the current frame, published `greetingPrompt` and entry/menu phase
  through assistant-actions. Neither mode appends recommendation invitations;
  reminder image policy remains controlled by the same setting.
  Entry/menu/question guards are checked before session start and again after
  cold TTS; real touch cancels proactive work. No persistent/offline audio cache.
  The local test Site has a new immutable release with three 周氏蝦捲 openings;
  its other published settings and prior drafts were preserved. Existing Kiosk
  tabs need reload to fetch this assignment and prepare audio. Current effective
  policy remains fixed on all local test devices; no mode settings were changed.
  Fixed/cache/turn/recording tests31, Server route tests28 and the admin mode
  selector browser tests2 pass (including retained drafts/template banks);
  Server/Web/Kiosk scoped types and changed-file
  lint pass. Prior Profile persistence tests19 and real Vite transforms passed.

- Oct18 ordering presentation now animates before opening the item dialog and
  uses the actual visible item identity to avoid replaying its selection after
  quantity/options answers. Review entry animates **查看訂單** before opening
  fulfillment controls; existing review/checkout reads preserve their surface.
  Synthetic runtime regressions70 and Menu scoped types pass; live Jev/voice
  replay was not performed for this presentation fix.

- Oct18 owned-menu kiosk test: optional phone entry/explicit skip precedes ordering;
  `customer_entry` phase/screen and `customer_skip_phone` support both Jev and
  Main Agent; skipped phone stays absent and host reset restores entry. Invoice input has
  mobile/citizen carriers, tax ID and donation, no paper or timeout donation.
  Donation is now an explicit **略過，捐贈發票** action: touch/Jev/Main Agent
  proceed to payment selection without code input and clear prior personal
  invoice identifiers. Actual recipient/issuance belongs to the future POS
  integration; this fixture does not invent a code or claim an issued invoice.
  Donation/checkout/question regressions74 and embedded mock-payment browser
  cases2 pass (carrier and skip/donation); Menu scoped types and changed-file
  lint pass. The prior label-only change left the code-required state unchanged;
  the domain transition now advances directly, and donation has no input form.
  LINE Pay/街口支付 selection is separate from explicit mock payment. Default
  dev runner uses after-order table binding in Bridge and simulator; reservation
  policy remains separately testable. Accepted test dine-in receipts issue an
  in-memory 30-minute bearer continuation; QR and desktop link share its URL.
  Phone confirms fixed demo A08 after simulated scan; neither UI has a table
  picker. No real camera/POS membership/invoice/payment/robot integration.
  Native-camera tab handoff uses an expiring same-origin pending capability.
  Paid acceptance immediately notifies the embedding host: configured reward/
  survey and a separate continuation QR/link share the completion screen.
  Standalone menu retains its receipt until acknowledgement. The transient
  continuation URL stays outside archived order metadata and clears on session end.
  Jev common scope admits assistant identity/capability questions; plain Agent
  side replies revoke old answer tickets via host-only interruptsQuestion.
  Checkout model context excludes prior chat, preserving durable history and
  current structured cart/browser evidence. Third-party DOM hiding is deferred.
  Focused tests: menu73, Bridge33, Server126 (2 skips), Kiosk54 pass;
  four affected package typechecks and changed-file lint pass. Expanded menu
  suite retains the known recommendation-title mismatch (107 pass/1 fail).
  Browser verified phone entry, both payment brands, QR/link continuation,
  cross-tab table scan confirmation and refresh after binding. Live Jev/model
  and physical-device acceptance remain unverified; no full-project typecheck.
  Reward timing regression reproduced before the fix and passes with the actual
  embedded menu + isolated test payment Bridge. Lifecycle/session tests15 and
  Menu/Kiosk/Web/StageShared scoped types plus changed-file lint pass. Both hosts
  validate the shared interaction-lifecycle envelope; deploy with the updated menu.
  Kiosk/Web Vite now use StageShared package exports, without the old prefix-to-src
  alias. Actual dev-server lifecycle imports reproduced500 before and return200
  after this fix; Vitest alone did not exercise those app-specific aliases.
  Optional-entry regressions: Menu65, Server38, browser2 pass; Menu/Server/Kiosk
  scoped types and changed-file lint pass. Active Jev correctly selected the
  synthetic phone-skip candidate. A synthetic no-history recommendation replay
  used three segmented provider calls (route/filterRequirement/filterPresence);
  keep provider round-trip measurements separate from UI/animation latency.

- Oct17: master now includes the three existing WebMCP commits from
  `to_damai_website`: object-input native API, iframe lifecycle/geolocation,
  and health-check admission. Host and own menu must deploy together. Services
  without the version/challenge probe remain manual-only; there is no generic
  cross-origin DOM automation bridge or automatic retry of ordering writes.
- Remaining work is grouped by behavior: per-provider Main Agent Thinking
  (migration0046, OpenAI-compatible chat only); exact POS category validation;
  Main Agent/customer control handoff with retained settled receipts and distinct
  failure reasons; third-party iframe loading diagnostics; research documents.
  Runtime/setup contracts live in the affected app READMEs.
- Browser evidence: user confirmed physical clicks in Firefox responsive mode
  at1080x1920 with MaiFood. Chrome155/macOS15.5 Device Toolbar cross-site iframe
  input remains unresolved: native coordinates sometimes reach parent IFRAME
  while child receives none; stable rect samples and outer DOM hit stack do not
  establish compositor routing. Device Toolbar OFF with DevTools ON works.
  Minimal wrapper overflow change helped only the minimal reproduction. No
  high-z-index/fixed workaround was shipped; no Windows Edge/hardware acceptance.
  Further browser tests must use trusted coordinate/physical input and isolated
  fixtures; do not inspect the user's Google meeting or submit another order.
- Validation for this batch: Server87, Kiosk recording18/presentation11, menu21
  and Python HAR analyzer5 tests pass. Server, Kiosk and menu scoped typechecks
  pass. Commit hooks run
  changed-file lint. Full repository lint/typecheck from the earlier attempt did
  not complete; do not report a clean full-project gate. Prior broader menu tests
  had known failures (see existing validation notes), not repaired in this batch.
- The System One behavior discussion and model options remain proposals, not
  approved production behavior or measured improvement. Keep frozen experiments
  separate from current application acceptance. Temporary browser target/session
  IDs and raw diagnostic paths are deliberately omitted here.

- Oct9 cross-machine Git baseline saved as four local commits on master, no push.
  User authorizes separate local snapshot commits despite recorded check failures.
  Completed: be4e15c IME (2 files), 68fcf84 Ollama (6), 010bc24 Kiosk (144).
  Fourth group preserves benchmark/evidence (114 files including lint scope config);
  find its hash with git log. No separately packaged portable export yet.
  Installed pre-commit hook runs nano-staged/moeru-lint --fix. First three groups
  used the normal hook. User requested the last group be committed without changing
  data; its hook is skipped for this invocation only, preserving frozen input/result
  bytes and recorded hashes. Global hook configuration unchanged. Do not silently
  format or regrade frozen evidence. No new branch; unused earlier codex baseline
  branch points at22603c2. Remote state not refreshed; no external writes.
  Snapshot preparation repaired diagnostic test assertions against unknown trace,
  screen location, and ASR cart fixture fulfillmentMode, without weakening runtime
  contracts or changing decision behavior. Server and Menu scoped typechecks pass.
  Root typecheck was run twice; second exposed the subsequently fixed ASR fixture,
  not rerun globally. Server selection123pass/6 opt-in skips, Ollama9pass,
  Kiosk116pass, MenuServer30pass, ASR diagnostics10pass/2 opt-in skips.
  Server experimental timeouts under concurrent heavy checks did not recur in the
  sequential rerun. Full Menu suite458pass/156skip/2fail: recommendation title
  expectation and historical resolver query-to-add probe. Keep failures visible.
  Root lint16060 errors included12861 ignored Python dependency errors; scoped
  ignores reduced last measured count to3199, mainly old scripts/frozen inputs/docs.
  Local downloaded models now also ignored, not remeasured. Not a clean release.
  Temporary browser attachments ignored, maintained screenshot baselines committed;
  heuristic key scan has no matches, not a privacy audit. Portable export package
  still planned. Group manifest/logs /private/tmp/airi-git-preparation.3x3Cdy/.

- Oct9 user-authorized retry of four interrupted tool-agent cases COMPLETE,
  separate from first-attempt scores. Fresh synthetic runtimes, same Google26B,
  dataset/prompt/recorded production hashes, guard and max4 rounds; no tuning.
  a03 query/noadd, a04 bento1, a15 correctsecond bento1 complete; no provider/tool
  errors. a11 retains full replace plan but executes cart_get/remove/menu_get/
  cart_get, reaches4-round cap with emptycart and no beefADD/finalreply: partial
  change, not proof more rounds cannot finish. Completion/atomicity seam remains.
  No extra party/mode/payment changes; a15 rawfinal has thought, Host/UI untested.
  Original48 first attempts/four interruptions and missing a04 receipts retained;
  do not pool retry into original scores or infer restart caused improvement.
  results/assistant-gemma4-retry-oct09{.jsonl,Summary.json}, report retry section.
  USER_RETRY=1 metadata only, human-approved fresh-run subset, no automatic replay;
  README documents this exception. 9offline controls/lint pass, live recorder10pass
  is not model4/4 completion. No full typecheck, production writes/customerlogs.

- Oct9 Gemma actual-prompt/tool comparison ALL48 PAIRS ATTEMPTED, NOT ADOPTED.
  First attempts: frozen16 synthetic turns/3arms, no retries/rescoring: Jev front16 settled/
  6 automatic non-safeOnly completions, proposal16/9, actual-prompt tool agent
  12/6 plus4 infrastructure interruptions. Two safety-only cases per arm excluded
  from completion, not accuracy or full deployed pipeline comparison. a09 two
  meals: Jev ADD.8661 -> two-item OR clarification; proposal/tool agent add both1.
  a06 aside then 一位 succeeds all3; agent 改兩份/改內用 succeeds, no extra changes.
  a05 all3 actualnextbatch; a16 UNKNOWN answered honestly, no invented dish.
  Repair a12 fails all3: Jev INCOMPLETE; proposal ADD/nullqty -> reasks quantity;
  agent reasks consent despite prior explicit1. Agent a10 no mutation but binds
  eel's cilantro condition to beef; proposal blocks all unsupported conditions.
  Proposal4 schema rejects (3root arrays/1empty requirements), plus summaryCount/
  contextual flag issues. Agent a13/a14 reply without tools, not silent; UI not
  tested. a05 same-turn newreceipt IDs reenter no-repeat prompt; long thought
  debates ambiguity, finalbatch correct; no causal prompt ablation/fix.
  Actual createKioskRoutes prompt/tool history + scratch development PGlite,
  real Menu invokeForAgent, max4 rounds. No browser/Host task-constraint lifecycle/
  POS/payment; proposal binder experimental/non-atomic, Jev no Main continuation.
  Explicit stored Google26B profile read-only, models/gemma-4-26b-a4b-it; active
  production chat remains gemma4-31b on amdllm.iservmeta.net. No production writes,
  customerlog transfer, prompt retuning/model switch. a03 Oct8 scratch500 cause
  unknown; a04 Oct8 connecttimeout has missing execution receipts, never infer
  its cart. Oct9 a11 connecttimeout onlycart_get, oldbento preserved; a15 Google
  HTTP500 after correctsecond-item menu_get, cartempty. Failures retained.
  46successfulGoogle/3failedgeneration/49preflight +20Jev; recorded quota wait
  1453.09s distinct from251.99s successful generation. Per-turn tool mean14.19s
  generation vs106.95s wall (12settled only); not production performance claims.
  Provider24RPM/12.8K reservedTPM, countTokens serialized proxy+512+1536output,
  no globalRPDledger. Initial CASE_IDS/MODES select unmeasured pairs; batches separated
  by >60s quota window. Raw source hashes retained; report/commands existing
  test_prompt/turnClassifierPoc/{report,README}.md, results assistant-gemma*-oct09
  plus Oct8 profile/rest. Tests apps/server/tests/experiments/assistant* and
  summarizeAssistant.ts. 59offlinepass/1liveskip, changed-runner lintpass; no full
  typecheck. Do not integrate from tiny frozen16 or add more same-model gates.
  Next seam is whole-demand/source/condition ownership + authorized demand vs
  actual receipt reconciliation + explicit per-demand completion/clarification/
  failure contract, validated on independent holdout. Not implemented; proposal
  necessity/Main Agent or Jev replacement remains unproven.

- Oct8 Fast Path off/provider fallback IMPLEMENTED. Kiosk reads authenticated,
  uncached interaction-decisions/status every turn before candidate/direct
  resolution. No active profile -> SYSTEM_ONE_DISABLED handoff; unhealthy active
  profile stays enabled (normal readiness recovery). Jev PROVIDER_FAILURE and
  decision transport rejection -> same guarded Main Agent flow, retaining
  original utterance, pending question, session/history and completed read
  receipts. Semantic uncertainty/IGNORE/INCOMPLETE/clarification remain distinct;
  browser execution failures still require checking screen, never mutation replay.
  No prompts/models/new WebMCP tools changed. Changes apply next turn, not
  retroactive cancellation. Core locations existing kiosk-fast-path.ts,
  kiosk-device.ts, KioskScene.vue and server kiosk/system-one modules.
  Scoped Vitest63 Kiosk +39 Server pass; changed-file lint and Kiosk vue-tsc
  pass. Diagnostic test typing blockers were repaired during Oct9 snapshot
  preparation; Server-scoped typecheck now passes. No browser E2E or live model
  tests during snapshot preparation; see current state for global check limits.

- Oct8 real decision + candidate partition comparison COMPLETE, REJECTED.
  New44 synthetic turns/11families,88 paired modes,129HTTP, all measured with
  openjev/Qwen/Qwen3.5-4B. Existing decideInteraction/code-default prompt + real
  isolated Menu resolver/compiler/guard, NOT saved merchant prompt/host lifecycle.
  Test-only7-group route then finite leaf at.60; no extractor/reviewer/new tools.
  Contract17/44 baseline vs13/44 partition; UNAVAILABLE8 vs28; bothrepair0/4 and
  compoundhandoff0/4. Mean5724.3 vs2535.1ms,57 vs72HTTP; faster often means early
  refusal, not equal completed work. p29groupCHANGE.911/ADD.8309 -> two-meal OR
  clarification; p31group.9103/REMOVE.7478 deletes old bento, never adds noodle.
  p24candidate absent for 總共一個人而已; preserve as parser finding.
  Raw wrongMutation5/2 includes configuration/clarification phase changes;
  receipt audit actual partial cartchanges2/1, wrongpreparation3/1. Background
  rawadmission1 is INCOMPLETE assent, not proven UI/Main admission. p07 gold
  SEARCH vs SELECT ambiguous, but observed ADD preparation wrong either way.
  Screenunknown/artificial5-item menu/saved overrides untested; not production
  accuracy or general4B-size proof. Scoped tests6offline/7live recording controls
  pass,4TS lint pass; no full typecheck/productionwrites/customerlogtransmission.
  Files apps/order-menu/src/experiments/partitionDecision.ts,partitionScenarios.ts,
  partitionReplay.test.ts; command/config README; frozen raw/summary/audit at
  test_prompt/turnClassifierPoc/results/partition-frozen44*. Report existing
  test_prompt/turnClassifierPoc/report.md Oct8 partition section. No tuning or
  integration. Next substantive seam: whole-demand/each-demand completion
  contract; if testing Gemma again use actual Main Agent prompt+isolated tool
  loop, not prior new extraction prompt. Do not add more same-model gates from
  this negative result or silently treat assistant handoff as completed service.

- Oct8 missing-dish complaint reconciliation remains PARTIAL. Attachments600f4a56
  /a6f483f0 retained original multi-dish dialogue, beef alias evidence, pork-only
  cart and fulfillment question. Oct18 now recovers the weak INCOMPLETE family;
  corresponding fixed-choice cases are permanent regressions, not live complaint
  accuracy evidence. A low-confidence ADD (.2836) still refuses safely, and no
  per-demand completion ledger reconciles all requested versus added dishes.
  Do not infer missing items were added, lower mutation thresholds or repair the
  cart from a mention. Live multi-demand complaint recovery remains unverified.

- Oct8 Gemma4 26B extraction follow-up COMPLETE, NOT ADOPTED. Explicit test-only
  override `models/gemma-4-26b-a4b-it`; same frozen40-case prompt/gold hashes as
  prior Gemini, reordered compound/context first, output cap2048. All40 HTTP200;
  34 schema/evidence valid,18 strict exact; compound5/6; mean4431.7ms/P957884.9ms
  excludes token preflight/pacing. Six format failures =5 root arrays +1 empty
  requirements. True risks: checkout「好」->CHAT, 我想吃便當->RECOMMEND loses
  category, bento queries lose target scope, duplicate REMOVE+REPLACE. 一位
  recognized PARTY_SIZE1 but contextRequired false. Other mismatches include
  annotation/flag ambiguities; audit at
  test_prompt/turnClassifierPoc/generativeRequirements-gemma4-26b-pacedReport.md.
  No frozen regrading/tuning or model superiority claim (Gemini only9cases).
  Quota RPM30/TPM16K/RPD14.4K: experimental requestBudget admits24RPM/12.8K input
  TPM via countTokens+128 reservation.80 measured calls incl40preflights, no429;
  actual40,324 input/5,356 output,43.9s pacing.11,520 per-run cap is NOT global or
  persistent RPD ledger; other project traffic/daily remaining unknown. Live
  catalog/pilot precede run.49 targeted tests, scoped lint, strict pure-budget
  typecheck pass; no full typecheck. Runner requires explicit Gemma override
  rather than assuming its quotas for Gemini. Production Gemini/Jev prompts,
  model/session/menu/tools/flows unchanged. Next: sharpen generic proposal/atom
  contract + independent application binding, not direct production integration.

- Oct8 independent generative requirements experiment PARTIAL, NOT ADOPTED.
  Active profile + compiled chat are `models/gemini-3.5-flash` at Google's
  compatibility endpoint. New advisory-only extraction prompt/schema and40
  frozen synthetic cases/50 demands; no gold/menu/customer logs/tools sent.
  Full schema and nullable-union attempts HTTP400 before inference (exact field
  cause unknown); minimal chat/schema probes succeed. JSON-object run received9
  valid outputs before g10 HTTP429 and stopped without retries/key/model changes.
  All9 effects/counts correct, frozen strict-field match4/9; manual audit finds
  g05 gold omits explicit query quantity1 and other mismatches are annotation
  ambiguities/redundant query tags, not proven unsafe operations. Core compound,
  delayed party-size, replacement, retraction cases remain UNMEASURED: no model
  or architecture conclusion. Source of truth:
  test_prompt/turnClassifierPoc/generativeRequirements-json-objectReport.md;
  raw JSONL/summary preserved.45 offline evaluator tests + scoped lint pass;
  full typecheck not run. Isolated modules at apps/server/tests/experiments;
  README documents opt-in command (reruns40, NOT resume), unique artifact labels,
  provider stop rules and credential isolation. Production flow/prompts/models,
  menu, session and tools unchanged. Next: clarify provider availability and
  independently tighten annotation contract/gold before future held-out tests;
  do not regrade or tune frozen run to claim improved accuracy.

- Oct 8 還是內用好了 DIAGNOSED, NOT FIXED. Attachment1842461e follows
  dine-in -> takeout -> checkout-entry question; dine-in candidate is present.
  Jev route incorrectly selects start-checkout .4665; concrete checkout relation
  incorrectly selects defer-question .3911. Relation confidence<.6 correctly
  returns UNAVAILABLE/UNCERTAIN_OPERATION, preventing wrong execution but losing
  the intended fulfillment change. History remains in supplied trace. Minimized
  replay without conversation reproduces; correct dine-in route .95 goes FAST in
  one call. Correcting only relation to NEW_REQUEST .95 still hands off, as in
  the prior beef-noodle recovery finding. fulfillmentDiagnosis.test.ts has3
  passing diagnostic controls; expected recovery probe is known red under
  KIOSK_FULFILLMENT_DIAGNOSIS=1. No production/prompt change or live provider call.

- Oct 8 multi-meal clarification DIAGNOSED, NOT FIXED. Attachment fedc8278
  begins with 對 AFTER original three-meal utterance became item-clarification
  (pendingIntent ADD_ITEM). Display says 您指的是炸排骨便當、紅燒牛肉麵？
  but legal choices are pork OR beef OR cancel, not both. Captured route selects
  pork .8694 and concrete relation repeats pork .7259; Server trusts it and
  runtime resolves/executes only that one target. Full original utterance remains
  in history: not evidence of lost context. Missing initial decision trace means
  initial Jev misrouting is NOT confirmed. Reconstructing the observed ADD path
  with real simulator catalog reproduces the same question and one cart line;
  minimized 牛肉麵一碗，還要一個排骨便當 does too. UNCERTAIN relation control
  leaves cart empty. clarificationDiagnosis.test.ts has3 passing diagnostics;
  expected-safe collective-yes probe is known red under KIOSK_CLARIFICATION_DIAGNOSIS=1.
  No production/prompt change or external provider call; omitted eel/options have
  no execution evidence in the supplied trace.

- Oct 7 有水餃嗎 UNCERTAIN_FILTER DIAGNOSED, NOT FIXED. Attachment
  73501877 has empty history/no question, exact 水餃 reference, correct SEARCH
  route .9657 and COVERED .9523. NO_FILTER probability .746 is not its confidence
  .4919; the final filterPresence guard requires confidence>=.5 and hands off
  NEEDS_ASSISTANT even for this plain dish query. Minimized public decision replay
  retains the symptom without screen/history/other candidates. Holding choices
  and probabilities fixed, .4919/.4999 hand off and .5 passes SEARCH. Three local
  diagnostic assertions pass; expected-safe query remains known red under
  KIOSK_FILTER_DIAGNOSIS=1 in filterDiagnosis.test.ts (run separately).
  Actual trace has 3 sequential provider calls totaling~6.9s; local decision mock
  batches condition questions, so modelCalls differs while modelQuestions=3.
  No production/prompt/threshold/session change and no live provider call.

- Oct 7 牛肉麵一碗 NEW_REQUEST handoff DIAGNOSED, NOT FIXED. Attachment
  9b8c37b5 includes exact beef-noodle alias evidence and ADD candidate, screen
  menu. Jev first selects dine-in .2975; concrete question relation chooses
  NEW_REQUEST .6718, and questionEffect returns NEEDS_ASSISTANT directly rather
  than recovering the independent ADD route. Minimized local replay without
  dumplings/history still reproduces; first-route ADD .95 control passes.
  Opt-in expected-safe probe: KIOSK_NEW_REQUEST_DIAGNOSIS=1 in questionRouting.test.ts
  remains known red. The quoted no-verifiable-menu reply comes from host
  current-turn receipt grounding; its unfinished suffix means Agent send returned
  incomplete (rejection, exception, deadline/limits or duplicate calls can do so).
  No Agent tool/result trace supplied, so exact downstream cause unknown. Do not
  blame the dumpling screen, invent execution success or clear old questions.
  This task only changes Kiosk idle trigger to180s; confirmation remains15s and
  continuing retains all session context. Kiosk27 + Server14 focused tests pass;
  expected-safe diagnostic was separately run red. No live provider replay.

- Oct 7 post-500 ASR stall REPORTED, NOT REPRODUCED OR FIXED. User sees later
  ASR text but no decision requests; failed endpoint/body not yet supplied.
  Two new local probes cover queued handler rejection and queued runFastPath
  decision rejection: later ASR still reaches decision (including after idle).
  These exercise the queue/Fast Path, not the full KioskScene lifecycle; do not
  claim the incident is fixed or that all host waits release. Asked for failed
  request URL/body and following browser/server state. No production change,
  session reset, context clearing or live provider call.

- Oct 7 System One service scope and low-confidence handoff IMPLEMENTED.
  Initial NEEDS_ASSISTANT/MULTI_ACTION/FOLLOW_UP_ACTIVE require finite numeric
  confidence in [.6, 1], otherwise UNAVAILABLE/UNCERTAIN_OPERATION before any
  invitation supersession. Attachment 7e0c1850's raw MULTI_ACTION .2911 is now
  a regular passing regression; traces keep the original answer. Already-admitted
  read-result reviews retain their distinct handoff policy. Prompt/criteria now
  constrain assistant requests and compound actions to ordering service;
  unrelated unfinished discussion is IGNORE, not INCOMPLETE. A fixed scope rule
  follows editable/store instructions without rewriting saved policy and also
  applies to active-question routes. No extra classifier, forward, lexical gate,
  tool, UI, ASR/FIFO or session cleanup change. Server177 + Kiosk60 relevant tests,
  Server typecheck and scoped lint pass; no root typecheck. Eight synthetic live
  contrasts added under KIOSK_SYSTEM_ONE_REPLAY_URL but NOT RUN/exported.
  HIGH-CONFIDENCE OFF-TOPIC MISCLASSIFICATION IS NOT PROVEN FIXED: fb20874f
  (.8784) and 2c567045 (.6155, empty history/no question) still demonstrate that
  reliable-looking scores do not prove relevance. Frozen-provider expected-safe
  probes remain opt-in known red under KIOSK_OFF_TOPIC_DIAGNOSIS=1; they cannot
  measure the changed prompt's real accuracy. Do not claim a Gemini defect or
  fix this by clearing session context or adding same-model review untested.


- Oct 7 ASR dish typo DIAGNOSED, NOT FIXED. 蕉麻雞便當來一份 discovers
  椒麻雞便當 only as fragment 麻雞便當; possible evidence suppresses ADD before
  Jev. Real simulator has no 蕉麻 alias; raw menu_get typo returns no items while
  canonical query works. Test-only alias restores exact/ADD; adding 咖哩雞便當
  yields two fragment candidates, so discovery is not correction authority.
  Displayed-item, selected-item and recent-cart context controls still suppress
  ADD for the typo, isolating candidate gating rather than absent context.
  Oct 7 排骨的一份 trace has the recommendation dialogue but only fragment 排骨
  and no ADD candidate; Jev chooses INCOMPLETE despite its completed-demand rule.
  Presentation/no-presentation controls both suppress ADD. A fixture-only 排骨
  alias restores ADD and parses quantity 1, isolating target evidence gating;
  this does not establish how live Jev would choose with corrected candidates.
  asrNameDiagnosis.test.ts:10 local diagnosis assertions pass; known-red expected
  order-candidate tests gated by KIOSK_ASR_NAME_DIAGNOSIS=1. No production change,
  external transcript export or live Jev test; cannot claim observed model choice.

- Oct 7 price-qualified reads implemented through existing SEARCH_MENU/RECOMMEND
  and menu_get/menu_recommend, no new intent/tool/classifier/review layer. Menu
  pricing owns integer single-dish bounds, exclusivity, ASC ordering and literal
  finite evidence; shared wire types are server priceContracts (no tsconfig hack).
  Browser validates priceChoiceId from one-use context; Server asks optional price
  with existing read conditions, retaining thresholds. Appended capability rule
  applies to saved prompts without database overwrite. Price/category/food filters
  intersect before 3-item batches; alternatives retain conditions and seen IDs,
  empty results clear UI, cards keep actual prices without mandatory speech.
  Agent task bounds cannot widen; unresolved/approximate/relative/total budgets
  clarify, with read/mutation guards. Focused mock/runtime/API/host regressions
  pass; six synthetic priceReplay provider cases remain opt-in, not accuracy proof.
  Ordinary questions/cart/session lifecycle retained. This does NOT fix the
  separately recorded Jev fresh-vs-more semantic misclassification below.

- Oct 7 Stage Kiosk text mode now has only the simulated-ASR input; the duplicate
  direct-chat composer/events/styles were removed, not Agent escalation/retry.
  Browser regressions cover single input, forwarding and unchanged voice-only
  mode plus IME behavior (12 passed with VITEST_BROWSER_CHANNEL=chrome).
  Stage Kiosk package typecheck and scoped ESLint pass; no root typecheck.
  Browser config uses the production Info plugin for shared build metadata.
  User clarified completion CAN reset: confirmed
  completion clears chat/menu/customer after the existing completion screen
  finishes. Explicit new-order/staff reset still clears. Unconfirmed or repeated
  old completion dismissals cannot reset an active next-customer session.
  Actual Menu accepted-order -> host completion -> runtime reset regression,
  continue/new-order and approved-origin tests pass (Kiosk13); Menu7 focused
  submission/confirmation tests pass. No Jev/prompt/tool/payment-policy change.
  Attachments 3c641513 (水餃再一份好了) and bc54ac01 (略過 membership,
  UNCERTAIN_OPERATION) do not contain a successful submission receipt.

- Oct 7 repeated alternatives DIAGNOSED, NOT FIXED. Attachment196c07ec says
  還有其他推薦嗎; previous batch/dialogue + recommend-more candidate are present,
  but Jev chooses recommend confidence.942 (.9454 vs more.0182). New recommend
  compiles without more and resets seenIds, reproducing dish0/1/2 with recorded
  finite answers against synthetic real runtime. No customer trace exported.
  Opt-in known-red test in recommendationFlow.test.ts via
  KIOSK_RECOMMENDATION_DIAGNOSIS=1 (see decision-review9.1); default14 batch tests
  pass. New artificial live 無cart「還有沒有其他推薦」passes once, NOT customer fix
  or evidence error is impossible. Formal route/prompt/model/tools unchanged;
  no automatic semantic-review layers or threshold changes. Customer trace lacks
  execution receipt; local replay proves mechanism, no live DOM claim.

- Oct 7 candidate-blind requirement PoC completed; NO production integration.
  `requirementScenarios.json` freezes26turns/32hypotheses (24new wordings plus
  n13麵一碗/n16一位 known regressions). Extractor sees utterance, dialogue and
  question TEXT only; no menu/candidates/plans/targets/slots/classifier. Five
  finite questions: first/second effects, count, information, reference. Two-atom
  capacity is bounded; multi/overflow/contextual/unknown requests refer.
  Real4B57HTTP/0failures:26blind+31unchanged matched reviewer calls. All26 profiles
  INCONSISTENT, exact0/26;24repeat first as second, NONE never chosen for second;
  all5multi turns countedONE. No usable coverage/false-admit0 is NOT success.
  Blind mean4181ms/P95=4532ms; matched reviewer2494ms/P95=3292ms, falsely accepts9/19
  unsupported hypotheses and retains12/13 supported. Do NOT silently deduplicate
  repeated effects: n22 genuinely has ADD+ADD. n13 firstADD correct but inconsistent
  second; n16 receives retained question yet firstREFERENCE, not lost session data.
  Published lookski core.py includes instructions and independently answers each
  question against unchanged state, no shared extraction/dependency; deployed
  commit/backend not inspected. Both model/task fit and ontology/prompt remain
  confounded; this rejects this extractor, not all layered architectures.
  Offline40passed/26guarded skipped, live66passed (harness, not accuracy), Menu
  typecheck/scoped ESLint and summary/fingerprint checks pass; no root typecheck,
  prompt/threshold retuning, new deps/settings/restart/tools/payment/commit.
  PoC report phase4/raw+summary/README are source of truth. Stop here; any further
  extraction design comparison needs another independent test, no auto integration.

- Oct 7 isolated effect/whole-request review completed; NO production integration.
  Frozen32 synthetic good/bad hypotheses (not classifier predictions) reuse real
  resolver/compiler/guard via `apps/order-menu/src/experiments/effectCoveragePoc.ts`.
  Six finite diagnostic outcomes cannot produce target/slots or execution rights.
  Jev Qwen3.5-4B29HTTP/0failures; fixed threshold.60 falsely promotes9/18 bad
  hypotheses, retains13/14 good;3preflight rejects included in bad rejection9/18.
  Same price question approves both SEARCH(.9793) and ADD(.9679); compound partial
  effects also approved above.95. Four unknown ingredient/nutrition queries safely
  referred, but this does not establish general safety. Additional HTTP mean5270ms,
  P95=6848ms; no upstream decision or production latency measured.
  Same-model approval layer REJECTED for adoption; no prompt/threshold retuning.
  No cart writes/tools/payment; fresh-revision and separate payment-confirmation
  tests hold. Live79tests passed means runner contract, NOT semantic accuracy.
  Offline47passed/32guarded skipped, Menu typecheck and scoped ESLint passed.
  See PoC report phase3 and raw/summary artifacts; no root typecheck/commit.
  Candidate-blind follow-up is recorded above; still not authorized for production.

- Oct 7 independent resolver challenge completed; NO production integration.
  `test_prompt/turnClassifierPoc/resolverScenarios.json` freezes40 new synthetic
  contexts; `apps/order-menu/src/resolverPoc.test.ts` reuses real Menu runtime and
  Server finite decision interfaces in memory, with no POS/payment gateway.
  Frozen/SetFit checkpoint+validation temperatures unchanged, both29/40 turn labels.
  Real Jev40/55HTTP/0provider failure, semantic mean5292ms; not eight-class latency.
  Original raw summary retained; separate audit excludes r23 (identical dumplings
  merged, intended multi-line fixture never established). Other39 yield19 effect
  matches, not request-completion/production accuracy. Two wrong draft/clarification
  phases, no claim of accidental cart additions in these live cases. Forced wrong
  query→ADD and compound→single ADD tests prove legal target/slots cannot repair
  semantic mistakes. Stale-revision/payment-confirmation guards hold; query+55s
  idle→一位 works, but 總共一個人而已 has retained question and missing numeric slot.
  Experimental read-only singleton bypass REJECTED: SetFit .70 accepts3/39 but
  peanut question only returns dish name; .80 still accepts it, .90/.95 accepts0.
  No finite topic match is not proof of complete request coverage. Projection
  effect-match gain20/39 is that unanswered fact query, not a quality improvement.
  Contextual referrals still use finite Jev; independent Reference Resolver is
  NOT implemented. Full raw/audit/report in PoC; no retuning/production exports/
  settings writes/restart/customer export/commit. Live runner135 tests passed,
  subsequent focused offline161 passed/40guarded skipped, Menu typecheck+TS lint
  passed; no root typecheck. Subsequent effect/query-scope/full request-coverage
  experiment is recorded above; still no automatic integration or phrase patches.

- Oct 6 independent Turn Classifier PoC completed at `test_prompt/turnClassifierPoc/`:
  user explicitly requests no production integration. 400 hand-authored synthetic
  utterances, 8x50, frozen240 train/80 validation/80 held-out. Dependency-free Python
  audit/Jev benchmark/metrics/referral simulation runner plus local `runLocal.py`.
  User approved MiniLM frozen head + similarity baseline + SetFit. Isolated Python3.13
  venv/cache/models ignored; root dependency graph untouched, pins and full freeze saved.
  Jev8-class turn-only baseline80 valid,47 correct,macroF1.5742,HTTP mean1682ms,
  P952063ms,raw confidence ECE.1768. NOT production Kiosk accuracy. Outputs/report
  retained in PoC. Fixed seed42/C1, SetFit60 steps, validation-only temperatures:
  frozen58/80,similarity54/80,SetFit59/80; warmCPU1thread~8ms on AppleM4/16GiB;
  fresh-process imports+load3.35–3.85s,peakRSS1171–1214MiB,weights448.81MiB.
  Jev validation80 completes; calibrated test ECE.1243 vs raw.1768, choices unchanged.
  SetFit calibrated ECE.1079; .70 mixed class error27.5%/projected1000ms vs allJev
  41.25%/1682ms BUT2compound turns wrongly domain-referred. .95 accepts11 correct
  labels (4contextual/7nonexecution),ZEROdomain coverage. No model/threshold adopted;
  NOT safe to integrate merely from these scores. Full comparison/reliability/raw
  outputs recorded. Referrals are not oracle-resolved domain operations. Initial
  Python default-UA403 batch retained separately; explicit `airi-turn-classifier-poc/1`
  UA succeeds. Only new artificial speech transmitted; other relevant threads read
  for design/failure families, never exported. No production edits/config writes,
  service restart/root typecheck/commit. See decision-review section12 and PoC report.

- Oct 6 authorized synthetic Jev prompt comparison completed against
  `openjev/Qwen/Qwen3.5-4B`: 26 fixed scenarios, 18 development/8 holdout.
  Frozen reported policy baseline15/26, candidate-only15/26, instruction-only15/26,
  combined13/26. Instruction-only fixed named add but regressed invitation refusal;
  combined also regressed colloquial add. NO proposal adopted or persisted.
  Baseline standalone existence query chose ADD confidence0.8199; isolated runtime
  replay entered configuration/cart0 (not immediate purchase). Some improved read
  routes still stop at UNCERTAIN_FILTER: NO_FILTER0.6213 conflicts with
  beef=INCLUDE0.2644 in a follow-up probe. `apps/order-menu/src/semanticReplay.test.ts`
  preserves opt-in comparisons and full case reports; see decision-review section11.
  Only new synthetic dialogue/menu/state was transmitted, never customer traces.
  Local90 passed/26 guarded skipped; Menu typecheck and touched ESLint passed.
  Live failures remain intentionally visible; no root typecheck or commit.

- Oct 6 finite question answers implemented for eda15e0f「好啊」route0.5289:
  the invitation-specific early confidence gate and generic ANSWER are replaced
  by one concrete-answer check at the existing decision seam. Selected question
  effects resolve current owner-supplied choice IDs or NEW_REQUEST/BACKGROUND/
  UNCERTAIN. Route is a hypothesis; answers can correct consent/refusal and use
  their own confidence >=0.6. Independent route thresholds remain unchanged.
  State/criteria consistently use DECLINE_INVITATION; Server no longer guesses
  party/tax-ID answer IDs from purpose. The existing `relation` key is preserved
  for diagnostics; questionRelation records the questionId and actual choice.
  Uncertainty returns UNAVAILABLE, preserving context without Agent fallback or
  even a guessed deferral. Known independent new demands use the existing handoff.
  Financial/destructive one-use confirmation stays separate. Local runtime tests
  cover retained invitation→55s idle→recommend3/cart0, corrected refusals, slot
  answers and payment-method→confirmation→one payment. Guarded synthetic Jev
  invitation replays were added but NOT run; remote accuracy remains unverified.
  Validation: 239 focused local tests passed (Server128/Kiosk47/Menu64), ten
  guarded live replays skipped; three package typechecks and touched ESLint passed.
  Root typecheck was not run.
  No new tool/UI option, live settings write, restart, customer export or commit.

- Oct 6 question-context routing implemented: d913b030「排骨便當一份」regression
  previously stopped at invitation ACCEPT confidence0.4568 before route (high
  confidence also failed because recommend was not offered). All utterances now
  route first; invitation and ordinary speech/relation pre-gates are removed.
  Only selected question effects validate ANSWER/NEW_REQUEST/BACKGROUND, including
  next-turn party-size/tax-ID slots. Configuration/clarification NEW_REQUEST uses
  the existing one-ticket host reroute without pre-relation. Unfinished speech
  continuation is an optional route, not a compulsory context gate. Candidate
  shaping preserves explicit state-legal operations while blocking implicit meal
  mutation from a bare acknowledgment. No new tool or customer-facing option.
  Invitation acceptance is consumed only after successful decision validation;
  verified independent demands return supersededQuestionId. Scene checks the
  current ticket and invitation ID, retaining answered/superseded history without
  letting later「好」revive an old invitation. Ordinary unanswered meal/service
  questions still survive queries and idle; reset requires successful completion
  or an explicit new order.
  Independent route thresholds, destructive/payment confirmation and revision/ticket
  validation remain intact. Local deterministic provider mocks cover the captured
  error and actual runtime alias/seat/draft flows, including「我想吃麵，一碗」and
  「這裡吃」→query→55s idle→「一位」. Validation: 214 focused tests passed
  (Server105/Kiosk45/Menu64); six guarded live replays skipped. Three package
  typechecks and touched ESLint passed. Remote Jev accuracy is not verified; no
  customer export, live settings write, restart, root typecheck or commit.

- Oct 6 Ollama residency implementation: AI binding compiler sets upstream
  `ollamaKeepAlive: -1` only for Ollama chat/vision profiles; schema preserves it
  and router sends `keep_alive: -1` per upstream attempt, streaming or unary.
  Other providers/fallbacks stay unchanged. Stage UI Ollama provider's prior
  value 1 also becomes -1. Existing persisted Kiosk bindings need re-Apply in
  Webnavior AI after Server loads this code; restarting alone doesn't recompile.
  Latest official Ollama openai.go accepts/forwards this extension, despite older
  docs/issues reporting unsupported. Deployed Ollama version/residency not checked;
  old versions may ignore it, requiring OLLAMA_KEEP_ALIVE=-1 on Ollama itself.
  No preload, service restart, live config write or remote inference performed.
  Validation: 60 focused tests passed, Server typecheck and touched ESLint passed;
  no root typecheck or commit.

- Oct 6 five approved fixes implemented: recording shares finite metadata routes
  (fast_path/execution_failed/unavailable) and preserves questionId; failed ASR is
  diagnostic, not completed dialogue. Proactive actions issue host-owned
  recommendation-invitation receipts, retained through idle until successful
  completion or an explicit new-order reset;
  Menu questions/active Agent/configuration/checkout have priority. Confident
  acceptance selects existing intent:recommend only, no new WebMCP tool/payment
  authority. Main Agent ordering prose is an internal draft; Scene renders all
  distinct same-turn menu receipts and factual base-price comparison, or a safe
  no-evidence message. Cart-only replies use actual cart data. Free-form model
  explanations are not preserved as verified facts; omitted/wrong query filters
  still require investigation rather than blaming the renderer. Runtime person
  count reveals/registers the select and awaits visual cursor before one update,
  with no second DOM click. Pose uses shared configured dwell/empty-reset/minimum
  people policy plus geometry/quality/cooldown gates; one pose candidate cannot
  meet minimum >1. Customer-specific vegetarian trace still unavailable.
  Local red/green regressions, targeted unit tests and four actual Chrome browser
  tests passed. Kiosk/Menu/Server package typechecks passed; touched ESLint checked.
  Guarded live replays skipped; no remote inference/customer export, root
  typecheck, settings mutation or commit. Checkout 「好」 intermittent failure
  remains unconfirmed; correlate its next captured question/decision/tool receipt.
  Greeting-generation latency explicitly remains out of scope.

- Oct 6 effective-settings diagnosis: latest-used device DEV-088065
  persisted v10 resolves to observation/greeting on, presence trigger, 500ms
  dwell, pose_plus_conditional_face, confidence0.8, VLM off. Delegated local
  overrides beat admin pose_only/467ms; audit records the local mode change at
  2026-10-06 05:19:08 Asia/Taipei, not an unexplained default reset. Browser
  current loaded browser snapshot was not inspected. Current source syncs every
  15 seconds; the earlier five-minute note is superseded. Presence trigger does
  not require gaze/face checks. Persisted settings were not changed by this task.

- Same-order retention (Oct 7 corrected idle expiry): Stage Kiosk uses shared
  `resetPolicy: confirmed-completion` with three-minute inactivity and a 15-second
  confirmation countdown. Showing the dialog retains all context; continuing
  cancels reset and preserves the same customer/chat/visitor/menu, pending questions
  and requirement state. Unanswered expiry resets to a new standby chat and ends
  the durable visitor; next activity creates a new customer. Late/premature idle
  callbacks cannot reset a resumed session. Pending work/presence protection unchanged.
  Confirmed completion followed by its screen's
  dismissal/countdown, or explicit new-order/staff action clears customer/chat/menu
  and ends the durable visitor session. Stage Web keeps its default45s+15s policy.
  Host/runtime regression covers continue at194.999s -> retained party question ->
  一位, interrupted order draft, actual expired reset and guarded completion.
  Order Menu read tools/plain replies/defer no longer clear ordinary `waitingFor`;
  repeating the same fulfillment is idempotent and has its existing candidate.
  Question records retain statuses in host-only `questionHistory` until reset;
  same unmet needs rebase on revised state without reviving old execution tickets.
  Recommendation conditions/seen IDs and displayed item focus no longer have an
  idle TTL; catalog changes still require revalidation. Local regression covers
  「這裡吃」→lookup/defer→55s idle→「一位」 and new-order clearing.
  Jev semantic selection has not been replayed remotely; retained context is not
  a guarantee against model misclassification. Browser reload/process restart
  does not restore these in-memory menu records. No customer data exported.
  Validation: Order Menu201 passed/15 guarded live skipped before the final
  focus/batch TTL changes; afterward42 directly affected tests passed. Kiosk53
  targeted lifecycle/recording/fast-path/question tests and both package-scoped
  typechecks passed, as did touched-code ESLint. No root typecheck or commit.

- Oct 6 scope correction: the user requested removal of customization options
  from the menu data, NOT deletion of configuration decisions or ingredient
  conversion capability. The earlier mistaken filter/result/prompt edits were
  restored. The seven-dish JSON now has empty optionGroups throughout; noodles
  remain NT$150, dumplings are fixed at 10 pieces/NT$80 per serving. Quantity,
  configuration tools and safety validation are retained. Configuration tests
  use explicit test-only POS options rather than the active store declarations.
  Reload/restart the simulator/POS Bridge when JSON watching has not refreshed,
  then reload menu/Kiosk for a fresh session. This does not fix the separate
  hallucinated recommendation output gap addressed above. Validation: Order Menu191
  passed/15 guarded live skipped, POS30 passed, both package typechecks and
  touched ESLint passed. No remote Jev replay, full-project typecheck or commit.

- Oct 6 category/name and pending-question fixes are implemented across Order
  Menu, Server decision service and Kiosk Fast Path. `catalogEvidence` separates
  full names, merchant aliases, possible fragments and category member counts.
  Inferred suffix uniqueness no longer grants mutation authority. Category-only
  preferences browse even singleton categories; explicit quantity preserves
  ordering, tested for both 「我要吃麵，一碗」 and 「我想吃麵，一碗」. Category
  clarification displays eligible dishes without selecting/adding one and asks
  「您指的是…？」. The reported per-item repeated 「操作」 was never reproduced;
  user will supply a new occurrence. The known application phrase is removed.
  Configuration/clarification first establish actual-question relation. One
  same-utterance/question-ticket host reroute handles a new request: queries
  retain the old draft, verified new meals replace it without inherited slots.
  A query's own clarification takes foreground priority before resuming the meal.
  Bare exact choice/ordinal shortcuts remain; embedded query words cannot select.
  Same-session idle/continue retains drafts and questions; per-turn 30s/15s
  answer tickets expire without wiping valid context. New order/reset,
  cancellation/replacement and relevant revisions still revoke the demand.
  High-risk confirmation and confidence thresholds are unchanged; the later
  same-order correction above replaces idle auto-end and ordinary-question
  clearing behavior. No new Agent-facing tools, remote Jev configuration changes or
  customer-log export. User says PROVIDER_FAILURE was their resolved network issue.
  Local mock-model/runtime flow and stale-ticket regressions pass; remote Jev
  semantic accuracy has not been revalidated for this change. Reload Kiosk/Menu
  and ensure Server watch has loaded the new code for a fresh test session.
  Validation: Order Menu185 passed/15 guarded live skipped; Kiosk46 targeted
  session/fast-path/question tests passed; Server82 decision/route tests passed
  (25 guarded live skipped). Three package-scoped typechecks and touched ESLint
  passed. No full-project typecheck or commit.

- Oct 5 broad menu exploration is bounded: `SEARCH_MENU` without an explicit
  product/category/food condition compiles to existing `menu_recommend`, max
  three dishes. A valid batch becomes `more:true` with its recommendation
  revision; filters/budget/strategy and seen IDs persist, batches replace rather
  than accumulate, and exhaustion never recycles. Broad reads have no extra
  recommendation continuation. Explicit searches retain `menu_get`; its Agent
  default/display:true broad reads apply the same policy, while display:false
  permits internal full-catalog lookup. Broad presentation cannot escape checkout
  or payment locks. No new tool, candidate ID, button or Server/Jev prompt change.
  Reload Order Menu + Kiosk. Local validation: Order Menu172 tests, Kiosk32
  relevant flow tests, Order Menu typecheck and touched-code ESLint passed;
  existing native-listener warning remains. After explicit approval to send
  simulated catalog/runtime state and artificial dialogue to
  openjev.aikcitri.qzz.io, one live three-turn regression passed (3/3/1, no
  repeats or continuation). This is fixture coverage, not whole-UI acceptance.
  No customer history was exported, no root typecheck or commit.

- Oct 5 bounded catalog shaping now caps model targets/clarification at five;
  overflow hands off, never top-N selects. Order Menu keeps exact names distinct
  from literal-fragment possible products and ingredient mentions; possible
  products only become read queries after finite product/filter interpretation.
  No new mutation authority or fixed extra question. Existing condition gate
  distinguishes product/filter/both/uncertain, and skips polarity forwards for
  product lookups. Combined/uncertain requests hand off intact. Final read review
  contrasts original speech, tentative understanding and actual results;
  SATISFIED (confidence >= .6) maps to COMPLETE, DEVIATED/UNCERTAIN hand off with
  receipts but without rejected mandatory filter authority. No automatic restart.
  New 7/50/200 catalog, runtime and handoff regressions cover the policy. Two
  artificial live OpenJEV cases passed (product query, single-dish drift review);
  broader semantic/whole-UI acceptance remains unproven. Restart 5168 Server and
  reload Kiosk + Order Menu; no remote model change or commit.
  Validation: Order Menu163 tests/14 guarded skips, Kiosk89, Server scoped77;
  three package typechecks and touched-code ESLint passed. Final bounded-result
  preview change passed51 relevant Order Menu tests. Existing listener warning
  remains; no root typecheck or whole customer UI acceptance claim.

- Oct 5 Application target resolution now records reference provenance and named
  item/category eligibility constraints in Order Menu `kiosk-intents.ts`.
  New categories supersede conflicting prior fragments/presentation focus;
  category purchases expand only to real available category dishes and clarify
  ambiguity before configuration. Mutation targets cannot bypass explicit
  item/category restrictions; verified composition filters qualify ADD/SELECT,
  while unknown/customization-needed facts hand off rather than invent matches.
  Option edits keep the existing POS slot path. `resolveIntent.targetResolution`
  exposes origins, constraints, eligible refs and rejections in execution traces.
  No Jev engine/prompt/threshold change or live customer replay. Unit regressions
  and a real local runtime lookup→category clarification→configuration test cover
  the reported wrong continuity; remote semantic selection is still independent.

- Oct 3 approved staged flow is implemented in Server decision `stages.ts`,
  Kiosk device/Fast Path/Scene and Order Menu. `segmented:true` starts an owned
  decision; authenticated POST continuation IDs are one-use, device/session-bound
  and expire after 15s. Every Jev question is a separate request/checkpoint, with
  physical exchange timing and modelQuestions; filter questions follow read route
  selection only. No generic second classifier/prompt-example expansion. Context
  shaping and revision/confirmation/payment authority stay in application code.
  Qualified route shows one user bubble; speech-only/background does not. Real
  read receipts display before optional review; at most one extra read then final
  COMPLETE/Agent decision. Whole utterance ceiling24 questions. Error envelopes
  are rejected, execution transport loss is unknown with no auto mutation retry.
  Three-second INCOMPLETE relation uses separate fragments bound to state; one
  unresolved clarification answer ends its issued session, background does not.
  RETURN_MENU/menu_open preserves cart and rejects checkout/payment locks.
  Main Agent tools serialize, cap four rounds/16 calls/60s model wait, preserve
  rejected receipts and report incomplete without generated success/retry.
  Source-of-truth section5 of `docs/research/2026-10-02-jev-decision-review.md`
  retains the before/after flow and integration limits. Live artificial segmented
  replay passed menu lookup/card (2/3); background phrase returned INCOMPLETE
  instead of IGNORE, no mutation. Strict failing regression remains; do not
  weaken it or claim semantic acceptance complete. No actual visitor export,
  remote model configuration change, root typecheck or commit. Restart Server and
  reload Kiosk/Order Menu for these transport/runtime changes.
  Validation: Kiosk88 Node tests; Order Menu152 passed/14 guarded live skipped;
  Server scoped decision/context/stages/routes74 passed, followed by the final
  tool-name-redaction regression in the49-test decision suite; Chrome20 passed.
  All three package-scoped typechecks and touched-code ESLint passed. Scoped
  diff whitespace check passed; inherited CRLF warnings in unrelated UI files
  were left untouched. Whole Scene/customer/POS/payment acceptance remains a
  separate integration exercise, not proven by these component/fixture tests.

- Oct 3 approved catalog/decision changes: source POS option groups now reach
  the browser. Beef noodle is 紅燒牛肉麵 (牛肉麵 alias), required 大辣/小辣/微辣,
  no bowl sizes. Dumplings are 8 per piece with 10/15/20-piece serving options
  priced 80/120/160. Missing ADD_ITEM servings/options ask using a revision-bound
  session-owned pending domain plan with 30s answer tickets; 顆 never becomes serving quantity. Configuration answers
  remain finite Jev choices, finish through compile/authorize, reject stale/expiry/
  replay, and new requests revoke this unadded plan before Agent handoff. Required
  options are not defaulted in touch UI. The generic post-route speech qualifier
  is removed; relation/greeting/filter checks and deterministic safety remain.
  User explicitly deferred token/candidate/output pruning and latency attribution.
  No remote Jev/Ollama configuration or live customer replay was performed.

- Oct 3 POS composition now records shrimp/fish instead of generic seafood for
  the two relevant dishes. Shared food-group matching preserves seafood filters
  and vegetarian contradiction checks. Generic seafood facts do not prove shrimp
  or fish absence; group customization requires removing all matching facts.
  Spiciness was discussed as taste/configuration, not added as an ingredient;
  no unverified per-dish heat levels or remote Ollama settings were written.

- Oct 3 visible screen context now flows from Order Menu's actual Vue state
  through WebMCP snapshots, validated Kiosk transport, every Jev gate and Agent
  handoff. `interactionState.screen` is menu/cart_review/item_configuration/
  checkout, independent from business phase and never execution authority.
  RETURN_MENU and truthful error receipts are now added by the staged work above.
  AIRI calls remote Jev `/v1/systemone` with state/questions; no Jev-to-Ollama
  adapter or remote residency configuration is available in this repository.
  Missing keep_alive on AIRI's Jev request is not evidence of Ollama unloading.

- Oct 3 customer traces expose unresolved non-greeting issues: supported pork
  exclusion slots were correct but route chose Agent; shorthand 牛 lacked a beef
  ref; missing ADD_ITEM quantity and generic qualifier are fixed as above;
  我還要點菜 now has RETURN_MENU. Previous checkout speech reported a generic success
  while the next real snapshot remained ordering. Native runtime returns ok:false
  error envelopes; Fast Path now rejects these without reporting completion.
  The exact original checkout error is still unknown. The ASR test panel
  now shows the measured utterance, cumulative API wait, actual call count and
  Server/Jev exchange time (network included), excludes queue/flush/tools/TTS,
  and marks incomplete accounting unknown. Do not attribute latency to input or
  output tokens without provider usage/profiling, and do not export these actual
  customer trace histories to Jev under the earlier artificial-fixture permission.

- Oct 3 GREET is implemented as a non-operation semantic result, distinct from
  companion/background IGNORE. A finite recipient/purpose check verifies GREET
  choices; no keyword intent classifier or relaxed confidence gate. Greetings
  do not answer clarification/high-risk confirmation, mutate orders, consume an
  ordinary pending question or interrupt an existing Agent task. Kiosk replies
  “您好！” with ordinary TTS and the existing configured greeting motion; the
  inspector labels it separately from webpage execution. Live artificial Jev
  replay passed directed greeting, greeting during checkout-entry question,
  companion greeting and greeting plus ADD_ITEM (4/4). User will perform whole
  Kiosk integration testing. Budget/strategy Fast Path extension is deferred,
  not a required gap. Existing animation wiring is present; do not call it absent.
  Partial unexecuted Jev interpretations are not a required Agent constraint:
  preserve the full user request/context and verified facts/read receipts instead.

- Oct 2 bounded-decision improvements are implemented locally, not all six
  approved stages complete. Every Jev gate receives phase/role context; trace
  retains exchanges, durations, actual call counts and refusal reasons even on
  later provider failure. Conservative normalization preserves short speech,
  numerals and pronouns. Read continuation now uses the whole-utterance question
  ceiling and one-extra-read/final-review bound described above.
  Pending-confirmation NEW_REQUEST revokes that exact confirmation before Agent
  handoff, never executes it. Host-only kiosk_agent_task binds known read filters
  to a task ID/menu revision for five minutes; older cleanup cannot clear a newer
  task. Main handoff includes completed read receipts and conditions. Agent read
  and presentation tools intersect task conditions; stale catalog tasks reject.
  Recommendation maxPrice limits dish base price; optional finite POS ranking
  evidence enables strategy only while valid, without fabricated fixture ranks.
  Batches retain budget/strategy. POS Bridge coalesces concurrent submission keys
  within one process; restart/multi-instance durability remains adapter work.
  User authorized native scrolling and fixture-only external Jev replay. Native
  menu_scroll now reports actual MOVED/BOUNDARY/UNAVAILABLE outcomes, is hidden
  without a controller, and is phase/slot authorized. Chrome tests verify actual
  movement, boundaries and hidden owners; no scrolling dependency was added.
  Latest local suites: Order Menu 140 passed/14 guarded live tests skipped,
  Kiosk 76, POS 29, server scoped routes/decision/context 61; browser 16 passed.
  Scoped server/Order Menu/Kiosk typechecks passed. No commit/root typecheck.
  Whole Scene lifecycle and real Main Agent network flow are not yet fully
  integration-validated; do not call all six stages or production rollout done.

- Ingredient-filter follow-up now has live fixture replay coverage. POS accepts a
  positive vegetarian label; shared search/recommendation intersect every
  condition, retain dietary filters across batches, and distinguish NONE from
  UNKNOWN/customization. Empty lookup has no recommendation continuation.
  Server receives finite dietary refs and checks filter coverage/polarity before
  returning a read action; the fixed System One prompt is unchanged. Application
  supplies finite mentioned unavailable-condition refs (nutrition/allergy/strict
  diet topics); Jev distinguishes requested requirements from mere mentions.
  Requested unsupported conditions hand off rather than executing partial reads.
  Active-question speech/relation questions share one provider exchange, but
  relation observations cannot prune legal independent new actions. Every gate
  receives role/phase context with the current utterance last. Final live runtime
  replay passed 14/14 against openjev.aikcitri.qzz.io. Broader Server replay passed
  15/16 (complete feeling statement safely unavailable); the final qualifier
  change then passed the three affected feeling/acknowledgement/acceptance cases.
  No subsequent whole-suite live rerun; do not present those as one 16/16 run.
  Real provider load has caused request/snapshot expiry in earlier runs; stale
  snapshots still reject. Confidence gates and expected results were not relaxed.
  Main Agent receives the full original request and unavailable-condition refs,
  not binding partial interpretations from an unexecuted decision. This remains a
  bounded fixture check, not universal semantic accuracy.

- Seating no longer polls for unset/pickup/completed rounds. Active dine-in
  background sync is 30s (was 5s); semantic context/execution and Agent writes
  only refresh seats for dine-in. Reset without a hold is local. Explicit reads,
  POS atomic reservation and dine-in payment preflight remain authoritative.
  Browser regressions cover activation/cadence/stop/unmount/manual refresh and
  no-hold reset; runtime tests cover pickup omission and dine-in refresh. Reload
  Order Menu/Kiosk to apply; no backend change. Real Jev recommendation replay
  again passed four choices (3/3/1, then filtered exhaustion), not full-menu
  lookup. Recommendation and menu search remain deliberately distinct.

- Recommendation now defaults to up to three distinct available POS dishes;
  catalog order is not claimed as popularity. A two-minute recommendation
  session retains verified conditions and all delivered item IDs. A separate
  bounded `intent:recommend-more` compiles to `menu_recommend(more:true)`,
  preserves conditions and never recycles exhausted items or searches all menu.
  Recommendation/menu revisions reject stale batches; reception reset clears
  them. Fresh recommendations do not inherit old diets. Contrastive candidate
  descriptions distinguish lookup, initial recommendation and alternatives;
  the fixed System One prompt is unchanged. Server also validates finite food
  slots for the alternative choice. Cart reads default to showing review
  (`display:false` reads data only); both fulfillment modes reveal controls
  before animation and update visible selection afterward. Live checkout screens
  are not replaced by cart reads. Restart Server and reload Kiosk to apply.
  Four real Jev decisions passed through actual POS/runtime replay; two browser
  tests verified actual Review controls exist before selection animation.
  Validation: Order Menu 128 and server decision 28 unit tests, all ten Kiosk
  browser regressions, three scoped typechecks and changed-code lint passed.
  Existing Order Menu native-listener warning remains; no root typecheck or
  commit. Related contracts and deployment behavior are in Order Menu README.

- Duplicate-input investigation found that IME commit Enter and held Enter
  could submit the upper ASR text draft prematurely. Browser component tests
  reproduced `要3` being submitted during composition; shared BasicTextarea
  now ignores composition (including the keyCode 229 boundary) and repeat
  Enter. Upper input consumes its draft before emitting, without text dedup or
  blocking later speech. Eight browser regressions and 28 scoped Node tests
  pass; UI and Kiosk package typechecks and changed-code lint pass. Browser test
  dependencies are explicit in Kiosk's manifest/lockfile; no root typecheck or
  commit. Run with `VITEST_BROWSER_CHANNEL=chrome` to use installed Chrome.
  Historical Oct 1 15:17 session records two different inputs/IDs, each with one
  menu_get and one assistant reply; their originating keyboard events were not
  recorded, so that specific incident's cause is not proven. No Jev/ASR change.

- Customer operation dialogue now has one owner: POS labels flow to screen,
  semantic choices, host state and both model transports. `order_ask_question`
  accepts purpose only; Agent-written question text is rejected. The host shows
  canonical tool outcomes plus one validated question, not competing model
  prose or streaming drafts. Server stores operation drafts as service events;
  host records the actually presented reply as customer history. Model-only
  receipts omit environment/provenance, while raw system records retain it.
  Customer order completion/status messages are environment-neutral; pending,
  rejected and uncertain states remain explicit. Diagnostic/staff-only screens
  retain their test labels. Restart POS/server and reload frontends to apply.
  Validation: Order Menu 121, POS Bridge 25, server routes/domain 55 and host
  presentation/fast-path/retry 23 tests passed (224 total). Ten real Jev replays
  passed; four package typechecks, changed-code lint and diff checks passed.
  No root typecheck, no commit; existing native-registration listener warning
  remains unrelated to this change.

- Ingredient filtering is implemented in the uncommitted tree. POS composition
  records actual ingredients, completeness, source/revision and verified removal
  options; no absent-ingredient tags. The seven-dish source JSON declares complete
  simplified simulation facts (primary food, egg, vegetables; not sauces/broth).
  Browser catalog validation requires these facts. Both menu_get/menu_recommend
  share include/exclude intersection, separate customization/unknown results,
  display applied conditions, and clear stale empty displays. Customer dialogue
  omits test-source wording; composition source metadata remains intact.
  Jev receives only mentioned finite ingredient references and answers
  EXCLUDE/INCLUDE/NONE after selecting a read intent; no polarity regex.
  Browser rejects unoffered slots/stale plans; removal ignores food
  conditions. Read continuation retains filters; fresh utterances do not inherit
  a permanent diet profile. Shared product aliases retain all real matches for
  search; mutations still require a unique target. Stage/server use the neutral
  decision contracts so finite ingredient slots are not lost in transport.
  Validation: 208 unit/route tests passed; four scoped typechecks and changed-code
  lint passed. Four live Jev → actual POS → WebMCP replays passed on the final
  version in 12.8s total. No root typecheck or commit. Initial sandbox DNS failure was resolved by approved network
  access; it was not a model failure. Main Agent timeout remains undiagnosed:
  no failing visitor trace was supplied, and this change does not claim to fix it.
  See Order Menu/POS Bridge READMEs for deployment contract and scope.

- Mock dine-in seating is implemented in the uncommitted tree: five four-person
  tables, 10-minute unpaid holds, explicit minimal-capacity split consent, party
  size 1–20, revision-bound selection, and a POS-owned atomic inventory shared
  by HTTP/in-memory adapters. Order Menu touch and semantic WebMCP share one
  seating controller; Jev/Agent state preserves party/current question but not
  private hold tokens. Payment binds/locks the hold; accepted orders occupy it.
  Cancelling, switching to pickup, or starting a new round releases only unpaid
  holds. Authorized payment followed by rejected POS order stays uncertain;
  upstream failures never masquerade as expired holds. Real POS persistence,
  reconciliation remain future integrations. Mock staff departure is now available
  at the loopback simulator `/__simulator/seating`; it releases occupied tables
  individually, never payment locks. See both Order Menu READMEs.
  Seating validation: Order Menu 103, POS Bridge 22, Kiosk routes/decision 37,
  Fast Path 16 tests passed; three live seating Jev replays passed. Scoped
  typechecks and changed-code lint passed; browser verified five-person split
  hold and pickup release. Existing Order Menu MaxListenersExceededWarning
  still prints during native registration tests.

- Current Order Menu venue terminology is 內用 / 自取 (immediate pickup,
  no reservation/time slot). UI, semantic choices, WebMCP descriptions/results
  use these labels; the existing `takeout` order/POS code represents 自取.
  Modes now come from the required POS catalog `store.fulfillmentModes`; UI,
  candidate generation and submission enforce the same offered capabilities.

- Action-bound questions are implemented across fulfillment, party/table choice,
  checkout entry, membership, invoice, tax ID and payment. Real choices describe
  positive effects. `order_ask_question` accepts the current purpose only;
  the application owns wording. The host validates the receipt before showing it and activates
  by exact question ID, never prose matching. Questions bind phase/revisions;
  offers/answer tickets have 30s TTL, presented questions persist within the
  session. Deferral preserves the order. Tax/payment confirmation drops ordinary
  question authority and uses its own one-use record.
  Active-question Jev makes at most three bounded calls: task/background,
  answer/new request, semantic choice. New requests drop old question authority.
  An uncertain task gate can only defer an ordinary question, never mutate or
  escalate. Six actual-runtime live Jev replays passed (對, 好結帳, 先不要,
  background, new meal, 信用卡). Full checkout unit flow verifies payment only
  starts after exact confirmation; browser verified checkout entry reaches
  membership, not payment. No raw direct-tool fallback or phrase regex added.
  Validation: Order Menu 113, POS Bridge 24, server decision/routes 41, stage
  Fast Path/presentation 18 tests passed; six live Jev replays passed in 21.8s
  total. Scoped typechecks passed. Route setup needed a 30s hook timeout for
  schema initialization; no production timeout changed. Existing native
  registration MaxListenersExceededWarning remains. Real POS/terminal and
  operator-side end-to-end acceptance are still required before production.

- Kiosk dialogue and archive changes are in the uncommitted working tree.
  System One now gets server-owned bounded role dialogue (12 turns / 4,000
  chars), actual unanswered questions, and one finite read-result continuation.
  Past model decisions remain traces, not context truth. Context-dependent
  uncertain operations can escalate after a separate bounded speech check.
  `0045_kiosk_session_archives` changes TTL to operational-link release;
  transcripts/original captured media/internal verified associations remain.
  Rebuild server-schema and restart Server to apply it. Preserve the private
  media volume as well as PostgreSQL. Membership/POS verifier wiring is future
  integration, not implemented identity discovery. See the three app READMEs.
  Live Jev replay against openjev passed 13 cases, including completed-result
  review; price acknowledgments safely escalate when operation confidence is
  uncertain rather than being executed as purchases.

- Repository-wide Codex working rules are in [`../AGENTS.md`](../AGENTS.md).
  Start there before exploring.
- The workspace can contain user-owned, uncommitted work. Do not assume its
  intent or overwrite it; inspect `git status` and the relevant diff only when
  the current task needs it.
- [`../CONTEXT.md`](../CONTEXT.md) is the domain glossary. It is reference
  material, not a task ledger.

## Recent Meaningful Changes

- Per-device Kiosk settings now connect management API, device bootstrap/polling,
  Dashboard Devices, and the Kiosk settings page. Migration `0032` adds the
  Server-owned revision, admin overrides, delegated keys, and local overrides.
  Admin revocation deletes local values; local writes require both a registered
  device and a Site/system administrator account. Operational observation no
  longer reads localStorage. See `apps/stage-kiosk/README.md` for precedence and
  deployment requirements. Frontend build validation was blocked by the Live2D
  SDK download; do not automatically rerun builds/typechecks (user preference).

- Webnavior now has a structured Interactive Experience editor, operations
  dashboard, draft-only Kiosk preview, per-site model policy, and server-owned
  Kiosk character assets. The completed and remaining delivery steps are in
  [`plans/2026-09-10-webnavior-management-experience.md`](plans/2026-09-10-webnavior-management-experience.md).
- Kiosk provisioning now has a one-administrator operator boundary: an
  administrator can publish a default experience template, and a newly created
  Site copies its latest snapshot into its own draft and immutable release.
  Store releases track revisions, template origin, parent release, and whether
  they are a template seed or store override. New devices inherit the Site's
  latest release; template changes never overwrite existing Sites.
- A published Kiosk Profile now has `voiceConversationOnly`. It hides the text
  composer and, with provisioned microphone permission, starts VAD on load;
  the Kiosk displays green/red microphone status from its actual VAD startup
  state, and its avatar receives the shared Stage thinking state during Server
  replies.
- Kiosk ASR/TTS now use device-authenticated `/api/kiosk/audio/*` routes. The
  Server resolves Site policy and retains provider, model, voice, endpoint, and
  credentials; kiosk bootstrap and local settings no longer carry audio models.
- Kiosk Sites persist a performance profile (`constrained`, `balanced`, or
  `high`). The kiosk bootstrap applies it locally to camera resolution,
  MediaPipe cadence/face count, and evidence-clip duration; constrained devices
  cap continuous recording to triggered clips regardless of the Site policy.
- Kiosk Sites persist their voice VAD settings, including probability threshold
  and speech padding. Authorized operators can adjust them in Kiosk technical
  settings; the kiosk refreshes immediately after a local save and otherwise
  polls the synchronized snapshot every five minutes.
- Kiosk technical settings also provide an opt-in conversation-duration
  diagnostic. When enabled, the conversation pane shows the current/latest
  request duration through final LLM text and browser-tool work, excluding ASR
  and TTS playback.
- Kiosk camera evidence supports `snapshot` in addition to off, triggered
  video, and continuous video. Snapshot captures one event-linked JPEG without
  creating `MediaRecorder`; the per-device `faceDetectionConfidence` setting
  defaults to `0.60` and accepts `0.40`–`0.80` for MediaPipe detection,
  presence, and tracking thresholds.
- Kiosk uses a bounded queue of independent final ASR utterances alongside its
  cancellable Agent/presentation turn. New VAD speech can be transcribed while
  a model or browser tool runs; Jev classifies it before any interruption or
  escalation. The Router now enforces `fullChainTimeoutMs` across all LLM
  fallback attempts. Order-menu publishes the optional Webnavior Kiosk Activity
  Manifest at `/.well-known/webnavior-kiosk-activity.json`; its customer labels
  are display-only and always have a generic Kiosk fallback.
- Normal Kiosk conversation replies now remain Server-owned but stream a stable,
  customer-safe SSE event contract to the browser. Assistant deltas are
  presentation-only until completion, browser-owned tool calls retain their
  existing execution loop, and only completed assistant text is persisted.
- Kiosk conversation progress now projects verified `turn-started`, tool, and
  first-answer events into a transient cross-column thought bubble beside the
  avatar. It deliberately never appears for unverified speech candidates, and
  each state carries its turn id so an interrupted request cannot clear a newer
  customer's progress.
- After five seconds without an answer, the Kiosk changes that progress copy to
  a truthful "still checking" state. A timed-out turn can be manually retried
  only if it attempted no cart, order, checkout, or payment mutation; menu and
  cart reads remain retryable, while the original customer message is not shown
  twice in the conversation.
- Kiosk history classifies retained sessions as interactive, greeting-only, or
  empty without deleting associated evidence. Administrators can select reviewed
  sessions and export LLM JSONL or ASR metadata plus paired audio ZIP. The
  Ubuntu updater applies the PostgreSQL schema, rebuilds server schema, and
  restarts `webnavior-api` before publishing browser assets.
- Webnavior's OpenAI-compatible TTS connection now stores its own voice instead
  of consulting AIRI's general voice catalog. The default is
  `zh-TW-HsiaoChenNeural`; `/audio/speech` receives that voice, MP3 format, and
  speed `1.0` unless a System Manager changes the connection setting.
- Removed the stale `azure-speech` SSML allow-list entry and the unused MiniMax
  Speech provider registration, metadata, translations, and dedicated docs.
- Webnavior Kiosk AI uses a Server-owned, capability-scoped control plane:
  every chat, vision, ASR, and TTS capability owns multiple isolated
  Provider Profiles and one active verified selection. Profiles do not cross
  capability boundaries, even with the same upstream URL. The runtime compiler
  projects only active verified profiles into existing AIRI gateways. The Stage
  Web 「Kiosk AI 能力」 page validates a selected model with its real capability
  endpoint before allowing activation; switching only reaches Kiosk after an
  explicit apply. `face_only` and other presence settings remain independent.
- Order Menu now loads sellable items exclusively through
  `apps/order-menu-server`'s POS Bridge. Its loopback simulator normalizes the
  repository-root `周氏蝦捲菜單_v2.json` fixture, while the browser carries the
  returned catalog revision with every cart. The Bridge rejects stale revisions
  or changed prices before forwarding to the POS. The checkout now creates a
  card/mobile terminal payment, binds an authorized payment ID and exact amount
  to the cart, and automatically submits to POS. Rejected payments return to
  method selection; uncertain payment or order receipts lock the flow pending
  reconciliation. The simulator exposes independently controllable payment and
  order outcomes. See
  `plans/2026-09-21-order-menu-pos-bridge.md`.
- Order Menu WebMCP now follows RMAP v0.2: explicit cart confirmation starts
  checkout instead of submitting directly. Agent tools can skip membership,
  choose invoice handling, display and separately confirm an eight-digit tax ID,
  select a payment method, or cancel checkout. Physical barcode scans and
  payment authorization remain outside WebMCP; pending/uncertain payments block
  cancellation and new-round cart clearing. See
  `standards/restaurant-menu-agent-protocol-v0.2.md`.

- Kiosk visitor sessions now persist compact Agent interaction context beside
  their transcript: rendered and dismissed menu subject IDs plus
  `active`/`decision_guidance`/`touch_preferred` mode. A request for other
  recommendations dismisses the preceding batch; only repeated rendering of
  unchanged items escalates guidance. The same context now retains recent menu
  item names/IDs and the latest successful compact cart snapshot for natural
  references. Full tool calls/results remain in the durable transcript for
  review, but only the current tool exchange is sent back to the model; older
  tool payloads are represented by the compact context. Recent conversational
  text is additionally bounded by total characters, and an oversized current
  tool result is reduced only in the model request while its complete durable
  result and interaction snapshot are committed before the model continuation.
  This never owns or clears the order-menu cart. See
  `apps/server/src/services/domain/kiosk-agent-interaction/`.
- Order Menu distinguishes a filtered `menu_get` lookup from a recommendation:
  lookups replace the menu grid without a recommendation rail, while
  `menu_recommend` and `menu_show_recommendations` use the rail and the Kiosk
  recommendation motion. In non-production, `kiosk-tools` traces only tool
  names/session IDs on the Server. The Kiosk forwards SSE `tool-requested`
  events before browser execution and shows selected, running, and completed
  steps in a fixed panel above the message composer.
- `menu_get` accepts `queries` for a single multi-dish lookup, so a customer
  mentioning several dishes can render their combined matched results rather
  than whichever scalar query the model chose last. Query-result presentations
  preserve each matched subject and use a fair first-card allocation, then let
  the customer switch to every subject's complete result list; broad matches
  cannot consume all preview slots. Browser-owned Agent actions now visibly
  press their resolved target control without issuing an extra DOM click. The
  System Manager's Chat Provider default and allowed maximum are 60,000 ms; an
  existing Chat profile must still be edited, verified, saved, and applied
  before its persisted 30,000 ms timeout changes.
- Order Menu now displays a transient skeleton only while a tool that will
  replace the visible menu is truly executing: filtered `menu_get`,
  `menu_recommend`, or `menu_show_recommendations`. The runtime owns start/end
  notifications, so the skeleton clears on success and failure alike; a full
  catalog read does not unnecessarily replace the current menu with a loader.

## In Progress / Known Issues

This section is the required unfinished-work index. Future Agents must read it
before proposing the next implementation; the linked plans provide detail, but
their existence alone does not mean an item has been implemented.

### Order Menu / POS

- Replace the loopback POS and payment simulator with vendor adapters after the
  POS and operations vendors provide catalog, order, terminal, timeout, and
  reconciliation contracts. Do not guess vendor fields or payment brands.
- Connect physical membership and invoice-carrier scan events. A scan result
  must come from the device adapter, never an Agent tool; an inherited carrier
  must still be shown in full for customer confirmation.
- Connect real cloud-invoice issuance for carrier, eight-digit tax ID, and
  donation. The default donation recipient remains an operations-owned setting
  and is intentionally not hard-coded.
- Add a staff reconciliation workflow for `uncertain` payment or POS results.
  Until reconciliation exists, these states intentionally lock payment, cart
  clearing, and new-round actions to prevent duplicate charges or orders.
- Run vendor-hardware acceptance tests for barcode scanners, card terminals,
  mobile-payment QR presentation, receipt results, and the configured 30-second
  timeouts once hardware contracts are available.

### Webnavior management / Kiosk

- Webnavior Kiosk now has a System One Fast Path. Each encrypted profile selects
  Dasein open-jev, lookski/openjev or SLM, with its URL, model identifier,
  timeout, readiness and active status; Jev uses real `/v1/systemone` readiness, while SLM uses a strict
  choice through `/chat/completions`. The Kiosk sends its final ASR transcript, explicit phase,
  finite domain references, and a small set of phase-legal semantic intents to
  the one active profile. The model cannot see or invent WebMCP tools, cart
  line IDs, prices, payment outcomes, or POS commands. The internal candidate
  tool is excluded from Main Agent tools. `IGNORE` retains nothing;
  `NEEDS_ASSISTANT` sends the current ASR transcript to Main Agent, while
  `UNAVAILABLE`, `IGNORE`, `INCOMPLETE`, and `CLARIFICATION` remain
  on the constrained voice path. A failed decision marks the profile unready,
  and the next utterance automatically performs real readiness before
  re-enabling Fast Path. Details and present scope are in
  [`plans/2026-09-27-webnavior-dasein-system-one-phase-1.md`](plans/2026-09-27-webnavior-dasein-system-one-phase-1.md).
  System Managers can inspect the selected local deployment's actual loaded
  model through `/health`: Dasein returns `model`; lookski returns `model_id`.
  These implementation-specific single-model runtimes cannot switch model per
  System One request. System One
  profiles support edit and deletion: modifying implementation or
  connection settings revokes readiness and deactivates Fast Path, duplicate
  names return a conflict instead of a 500, and only an inactive profile may be
  removed. System Managers can explicitly deactivate Fast Path without deleting
  its profile. System One
  now compiles its Traditional Chinese semantic policy from a System Manager
  editable prompt. A blank override means the current Server default, while
  the UI exposes that default for experimentation and can restore it. The
  optional 2,000-character store instruction remains separate. Neither can
  replace candidate-set, RMAP, confirmation, or executor safety boundaries.
  Migration `0042_kiosk_system_one_policies` adds this singleton setting;
  migration `0043_kiosk_system_one_implementations` adds the required
  implementation field, marking existing profiles as Dasein; migration
  `0044_kiosk_system_one_decision_instruction` adds the editable prompt
  override. The default contrastive boundary treats a uniquely identified
  「想吃／想要水餃」and「我要／幫我加水餃」as `ADD_ITEM`; only explicit
  viewing or selecting without ordering uses `SELECT_ITEM`. In text-mode Kiosk, the main conversation panel provides a
  simulated-ASR text input, expandable raw decision trace, and a larger
  structured per-utterance inspector. It bypasses
  microphone/ASR only; it uses the real System One, current browser state,
  and WebMCP runtime, marks activity `asr_simulation`, and does not retain a
  fake audio recording.

- The obsolete Kiosk embedding Speech Guard and `/turn-decisions` control plane
  have been removed. Migration `0041_remove_kiosk_speech_guard` permanently
  removes embedding Capability Provider selections/profiles and both Speech
  Guard tables. The former Redis entry is no longer read by Server code.

- **Bounded semantic-pipeline refactor:**
  `apps/order-menu/src/kiosk-intents.ts` owns domain reference resolution,
  `deriveDecisionContext`, `resolveIntent`, `compileOperationPlan`, and
  phase-aware `authorize`. Candidates are one per legal intent, not menu ×
  intent, and the Server no longer lexically sorts or truncates them. Menu
  full names, aliases, unique suffixes, categories, selected/cart references,
  quantity, options, and supported dietary constraints are resolved in the
  application. Jev sees only per-turn ordinal domain refs, not actual item or
  cart IDs. `webmcp.ts` binds issued plans and one-round clarification to
  relevant cart/menu/selected/checkout revisions. The order machine increments
  domain revisions on each successful write, and checkout/payment refs advance
  checkout revision synchronously, including edit-then-undo cases.
  Clarification questions use
  only real refs; unique ordinal replies are resolved deterministically, while
  an unresolved reply returns to touch. Confirmation records bind action,
  slots, ID, timestamps, expiry, and revisions, and are consumed before
  execution. Payment selection now explicitly sends its phase and methods;
  payment pending/uncertain remains locked.

  The simulated-ASR panel exposes a full trace: browser and checkout snapshot,
  phase, refs, intent candidates, Jev raw answer/probabilities, resolution,
  operation plan, and authorization. A state-changing choice below 0.5 reported
  confidence returns `UNAVAILABLE` rather than executing or forwarding
  unclassified speech. On 2026-09-29 the
  configured Qwen3.5-4B openjev service passed the eight live request replay
  expectations using the default prompt, but that replay used an incorrect
  bento gold label. After correcting it to `ADD_ITEM`, the same eight cases
  passed a fresh live replay against the configured service on 2026-09-29;
  「我想要吃招牌便當」 chose `ADD_ITEM` with 0.916 confidence and 「信用卡」
  chose card payment in `checkout_payment_select`. This is not proof for
  store-specific overrides or
  physical checkout; operator-side integration testing remains necessary.
  Do not restore the removed raw direct-tool candidate path.

- **2026-09-29 continuation:** Jev's one bounded choice now has `MULTI_ACTION`
  for compound utterances that must reach Main Agent intact; a separate live
  two-question probe was slow; active-question bounded calls now have guarded
  live replay evidence, not a guaranteed latency SLA. Fast Path retains a recent real cart line
  for 「再一份」, clarifies a conflicting selected draft, and honors the spoken
  quantity. Successful Fast Path voice turns and compact menu/cart results are
  persisted in the same visitor session that Main Agent reads. Agent has a
  read-only, device-authenticated `kiosk_session_history` tool for paged older
  text, not an unbounded prompt. Native Main Agent WebMCP mutations use the
  same `authorize` policy; high-risk calls create one-use Fast Path confirmation
  state, and ambiguous same-item cart edits use bound clarification. Checkout
  payment-stage cancellation is available only before payment begins and
  requires confirmation. ASR escalation carries a sanitized browser phase and
  payment-method snapshot into the Main Agent's first request; typed turns read
  the same snapshot through host-only `kiosk_interaction_state`, which does not
  create or consume Jev candidates. Raw checkout IDs remain browser-owned.
  Relevant targeted tests/typechecks and the corrected eight-case live replay
  pass; on-device checkout/POS integration remains to be validated.

- **Kiosk continuous-ASR continuation:** Native WebMCP host-only context/state
  calls now use the host path, and native JSON-string input schemas are parsed
  before Main Agent tool exposure. Live and simulated ASR use one bounded
  utterance queue that reserves capture order before asynchronous ASR returns
  and releases a hung ASR reservation after 15 seconds. Jev filters background speech before interrupting TTS or
  Agent work; an active Agent request can be restarted only before it requests
  a browser tool. Later speech waits for a definitive tool/result loop and is
  re-decided against current state. `UNAVAILABLE` fails closed, while explicit
  `NEEDS_ASSISTANT` and related follow-ups route to Agent. The decision inspector
  shows phase, candidates, real-reference labels, decision, operation, and
  authorization per utterance. Targeted tests and package typechecks are the
  implementation gate; local Server services were not running for live replay.

- Build the System Manager sandbox test and Store Manager on-device validation
  workflow, including device health, execution records, and audit data. This is
  phase 5 in
  [`plans/2026-09-10-webnavior-management-experience.md`](plans/2026-09-10-webnavior-management-experience.md).
- Add production account assignment for Content Managers plus submission,
  approval/publish permissions, and audit history. Current development accounts
  and role checks are not the final operator workflow; this is phase 6 in the
  management plan.
- Design a finite, validated VRMA action mapping for greeting, recommendation,
  and order-completion one-shots. Character cards and LLM output must never
  choose arbitrary filenames or URLs.

### Validation note

- Relevant package tests and typechecks have been used during development. A
  repository-wide typecheck/build was intentionally not run; follow the scoped
  validation policy in `AGENTS.md` and run integration gates only when preparing
  a release, PR, or merge that requires them.

## Key Technical Decisions

- Formal, reusable decisions belong in `docs/standards/`; reusable
  investigation outcomes belong in `docs/solutions/`. Do not duplicate either
  in this handoff.
- Follow targeted validation first. Root-level lint/typecheck remain suitable
  integration or before-commit checks, not a default after every edit.

## Relevant Files

- [`../AGENTS.md`](../AGENTS.md) — repository development rules and validation policy.
- [`../CONTEXT.md`](../CONTEXT.md) — shared domain terminology.
- [`plans/`](plans/) — current feature plans.
- [`standards/`](standards/) — stable product and protocol contracts.
- [`solutions/`](solutions/) — reusable verified implementation learnings.

## Next Likely Work

- For Order Menu, real membership, invoice, donation-recipient and payment-brand
  adapters remain deferred until POS/operations contracts arrive. The next
  implementation unit should begin only after those external contracts or a new
  product requirement is available.
