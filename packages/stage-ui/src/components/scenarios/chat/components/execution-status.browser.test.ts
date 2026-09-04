import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import ChatExecutionStatus from './execution-status.vue'

function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    messages: {
      en: {
        stage: {
          chat: {
            status: {
              responding: 'AIRI is responding',
            },
          },
        },
      },
    },
  })
}

function createHarness(active: boolean) {
  return defineComponent({
    name: 'ChatExecutionStatusHarness',
    components: {
      ChatExecutionStatus,
    },
    setup() {
      return {
        active: shallowRef(active),
      }
    },
    template: '<ChatExecutionStatus :active="active" />',
  })
}

describe('chatExecutionStatus', () => {
  it('announces an active response as a live status', async () => {
    const screen = await render(createHarness(true), {
      global: {
        plugins: [createTestI18n()],
      },
    })

    const status = screen.getByRole('status')
    await expect.element(status).toHaveAttribute('aria-live', 'polite')
    await expect.element(status).toHaveTextContent('AIRI is responding')
  })

  it('does not render while the conversation is idle', async () => {
    const screen = await render(createHarness(false), {
      global: {
        plugins: [createTestI18n()],
      },
    })

    expect(screen.container.querySelector('[role="status"]')).toBeNull()
  })
})
