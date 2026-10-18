<script setup lang="ts">
import Button from '../../../../packages/ui/src/components/misc/button.vue'

import { orderingMessages } from '../../../../packages/i18n/src/orderingMessages'

defineProps<{ busy: boolean, confirming: boolean, table?: string }>()
const emit = defineEmits<{ request: [], confirm: [], cancel: [] }>()
const copy = orderingMessages['zh-Hant'].continuation
</script>

<template>
  <section :class="['takeout-change']" aria-labelledby="takeout-change-heading">
    <h2 id="takeout-change-heading">
      {{ confirming ? copy.confirmTitle : copy.changeTitle }}
    </h2>
    <template v-if="confirming">
      <p>{{ table ? copy.boundConfirmation.replace('{table}', table) : copy.unboundConfirmation }}</p>
      <div :class="['takeout-actions']">
        <Button type="button" :class="['takeout-button', 'takeout-cancel']" :label="copy.cancel" :disabled="busy" variant="secondary" @click="emit('cancel')" />
        <Button type="button" :class="['takeout-button']" :label="copy.confirm" :disabled="busy" @click="emit('confirm')" />
      </div>
    </template>
    <Button v-else type="button" :class="['takeout-button']" :label="copy.change" :disabled="busy" variant="secondary" @click="emit('request')" />
    <small>{{ copy.testNotice }}</small>
  </section>
</template>

<style scoped>
.takeout-change { display: grid; gap: 12px; border-top: 1px solid #ead7c9; margin-top: 24px; padding-top: 20px; }
.takeout-change h2,.takeout-change p { margin: 0; }
.takeout-change p { line-height: 1.7; }
.takeout-change small { color: #786655; line-height: 1.6; }
.takeout-actions { display: flex; flex-wrap: wrap; gap: 12px; }
.takeout-button { flex: 1; min-width: 120px; min-height: 52px; border: 1px solid #d95327; border-radius: 12px; padding: 16px; color: #fff; background: #d95327; font-size: 16px; font-weight: 700; }
.takeout-cancel { color: #72351c; background: #fff8ee; }
.takeout-button:disabled { opacity: .5; }
</style>
