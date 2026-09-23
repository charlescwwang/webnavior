<template>
  <main class="configuration-error">
    <section class="configuration-error-card" aria-labelledby="configuration-error-title">
      <h1 id="configuration-error-title">
        Webnavior Server 未設定
      </h1>
      <p>
        缺少建置期環境變數 <code>VITE_SERVER_URL</code>，因此系統不會連線到任何 API。
      </p>
      <p>
        本機開發請在 <code>apps/stage-web/.env.local</code> 設定
        <code>VITE_SERVER_URL=http://localhost:5168</code>，然後重新啟動 Stage Web。
      </p>
    </section>
  </main>
</template>

<style scoped>
.configuration-error {
  box-sizing: border-box;
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 1.5rem;
  color: #172033;
  background: #f7f8fc;
  font-family: system-ui, sans-serif;
}

.configuration-error-card {
  max-width: 36rem;
  padding: 2rem;
  border: 1px solid #f0c9c9;
  border-radius: 0.75rem;
  background: #fff;
  box-shadow: 0 1rem 2rem rgb(23 32 51 / 10%);
}

.configuration-error-card h1 {
  margin: 0 0 1rem;
  font-size: 1.5rem;
}

.configuration-error-card p {
  margin: 0.75rem 0 0;
  line-height: 1.6;
}

.configuration-error-card code {
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
  color: #9f1239;
  background: #fff1f2;
  font-family: ui-monospace, monospace;
}
</style>
