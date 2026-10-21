import { defineInvokeEventa } from '@moeru/eventa'

export const probe = defineInvokeEventa<string, { mode: 'echo' | 'error' | 'wait' }>('test:interactive-service:probe')
