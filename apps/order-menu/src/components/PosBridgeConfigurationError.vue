<template>
  <main class="configuration-error">
    <section>
      <p class="eyebrow">
        POS Bridge 未設定
      </p>
      <h1>無法安全地提交訂單</h1>
      <p>
        缺少建置期環境變數 <code>VITE_ORDER_MENU_SERVER_URL</code>，因此點餐服務不會建立本機模擬訂單或連線到未指定的 POS。
      </p>
      <p>
        在 <code>apps/order-menu/.env.local</code> 設定 <code>VITE_ORDER_MENU_SERVER_URL=http://127.0.0.1:5170</code>，並重新啟動 Order Menu。
      </p>
    </section>
  </main>
</template>

<style scoped>
.configuration-error {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 24px;
  background: #fff7f2;
  color: #422f29;
}

section {
  max-width: 640px;
  padding: 32px;
  border: 1px solid #ecb99d;
  border-radius: 20px;
  background: white;
  box-shadow: 0 20px 60px rgb(80 40 20 / 12%);
}

.eyebrow {
  margin: 0;
  color: #b44718;
  font-weight: 700;
}

h1 {
  margin: 8px 0 16px;
}

p {
  line-height: 1.65;
}

code {
  padding: 2px 5px;
  border-radius: 4px;
  background: #f8e8dd;
}
</style>
