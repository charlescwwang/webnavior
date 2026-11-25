import { createApp, defineComponent, h, ref } from 'vue'

import PaymentReturnButton from '../src/components/PaymentReturnButton.vue'

import { gatewayPage } from '../src/services/paymentChoice'

window.airiKioskDesktop!.onNavigation((event) => {
  gatewayPage.value = event.state === 'manual-payment' ? event : undefined
})

createApp(defineComponent({
  setup() {
    const busy = ref(false)
    return () => gatewayPage.value && h(PaymentReturnButton, {
      'label': '上一頁（付款方式）',
      'disabled': false,
      'busy': busy.value,
      'onUpdate:busy': (value: boolean) => busy.value = value,
      'owner': () => () => true,
    })
  },
})).mount('#fixture')
