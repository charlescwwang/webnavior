# Order Menu POS Bridge plan

## Objective

Prepare the ordering flow for a real POS before vendor credentials are available. The same customer flow must work against a controlled local simulator during development and a vendor adapter later, without making the AI claim that a test, failed, or ambiguous submission reached the POS.

## Decisions recorded

- `apps/order-menu` remains the customer-facing menu and native WebMCP implementation. `menu_get` stays the source of menu data for the AI, but its source will become the POS Bridge rather than the current in-memory menu.
- Add a separate `apps/order-menu-server` service for the POS Bridge. It owns POS-facing network calls, credentials, idempotency, request timeouts, audit-safe order receipts, and vendor-specific adapters. `apps/server` remains the Webnavior/Kiosk identity and AI-management server; it does not gain a restaurant-vendor adapter.
- Start with a controlled POS simulator and a stable bridge contract. The simulator is a development/test adapter or fixture, not a second production dependency.
- The customer UI and WebMCP consume normalized menu data and submission receipts only. They do not receive POS credentials or vendor response shapes.
- Do not represent a completed submission as `simulated`. A result is expressed by independent environment and outcome fields so test execution cannot be mistaken for a production failure, or vice versa.

## Target boundary

```text
Kiosk / LLM
    │ native WebMCP
    ▼
apps/order-menu (customer UI, cart, confirmation)
    │ authenticated local service contract
    ▼
apps/order-menu-server (POS Bridge)
    ├── normalized menu catalog query
    ├── normalized order submission + idempotency
    └── vendor adapter selected by deployment configuration
            ├── POS simulator (development / automated tests)
            └── real POS adapter (after vendor API is available)
```

The menu and prices displayed to a customer are snapshots returned by the Bridge. At confirmation, the Bridge validates the order against the current POS state again. A stale price, unavailable item, or changed option is rejected with a customer-safe reason and requires review rather than silently submitting a changed order.

## Normalized contracts

The first implementation should make these two operations the only public POS-facing boundary.

### Catalog query

The Bridge returns normalized categories, items, prices, option groups, and `availability`. Inventory counts are optional: a POS adapter must omit them if they cannot be kept accurate. `apps/order-menu` maps that response into its existing menu domain model before exposing it through `menu_get` and `menu_recommend`.

### Order submission

The UI submits a finalized immutable order snapshot plus an idempotency key generated before the first attempt. The Bridge returns a receipt shaped around the customer-facing truth:

```ts
interface SubmissionReceipt {
  environment: 'test' | 'live'
  status: 'accepted' | 'rejected' | 'uncertain'
  posOrderId?: string
  customerMessage: string
  retryable: boolean
}
```

- `accepted` + `live`: the POS has acknowledged the order. The deterministic customer confirmation may state that it was sent to the store/POS.
- `accepted` + `test`: the simulator accepted it. The deterministic customer confirmation explicitly calls it a test order and never says it reached a real POS.
- `rejected`: the POS or pre-submit validation declined it. Keep the cart recoverable and ask the customer to review the displayed problem.
- `uncertain`: a timeout or network failure occurred after submission may have started. Do not retry with a new idempotency key and do not say the order failed or succeeded. Re-query or reconcile using the same key before resolving the customer flow.

The server, not the LLM, owns `customerMessage` and final completion state. The LLM may introduce or paraphrase a successful result only after receiving the structured receipt; it must not invent a POS outcome. This removes the current prompt-driven “模擬訂單” wording instead of merely suppressing it.

## Delivery phases

### 1. Make the current order domain truthful

1. Replace `SubmittedOrder.status: 'simulated'` with the receipt model above.
2. Make `order_confirm` return that receipt and derive its visible confirmation from it.
3. Update RMAP as a versioned extension or v0.2: `order_confirm` returns a submission receipt, and a completed test submission is not described as POS submission.
4. Add regression tests covering the wording and terminal state for every receipt combination.

Acceptance: no production code path can label an accepted live order as simulated, or claim a rejected/uncertain one was sent.

### 2. Define and exercise the POS Bridge contract

Status: partially implemented on 2026-09-21. `apps/order-menu-server` now
provides the loopback Bridge, an idempotent submission contract, and the
controllable simulator. Moving the customer menu catalog itself to the Bridge
is phase 3 work.

1. Create `apps/order-menu-server` with a narrow HTTP contract for catalog retrieval and order submission.
2. Move the existing in-memory menu into a test fixture behind the Bridge, rather than retaining it as a silent fallback inside the order machine.
3. Add a development-only POS simulator adapter with controllable scenarios: accepted, item unavailable, price changed, validation rejected, timeout before submission, timeout after possible submission, and duplicate idempotency key.
4. Ensure order-menu has an explicit configured Bridge URL in local development. Missing configuration displays a clear integration error; it must not silently submit a demo order.

