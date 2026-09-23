# Webnavior dependency audit

Generated: 2026-09-14T02:23:47.667Z

This report is static dependency evidence, not a behavioral/runtime proof. It is intended to answer: "What does Webnavior actually import or call?"

## Scope

- `apps/stage-kiosk`
- `apps/order-menu`
- `packages/kiosk-proactive`
- `packages/stage-ui/src/components/scenarios/customer-session`
- `apps/stage-web/src/pages/kiosk`
- `apps/stage-web/src/pages/settings/system/kiosk-proactive.vue`
- `apps/stage-web/src/pages/settings/system/ordering-service.vue`
- `apps/server/src/routes/kiosk`
- `apps/server/src/services/domain/kiosk`
- `apps/server/src/services/domain/kiosk-audio`

## Summary

- Source files scanned: **97**
- Reused workspace packages: **7**
- Cross-workspace relative imports: **0**
- Direct external package imports: **36**
- Distinct HTTP/WebSocket/API references: **41**
- Capability-like local files in scope: **36**
- Path-matched candidates outside explicit scope: **35**

## Workspace reuse

| Workspace package | Existed at baseline | Importing files | Import refs | Sample files |
| --- | --- | ---: | ---: | --- |
| `@proj-airi/font-cjkfonts-allseto` | n/a | 1 | 1 | apps/stage-kiosk/src/main.ts |
| `@proj-airi/font-xiaolai` | n/a | 1 | 1 | apps/stage-kiosk/src/main.ts |
| `@proj-airi/i18n` | n/a | 1 | 2 | apps/stage-kiosk/src/modules/i18n.ts |
| `@proj-airi/kiosk-proactive` | n/a | 11 | 11 | apps/server/src/routes/kiosk/index.test.ts<br>apps/server/src/services/domain/kiosk/deviceSettings.ts<br>apps/server/src/services/domain/kiosk/index.ts<br>apps/stage-kiosk/src/components/KioskAssistanceReminderSettings.vue<br>apps/stage-kiosk/src/components/KioskProactiveSettings.vue<br>... +6 |
| `@proj-airi/stage-shared` | n/a | 1 | 1 | apps/stage-web/src/pages/settings/system/kiosk-proactive.vue |
| `@proj-airi/stage-ui` | n/a | 13 | 31 | apps/stage-kiosk/src/App.vue<br>apps/stage-kiosk/src/components/KioskAdminPanel.vue<br>apps/stage-kiosk/src/components/KioskConversation.vue<br>apps/stage-kiosk/src/components/KioskFeedbackInvitationSettings.vue<br>apps/stage-kiosk/src/components/KioskScene.vue<br>... +8 |
| `@proj-airi/ui` | n/a | 13 | 13 | apps/stage-kiosk/src/App.vue<br>apps/stage-kiosk/src/components/KioskAssistanceReminderSettings.vue<br>apps/stage-kiosk/src/components/KioskCameraPreviewSettings.vue<br>apps/stage-kiosk/src/components/KioskConversation.vue<br>apps/stage-kiosk/src/components/KioskFeedbackInvitationSettings.vue<br>... +8 |

## Cross-workspace relative imports

_None found._

## Direct external package imports

