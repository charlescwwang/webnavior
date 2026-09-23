<script setup lang="ts">
import type { RecommendationPresentation } from '../webmcp'

const props = defineProps<{ presentation: RecommendationPresentation }>()
</script>

<template>
  <section class="recommendation-rail" data-recommendation-rail aria-labelledby="recommendation-heading">
    <header class="recommendation-heading">
      <div class="recommendation-heading-copy">
        <span class="i-solar:stars-bold-duotone recommendation-icon" aria-hidden="true" />
        <div>
          <h2 id="recommendation-heading">
            {{ props.presentation.title ?? '為你挑選的搭配' }}
          </h2>
          <p>{{ props.presentation.reason ?? '可以直接加入購物車，也可以繼續瀏覽菜單。' }}</p>
        </div>
      </div>
      <span class="recommendation-count">{{ props.presentation.itemIds.length }} 項推薦</span>
    </header>
  </section>
</template>

<style scoped>
.recommendation-rail { margin: 1rem 0 1.5rem; border: 1px solid #e9c78f; border-radius: 1.25rem; padding: 1rem; background: linear-gradient(135deg, #fff8e7, #fff0d6); box-shadow: 0 .8rem 2rem rgb(122 59 20 / 12%); }
.recommendation-heading { display: flex; align-items: start; justify-content: space-between; gap: 1rem; }
.recommendation-heading-copy { display: flex; min-width: 0; align-items: center; gap: .65rem; }.recommendation-icon { width: 2rem; height: 2rem; flex: none; color: #b75b21; font-size: 2rem; }.recommendation-heading h2 { margin: 0; color: #5d2f16; font-size: 1.05rem; }.recommendation-heading p { margin: .2rem 0 0; color: #785b47; font-size: .82rem; }.recommendation-count { flex: none; border-radius: 999px; padding: .35rem .55rem; color: #7c421f; background: #fff; font-size: .75rem; font-weight: 800; }
@media (max-width: 700px) { .recommendation-rail { padding: .75rem; }.recommendation-heading { align-items: start; }.recommendation-count { display: none; } }
</style>