Acceptance: a local developer can run the simulator and reproduce every POS outcome without external hardware or network access.

### 3. Integrate the customer flow

Status: implemented on 2026-09-21 for the local simulator path. The Order Menu
loads its catalog from the Bridge, exposes only that loaded snapshot to UI and
WebMCP, carries its revision with the cart, and receives deterministic receipt
states. The Bridge rejects stale revisions or changed line prices before it
forwards the order. The local simulator normalizes the repository's
`周氏蝦捲菜單_v2.json` fixture; it is an input fixture, not a POS vendor adapter.

1. Fetch and refresh the catalog through the Bridge; do not hard-code sellable items, prices, or availability in WebMCP.
2. Preserve each cart's catalog revision or pricing snapshot and perform a final server validation at confirmation.
3. Render deterministic submission results in the menu UI and send the same structured result to the host/LLM.
4. Give uncertain orders a reconciliation screen/state rather than reopening the cart or allowing a blind second submission.

Acceptance: WebMCP still exposes the same ordering operations, while the underlying catalog can be exchanged from the simulator to a real POS adapter.

### 4. Add the real POS adapter

After the POS vendor supplies API documentation and a sandbox, implement one adapter below the existing Bridge contract. It must map vendor menu identifiers, option constraints, service modes, tax/price semantics, submission acknowledgement, lookup-by-idempotency, and error codes. No vendor types cross into `apps/order-menu` or the WebMCP protocol.

Acceptance: the same contract suite used by the simulator passes against the vendor sandbox, with vendor-specific integration tests guarded by explicit environment configuration.

## Test strategy

- Unit-test the order machine against receipt outcomes; tests assert the customer-visible state and phrase, not only internal flags.
- Contract-test every Bridge adapter with the same catalog and submission cases.
- Test idempotency end-to-end: repeated calls with the same key resolve to the original receipt and never create a second order.
- Add integration tests for timeout boundaries. In particular, distinguish “request never sent” from “result unknown after sending”.
- Add browser/WebMCP tests ensuring `menu_get` returns Bridge data and `order_confirm` cannot complete an order when the receipt is rejected or uncertain.

## Deployment and operational policy

- POS endpoint, credentials, environment, timeouts, and adapter selection exist only in `order-menu-server` configuration. Use development-specific local configuration for the simulator and deployment-managed secrets for live POS.
- Treat POS connectivity as an operational dependency: expose health/readiness for catalog access and submission, but do not reveal credentials or vendor internals to the customer UI.
- Log correlation identifiers, receipt environment/status, and adapter error category. Do not log payment data or raw credentials.
- Start with ordering only. Payment, cancellation, refund, loyalty, and exact inventory reservation remain outside this plan unless the selected POS makes one of them mandatory for submission.

## Decisions required before phase 4

1. POS vendor, API documentation, sandbox access, authentication method, and its supported idempotency/lookup mechanism.
2. Whether orders are sent at customer confirmation or after payment, and which system owns payment.
3. Whether the POS can provide availability only or reliable stock counts, and how frequently the catalog must refresh.
4. Store network topology: cloud API, local LAN device, VPN/proxy, and offline behaviour.
5. Vendor rules for order modification, cancellation, tax, service fees, and dine-in/takeout mapping.

Until these choices are known, phases 1–3 provide the complete integration harness without guessing a vendor protocol.

## 2026-11-08 proposed supplier-menu simulation and safe page selection

Status: committed in42a7029/a67aec6/ad98734 and deployed at17:03 Taipei Nov08. The new owned HTML entry,
independent test Bridge/catalog and shared central/on-site selection are implemented.
The implementation does not operate the supplier's original site. Payment wording
is implemented through verified merchant facts; simulator controls are not support
claims. The analysis below records the original design; current overrides and
validation are listed here and in the conversation-repair plan.

User-confirmed source overrides: 炸排骨便當130元、椒香麻辣牛肉麵230元、A套餐130元、
B套餐145元；周氏水餃每份基本8顆64元，另有每份加量0～100顆、每顆8元，
與訂購份數分開。保留原始公開觀察，實作資料使用確認後數值。助手自由文字
備註功能本輪未新增，沿用既有菜單選項政策。三張實際來源圖片已保存；其餘
13道不冒用圖片。新入口建置為 `supplier.html`，API 使用既有 Bridge 下的
`/supplier`；新舊店家各有獨立 Bridge 狀態。續接網址、API 與瀏覽器憑證儲存
亦分開，不把新店家訂單帶到舊入口。兩者營運業者均為周氏蝦捲。