| Package | Files | Import refs | Sample files |
| --- | ---: | ---: | --- |
| `@formkit/auto-animate/vue` | 1 | 1 | apps/stage-kiosk/src/main.ts |
| `@guiiai/logg` | 1 | 1 | apps/server/src/services/domain/kiosk-audio/index.ts |
| `@intlify/unplugin-vue-i18n/vite` | 1 | 1 | apps/stage-kiosk/vite.config.ts |
| `@mediapipe/tasks-vision` | 1 | 1 | apps/stage-kiosk/src/composables/useKioskProactiveVision.ts |
| `@moeru/std` | 5 | 5 | apps/order-menu/src/App.vue<br>apps/order-menu/src/webmcp.ts<br>apps/stage-kiosk/src/composables/useKioskProactiveVision.ts<br>apps/stage-web/src/pages/settings/system/kiosk-proactive.vue<br>packages/stage-ui/src/components/scenarios/customer-session/CustomerSessionCompletion.vue |
| `@pinia/colada` | 1 | 1 | apps/stage-kiosk/src/main.ts |
| `@proj-airi/unplugin-live2d-sdk/vite` | 1 | 1 | apps/stage-kiosk/vite.config.ts |
| `@tresjs/core` | 1 | 1 | apps/stage-kiosk/src/main.ts |
| `@tresjs/core/template-compiler-options` | 1 | 1 | apps/stage-kiosk/vite.config.ts |
| `@unocss/reset/tailwind.css` | 1 | 1 | apps/stage-kiosk/src/main.ts |
| `@vitejs/plugin-vue` | 2 | 2 | apps/order-menu/vite.config.ts<br>apps/stage-kiosk/vite.config.ts |
| `@vueuse/core` | 5 | 5 | apps/stage-kiosk/src/components/KioskCameraPreview.vue<br>apps/stage-kiosk/src/components/KioskIdleDiagnostics.vue<br>apps/stage-kiosk/src/components/KioskScene.vue<br>apps/stage-kiosk/src/composables/useKioskCameraPreview.ts<br>packages/stage-ui/src/components/scenarios/customer-session/CustomerSessionIdleConfirmation.vue |
| `@xsai/shared-chat` | 3 | 3 | apps/stage-kiosk/src/composables/useKioskInteractionRecording.ts<br>apps/stage-kiosk/src/tools/scenario.ts<br>apps/stage-kiosk/src/tools/webmcp.ts |
| `@xsai/tool` | 2 | 2 | apps/stage-kiosk/src/tools/scenario.ts<br>apps/stage-kiosk/src/tools/webmcp.ts |
| `drizzle-orm` | 4 | 4 | apps/server/src/routes/kiosk/index.test.ts<br>apps/server/src/services/domain/kiosk/deviceSettings.test.ts<br>apps/server/src/services/domain/kiosk/index.test.ts<br>apps/server/src/services/domain/kiosk/index.ts |
| `hono` | 3 | 3 | apps/server/src/routes/kiosk/character-assets.ts<br>apps/server/src/routes/kiosk/index.test.ts<br>apps/server/src/routes/kiosk/index.ts |
| `hono/cookie` | 1 | 1 | apps/server/src/routes/kiosk/index.ts |
| `pinia` | 2 | 2 | apps/stage-kiosk/src/components/KioskScene.vue<br>apps/stage-kiosk/src/main.ts |
| `qrcode` | 1 | 1 | packages/stage-ui/src/components/scenarios/customer-session/CustomerSessionCompletion.vue |
| `reka-ui` | 2 | 2 | apps/stage-web/src/pages/kiosk/devices.vue<br>apps/stage-web/src/pages/kiosk/profiles.vue |
| `uno.css` | 1 | 1 | apps/stage-kiosk/src/main.ts |
| `unocss/vite` | 1 | 1 | apps/stage-kiosk/vite.config.ts |
| `unplugin-info/vite` | 1 | 1 | apps/stage-kiosk/vite.config.ts |
| `unplugin-yaml/vite` | 1 | 1 | apps/stage-kiosk/vite.config.ts |
| `valibot` | 3 | 3 | apps/server/src/routes/kiosk/index.ts<br>apps/server/src/services/domain/kiosk/deviceSettings.ts<br>apps/server/src/services/domain/kiosk/index.ts |
| `virtual:generated-layouts` | 1 | 1 | apps/stage-kiosk/src/main.ts |
| `vite` | 2 | 2 | apps/order-menu/vite.config.ts<br>apps/stage-kiosk/vite.config.ts |
| `vite-plugin-vue-layouts` | 1 | 1 | apps/stage-kiosk/vite.config.ts |
| `vitest` | 19 | 19 | apps/order-menu/src/domain/order-machine.test.ts<br>apps/order-menu/src/embedding-origin.test.ts<br>apps/server/src/routes/kiosk/index.test.ts<br>apps/server/src/services/domain/kiosk-audio/index.test.ts<br>apps/server/src/services/domain/kiosk/deviceSettings.test.ts<br>... +14 |
| `vitest/config` | 3 | 3 | apps/order-menu/vitest.config.ts<br>apps/stage-kiosk/vitest.config.ts<br>packages/kiosk-proactive/vitest.config.ts |
| `vue` | 32 | 32 | apps/order-menu/src/App.vue<br>apps/order-menu/src/components/menuItemCard.vue<br>apps/order-menu/src/main.ts<br>apps/stage-kiosk/src/App.vue<br>apps/stage-kiosk/src/components/KioskAdminAccess.vue<br>... +27 |
| `vue-i18n` | 6 | 6 | apps/stage-kiosk/src/components/KioskConversation.vue<br>apps/stage-kiosk/src/components/KioskOrderToolStatus.vue<br>apps/stage-kiosk/src/modules/i18n.ts<br>apps/stage-web/src/pages/kiosk/devices.vue<br>packages/stage-ui/src/components/scenarios/customer-session/CustomerSessionCompletion.vue<br>... +1 |
| `vue-router` | 7 | 7 | apps/stage-kiosk/src/App.vue<br>apps/stage-kiosk/src/components/KioskAdminAccess.vue<br>apps/stage-kiosk/src/main.ts<br>apps/stage-kiosk/src/pages/index.vue<br>apps/stage-kiosk/src/typed-router.d.ts<br>... +2 |
| `vue-router/auto-routes` | 1 | 1 | apps/stage-kiosk/src/main.ts |
| `vue-router/vite` | 1 | 1 | apps/stage-kiosk/vite.config.ts |
| `vue-sonner/style.css` | 1 | 1 | apps/stage-kiosk/src/main.ts |

