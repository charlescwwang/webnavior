import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'apps/server',
      {
        test: {
          name: 'kiosk-field-regressions',
          environment: 'node',
          maxWorkers: 2,
          // Keep field failures in the root CI entry point; the application
          // test configs are otherwise outside this workspace project list.
          include: [
            'apps/stage-kiosk/src/services/historicalReplies.test.ts',
            'apps/stage-kiosk/src/services/fieldRegression.test.ts',
            'apps/stage-kiosk/src/services/orderingSkill.test.ts',
            'apps/stage-kiosk/src/composables/useKioskInteractionRecording.test.ts',
            'apps/stage-kiosk/src/services/questionPresentation.test.ts',
            'apps/stage-kiosk/src/services/priceHandoff.test.ts',
            'apps/stage-kiosk/src/services/serviceClarification.test.ts',
            'apps/order-menu/src/questions.test.ts',
            'apps/order-menu/src/seatingRuntime.test.ts',
            'apps/order-menu/src/queryActions.test.ts',
            'apps/order-menu/src/evaluation/conversationMatrix.test.ts',
            'apps/order-menu/src/recommendationFlow.test.ts',
            'apps/order-menu/src/agentTargetRecovery.test.ts',
            'apps/order-menu/src/mealClarification.test.ts',
            'apps/order-menu/src/conversationProgress.test.ts',
            'apps/order-menu/src/conversationMenus.test.ts',
            'apps/order-menu/src/kiosk-intents.test.ts',
          ],
        },
      },
      'apps/ui-server-auth',
      'apps/stage-tamagotchi',
      'packages/cap-vite',
      'packages/core-agent',
      'packages/vishot-runner-browser',
      'packages/better-ws',
      'packages/plugin-sdk',
      'packages/plugin-sdk-tamagotchi',
      'packages/server-runtime',
      'packages/server-sdk',
      'packages/stage-shared',
    ],
  },
})