後台 Profile 可新增／發布支援的點餐網站，前後台裝置設定透過同一 Server
欄位 `orderingServiceId` 選擇。保留既有 PIN／帳號權限。進行中訂單先保留，
經原 round／visitor reset barrier 後套用；閒置切換同樣先安全 reset。頁面
只向對話公開一個 active binding，未發布或已移除的選擇不能默默回到別店。
已發布三個前端、API 與 Menu Bridge；release為
`merchant-revision-20261108T090314Z-ad98734`，origin92／public92檢查通過。
新頁為 `https://webnavior.aikcitri.qzz.io/menu/supplier.html`；新舊 catalog各16／7項。
補上既有 BFF 對 `supplier/` 的限定白名單，沿用原驗證，未登入訂單讀取仍401。
原 Profile／選店設定保留；管理員可把此新網址作為獨立 binding新增並發布，
再於共用裝置設定選用。本次沒有替所有現場裝置改選新店家。
操作員已於Nov08 17:13執行快取腳本，Nginx語法檢查／reload通過。
來源與公開HTTPS均確認新頁200、`Cache-Control: no-cache`及已過期Expires，
Cloudflare回應DYNAMIC。只補新頁規則，其他入口規則未動；備份為
`/etc/nginx/sites-available/airi-web.before-merchant-html-20261108T171354`。
不需要資料庫 migration，不能直接沿用前一次僅前端的發布指令。

驗證：Menu993通過／202跳過（非通過）；新增資料／加量邊界與續接43個
相關案例通過；Server發佈／選擇／設定32通過；新 Bridge prefix1通過；
Host／快速路徑／生命週期171通過。Firefox設定與既有操作5通過，新店家
Kiosk／隨桌2通過；本機實際頁面確認16品項、3張來源圖片、加2顆80元、
份數加減及移除，原頁仍是原7品項。三個前端建置通過，相關 package
型別與修改檔 lint 通過；提交門檻 root typecheck一次通過。root lint有2364項既有、非本次修改檔錯誤，未擴大清理；分批commit hooks通過。瀏覽器依賴預掃描有
`vue-router/auto-routes` 訊息／reload，但新店家2測試通過；未聲稱真模型、
完整 Scene／Windows語音、正式付款或任意第三方網站相容性已驗收。


### Confirmed product direction (Nov08 follow-up)

- Treat the current and supplier-inspired menus as different merchants, with
  separate merchant identities, catalogs, price/unit/option data and merchant
  facts, including payment policy. Do not inherit old merchant answers simply
  because both pages share our runtime. The new merchant remains a simulation.
  User clarified that its operator is also 周氏蝦捲; a separate merchant record
  does not imply a different operator. Start with a fresh merchant/catalog
  configuration, not a replacement catalog for the old merchant. Existing
  cross-target cart isolation is retained, not described as a newly missing feature.
- Give the new page its own deployed HTML entry URL, selected inside the existing
  Kiosk iframe. It may share a build/domain with the current page; a separate
  domain or duplicated backend is not required. Exact path is an implementation
  detail; supplier.html is now built locally but not published.
- The central admin can add merchant/site records and their supported page
  bindings over time. A dropdown in central device settings and PIN-protected
  on-site settings selects the configured merchant/site; both persist the same
  Server-owned selection. Adding a record does not automatically supply a UI
  adapter for arbitrary sites. Each selectable target needs a working binding.
- This iteration builds and controls our own simulation page. Do not embed or
  operate the supplier's original webpage, or make that external site's framing/
  integration assessment a prerequisite for the mock. External-site adapters
  remain a future, separately scoped concern. Keep real UI click/input execution.
- This confirmation authorized implementation later in the chat; production deployment has not been performed.
  Merchant switching and Kiosk/table service remain independent settings; the
  active-order safety and next-empty-order switching rules below still apply.

### Public source and data preparation