## HTTP / WebSocket / API references

| Endpoint / URL | Files | Sample files |
| --- | ---: | --- |
| `/api/kiosk` | 2 | apps/server/src/routes/kiosk/index.test.ts<br>apps/server/src/routes/kiosk/index.ts |
| `/api/kiosk/audio/speech` | 2 | apps/server/src/routes/kiosk/index.test.ts<br>apps/stage-kiosk/src/services/kiosk-device.ts |
| `/api/kiosk/audio/transcriptions` | 2 | apps/server/src/routes/kiosk/index.test.ts<br>apps/stage-kiosk/src/services/kiosk-device.ts |
| `/api/kiosk/bootstrap` | 2 | apps/server/src/routes/kiosk/index.test.ts<br>apps/stage-kiosk/src/services/kiosk-device.ts |
| `/api/kiosk/development/register` | 2 | apps/server/src/routes/kiosk/index.test.ts<br>apps/stage-kiosk/src/services/kiosk-device.ts |
| `/api/kiosk/settings` | 3 | apps/server/src/routes/kiosk/index.test.ts<br>apps/stage-kiosk/src/pages/settings/kiosk.vue<br>apps/stage-kiosk/src/services/kiosk-device.ts |
| `/api/kiosk/visitor-sessions` | 2 | apps/server/src/routes/kiosk/index.test.ts<br>apps/stage-kiosk/src/services/kiosk-device.ts |
| `/v1/audio/transcriptions` | 1 | apps/server/src/services/domain/kiosk-audio/index.test.ts |
| `http://192.168.8.58:5169/kiosk/` | 1 | apps/order-menu/src/embedding-origin.test.ts |
| `http://localhost:5166` | 3 | apps/server/src/routes/kiosk/index.test.ts<br>apps/server/src/services/domain/kiosk/index.ts<br>apps/stage-kiosk/src/composables/useKioskInteractiveServices.ts |
| `http://localhost:5168` | 3 | apps/stage-kiosk/src/composables/useKioskCharacterAsset.ts<br>apps/stage-kiosk/src/pages/settings/kiosk.vue<br>apps/stage-kiosk/src/services/kiosk-device.ts |
| `http://localhost:5169` | 1 | apps/order-menu/src/embedding-origin.test.ts |
| `http://localhost:5169/` | 1 | apps/order-menu/src/embedding-origin.test.ts |
| `https://airi.example.com` | 1 | apps/order-menu/src/embedding-origin.test.ts |
| `https://asr.example.com/v1` | 1 | apps/server/src/services/domain/kiosk-audio/index.test.ts |
| `https://attacker.example` | 1 | apps/stage-kiosk/src/services/scenario-registry.test.ts |
| `https://attacker.example.com/should-not-apply` | 1 | apps/server/src/services/domain/kiosk/index.test.ts |
| `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm` | 1 | apps/stage-kiosk/src/composables/useKioskProactiveVision.ts |
| `https://edge-tts.aikcitri.qzz.io/v1` | 1 | apps/server/src/services/domain/kiosk-audio/index.test.ts |
| `https://edge-tts.aikcitri.qzz.io/v1/audio/speech` | 1 | apps/server/src/services/domain/kiosk-audio/index.test.ts |
| `https://example.com/kiosk-feedback` | 1 | apps/server/src/services/domain/kiosk/index.ts |
| `https://example.com/order` | 1 | apps/server/src/services/domain/kiosk/index.test.ts |
| `https://example.com/stickers` | 1 | apps/stage-kiosk/src/components/KioskInteractiveServicesSettings.vue |
| `https://example.com/survey` | 2 | apps/server/src/services/domain/kiosk/index.test.ts<br>apps/stage-kiosk/src/components/KioskFeedbackInvitationSettings.vue |
| `https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=720&q=80` | 1 | apps/order-menu/src/domain/order-machine.ts |
| `https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=720&q=80` | 1 | apps/order-menu/src/domain/order-machine.ts |
| `https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=720&q=80` | 1 | apps/order-menu/src/domain/order-machine.ts |
| `https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=720&q=80` | 1 | apps/order-menu/src/domain/order-machine.ts |
| `https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=720&q=80` | 1 | apps/order-menu/src/domain/order-machine.ts |
| `https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=720&q=80` | 1 | apps/order-menu/src/domain/order-machine.ts |
| `https://images.unsplash.com/photo-1585032226651-759b368d7246?auto=format&fit=crop&w=720&q=80` | 1 | apps/order-menu/src/domain/order-machine.ts |
| `https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=720&q=80` | 1 | apps/order-menu/src/domain/order-machine.ts |
| `https://menu.example` | 2 | apps/stage-kiosk/src/services/scenario-registry.test.ts<br>apps/stage-kiosk/src/services/webmcp-adapter.test.ts |
| `https://menu.example/disabled` | 1 | apps/stage-kiosk/src/services/scenario-registry.test.ts |
| `https://menu.example/order` | 1 | apps/stage-kiosk/src/services/scenario-registry.test.ts |
| `https://other.example/order` | 1 | apps/stage-kiosk/src/services/scenario-registry.test.ts |
| `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` | 1 | apps/stage-kiosk/src/composables/useKioskProactiveVision.ts |
| `https://www.chous.com.tw/chous/products.html` | 1 | apps/order-menu/src/domain/order-machine.ts |
| `https://www.chous.com.tw/shoppingcool/m_mall_list.php?ps_ctid=01000000` | 1 | apps/order-menu/src/domain/order-machine.ts |
| `https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html` | 1 | apps/stage-kiosk/public/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js |
| `https://www.ubereats.com/tw/store/%E5%91%A8%E6%B0%8F%E8%9D%A6%E6%8D%B2%E5%AE%89%E5%B9%B3%E7%B8%BD%E5%BA%97/DAYskMw4VRe-vPy29-EfNQ` | 1 | apps/order-menu/src/domain/order-machine.ts |

## Potential bypass / parallel-implementation signals

- **Direct MediaPipe dependency: @mediapipe/tasks-vision**
  - Repo also contains @proj-airi/model-driver-mediapipe; verify whether direct SDK use is intentional.
  - Files: apps/stage-kiosk/src/composables/useKioskProactiveVision.ts
- **Direct audio API reference: /api/kiosk/audio/transcriptions**
  - This may be legitimate API-level reuse, or it may bypass shared frontend speech/hearing runtime. Trace this path next.
  - Files: apps/server/src/routes/kiosk/index.test.ts<br>apps/stage-kiosk/src/services/kiosk-device.ts
- **Direct audio API reference: /api/kiosk/audio/speech**
  - This may be legitimate API-level reuse, or it may bypass shared frontend speech/hearing runtime. Trace this path next.
  - Files: apps/server/src/routes/kiosk/index.test.ts<br>apps/stage-kiosk/src/services/kiosk-device.ts
- **Direct audio API reference: https://edge-tts.aikcitri.qzz.io/v1/audio/speech**
  - This may be legitimate API-level reuse, or it may bypass shared frontend speech/hearing runtime. Trace this path next.
  - Files: apps/server/src/services/domain/kiosk-audio/index.test.ts
- **Direct audio API reference: /v1/audio/transcriptions**
  - This may be legitimate API-level reuse, or it may bypass shared frontend speech/hearing runtime. Trace this path next.
  - Files: apps/server/src/services/domain/kiosk-audio/index.test.ts

## Capability-like local files in Webnavior scope