Source: [ESGPB 沙崙AI創新應用大樓店](https://app.esgpb.com/order/store/1kgJeql/pick_up/menu).
Inspected all16 public product dialogs on Nov08; factual snapshot:
`docs/research/2026-11-08-esgpb-menu-observation.json`. Public observation is not
an authenticated vendor export or production POS integration.

- Two categories, 飯區/麵區, sixteen items. Page explicitly says not officially
  operating. Preserve observed category/item text, display order, prices and
  provenance. Bind real source IDs only if exposed by a verified source;
  snapshot row keys are not vendor product IDs.
- Three product image URLs were observed and loaded; thirteen items had no
  product image in the inspected cards/details. URLs are recorded; images have
  now been copied into the simulation assets; absent images use an honest no-photo presentation,
  never another dish's picture. Record source URL and capture date.
- All inspected dialogs show quantity plus a free-text note field. No structured
  option groups were observed. Notes are a separate capability, not permission
  to promise arbitrary cooking adjustments. Whether the assistant may enter
  customer-authored notes is outside this implementation; if notes are supported,
  UI/cart/receipt must retain them consistently, not merely render a fake field.
  Keep existing no-menu-option/no-customization policy until that decision.
- The public source displayed 排骨10元 and A/B0元. These observations remain
  recorded, but the simulation uses user-confirmed 排骨130元、椒香牛肉麵230元、
  A130元、B145元; it never labels the original zeros as free promotions.
- The source alone did not establish the dumpling sales unit. The user has now
  confirmed8pieces/64元 per serving and0–100 extra pieces at8元 each. This is a
  declared add-on option, not an invented recipe adjustment or the old10-piece unit.
- Unknown ingredients, nutrition, removals and dietary guarantees stay unknown.
  Do not copy the old menu's composition/recommendation facts onto new products.

### Independent simulation page

Build a separate entry/page inspired by the supplier's category list, product
cards and item dialog. Keep the current Menu entry unchanged. The simulation
must have its own UI/control mapping so this exercises different markup, rather
than just relabelling the current page. Reuse the existing order domain,
admission checks, real click/input execution boundary and host protocol where
appropriate; avoid duplicating the entire agent/cart engine.

Display a persistent, visible and accessible label such as
「模擬示意｜不會送出真實訂單或付款」. Mock checkout/submission receipts must
remain environment:test and cannot claim delivery to the merchant. Do not copy
the supplier's login gate, reintroduce phone collection, or connect its real
submit/payment endpoints. Unobserved checkout screens are our simulated flow,
not claimed replicas verified against the supplier.

### Page selection and future sites

Keep iframe presentation. The missing part is coordinated service selection,
not another iframe element:

1. Reuse approved-service registry/Profile boundaries. A deployment-approved
   target bundles a stable service ID, display name, page URL, catalog identity
   and revision, operation adapter/protocol, test/live environment and declared
   capabilities. Page/catalog/executor must belong to the same target.
2. Add a 「店家／點餐網站」 selector to the PIN-protected Kiosk admin view and the
   corresponding central device settings. Central admin maintains merchant/site
   records and supported bindings; the selector lists configured targets such
   as 現有示範 and 業者菜單模擬, not arbitrary URLs. Save once to the Server and
   show saved selection, active selection and pending next-round selection.
   Existing PIN/account authorization rules remain unchanged.
3. Current frontend registry supports multiple services, but Server Profile
   snapshots currently deliver one `interactiveService`, and content managers
   cannot freely edit its URL. Implement the approved list/device choice at the
   owning Server/Profile boundary; do not rely on browser-local changes that
   bootstrap will overwrite. Choose the smallest schema change after inspecting
   that boundary; no new library/dependency is selected by this plan.
4. Default switching applies to the next empty order. An active cart/draft needs
   an explicit finish-or-cancel/reset path; payment/submission in flight or with
   unknown result must settle before switching. Never carry a cart, product ID,
   meal/checkout question or submission consent into another target.
5. On actual switch retire the old model turn, queue/answer leases and tool
   binding, renew the visitor/ordering round, load the selected iframe, discover
   its current capabilities, then use its own menu data. Already-admitted effects
   settle/reconcile; disposing RPC does not prove a transaction was cancelled.
   Failed connection is visible and offers recovery; it does not silently select
   another merchant or create a fake success receipt.
6. Service mode is independent: Kiosk vs table service remains a separate
   setting. Test both modes on both mock targets. The source URL is a pickup page;
   that alone does not prove the vendor supports dine-in, unpaid table submission
   or any production payment method.
7. A future external site is usable only after verifying framing, available
   protocol/capabilities and operation access. An arbitrary cross-origin iframe
   does not grant its parent DOM control or our challenge/tool handshake. A site
   without a compatible interface needs a separately assessed, authorized page
   operation adapter. Simulated human clicks remain the operation path; do not
   fall back to hidden state writes or claim cross-site generality from the mock.

### Implementation order and acceptance

1. Confirm data anomalies, units and note policy; version the captured catalog
   and available image assets without replacing the current catalog.
2. Build the separate simulation with real controls and test-only submission;
   exercise its own UI using the current host/domain contract.
3. Add approved target selection and coordinated next-round switching, sharing
   Server persistence between the central and on-site editors.
4. Validate both targets × both service modes, followed by actual model and
   hardware acceptance separately. Include precise/fuzzy lookup, chicken/pork/
   fish/category exploration, absent items, relative quantity changes, note vs
   unsupported customization, zero/suspicious prices, changed IDs/prices/options,
   missing images, returning from recommendation, real X/add/minus/remove clicks,
   stale responses, active cart, pending payment/submission, connection failure,
   refresh persistence and immediate return to the previous approved target.

The simulation validates this catalog, this distinct UI mapping and the switch
lifecycle. It does not prove that the live ESGPB site can be embedded, automated
or submitted to. No production replacement is authorized by this planning step.