- `apps/order-menu/src/App.vue`
- `apps/order-menu/src/components/menuItemCard.vue`
- `apps/order-menu/src/domain/order-machine.test.ts`
- `apps/order-menu/src/domain/order-machine.ts`
- `apps/order-menu/src/embedding-origin.test.ts`
- `apps/order-menu/src/embedding-origin.ts`
- `apps/order-menu/src/env.d.ts`
- `apps/order-menu/src/main.ts`
- `apps/order-menu/src/webmcp.ts`
- `apps/order-menu/vite.config.ts`
- `apps/order-menu/vitest.config.ts`
- `apps/server/src/services/domain/kiosk-audio/index.test.ts`
- `apps/server/src/services/domain/kiosk-audio/index.ts`
- `apps/stage-kiosk/src/components/KioskCameraPreview.vue`
- `apps/stage-kiosk/src/components/KioskCameraPreviewSettings.vue`
- `apps/stage-kiosk/src/components/KioskOrderToolStatus.vue`
- `apps/stage-kiosk/src/components/KioskSessionNotice.vue`
- `apps/stage-kiosk/src/components/kioskEnrollment.vue`
- `apps/stage-kiosk/src/composables/useKioskCameraPreview.ts`
- `apps/stage-kiosk/src/composables/useKioskCustomerSession.test.ts`
- `apps/stage-kiosk/src/composables/useKioskCustomerSession.ts`
- `apps/stage-kiosk/src/composables/useKioskInteractionRecording.test.ts`
- `apps/stage-kiosk/src/composables/useKioskInteractionRecording.ts`
- `apps/stage-kiosk/src/composables/useKioskProactiveVision.ts`
- `apps/stage-kiosk/src/services/admin-session.ts`
- `apps/stage-kiosk/src/services/kiosk-audio.test.ts`
- `apps/stage-kiosk/src/services/kiosk-audio.ts`
- `apps/stage-kiosk/src/services/webmcp-adapter.test.ts`
- `apps/stage-kiosk/src/services/webmcp-adapter.ts`
- `apps/stage-kiosk/src/tools/webmcp.ts`
- `apps/stage-web/src/pages/settings/system/ordering-service.vue`
- `packages/kiosk-proactive/src/session.test.ts`
- `packages/kiosk-proactive/src/session.ts`
- `packages/stage-ui/src/components/scenarios/customer-session/CustomerSessionCompletion.vue`
- `packages/stage-ui/src/components/scenarios/customer-session/CustomerSessionIdleConfirmation.vue`
- `packages/stage-ui/src/components/scenarios/customer-session/index.ts`

## Candidates outside explicit scope

These are path-name matches only. They help find Webnavior code that may have leaked into shared AIRI areas.

- `apps/server/src/routes/admin/kiosk/character-assets.ts`
- `apps/server/src/routes/admin/kiosk/index.ts`
- `apps/server/src/routes/admin/kiosk/route.test.ts`
- `apps/server/src/schemas/kiosk.ts`
- `apps/server/src/scripts/create-local-webnavior-admin.ts`
- `apps/server/src/scripts/seed-webnavior-test-accounts.ts`
- `apps/server/src/services/domain/kiosk-character-assets.ts`
- `apps/server/src/services/domain/kiosk-media.ts`
- `apps/stage-web/src/components/Webnavior/AdminMetric.vue`
- `apps/stage-web/src/components/Webnavior/AdminSidebar.vue`
- `apps/stage-web/src/components/Webnavior/ConversationModelList.vue`
- `apps/stage-web/src/components/Webnavior/SystemModelOverview.vue`
- `apps/stage-web/src/components/Webnavior/WebnaviorNoticeCenter.vue`
- `apps/stage-web/src/components/Webnavior/audioProviderConnection.vue`
- `apps/stage-web/src/components/Webnavior/dashboardExperienceOverview.vue`
- `apps/stage-web/src/components/Webnavior/dashboardNextAction.vue`
- `apps/stage-web/src/components/Webnavior/experienceEditorSection.vue`
- `apps/stage-web/src/components/Webnavior/kioskExperiencePreview.vue`
- `apps/stage-web/src/components/Webnavior/kioskModelPolicyEditor.vue`
- `apps/stage-web/src/components/Webnavior/kioskProfileEditor.vue`
- `apps/stage-web/src/components/Webnavior/kioskVisitorSessionList.vue`
- `apps/stage-web/src/components/Webnavior/kioskVisitorSessionMedia.vue`
- `apps/stage-web/src/components/Webnavior/kioskVisitorSessionTranscript.vue`
- `apps/stage-web/src/components/Webnavior/modelProviderConnection.vue`
- `apps/stage-web/src/composables/useKioskManagement.ts`
- `apps/stage-web/src/composables/useWebnaviorNotice.ts`
- `apps/stage-web/src/layouts/webnavior-admin.vue`
- `apps/stage-web/src/modules/kiosk-proactive/catalog.ts`
- `apps/stage-web/src/pages/settings/system/components/KioskAssistanceReminderSettings.vue`
- `apps/stage-web/src/pages/settings/system/components/KioskProactiveCameraTest.vue`
- `apps/stage-web/src/pages/settings/system/components/KioskProactiveGreetingPrompts.vue`
- `packages/stage-ui/src/components/scenarios/kiosk/deviceSettings.ts`
- `packages/stage-ui/src/components/scenarios/kiosk/deviceSettingsEditor.vue`
- `packages/stage-ui/src/components/scenarios/kiosk/deviceSettingsPanel.vue`
- `packages/stage-ui/src/composables/use-kiosk-customer-session.ts`
