<script setup lang="ts">
import type { MenuItem } from '../domain/order-machine'
import type { RecommendationPresentation } from '../webmcp'

const props = defineProps<{
  addingItemId?: string
  collapsed: boolean
  items: readonly MenuItem[]
  presentation: RecommendationPresentation
}>()

const emit = defineEmits<{
  add: [itemId: string]
  expand: []
}>()

function currency(amount: number) {
  return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(amount)
}
</script>

<template>
  <section class="recommendation-rail" data-recommendation-rail aria-labelledby="recommendation-heading">
    <button
      v-if="props.collapsed"
      type="button"
      class="recommendation-chip"
      @click="emit('expand')"
    >
      <span class="i-solar:stars-bold-duotone" aria-hidden="true" />
      推薦 {{ props.items.length }} 項
      <span class="i-solar:alt-arrow-down-linear" aria-hidden="true" />
    </button>
    <template v-else>
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
        <span class="recommendation-count">{{ props.items.length }} 項推薦</span>
      </header>
      <div class="recommendation-items">
        <article v-for="item in props.items" :key="item.id" class="recommendation-card">
          <img class="recommendation-image" :src="item.imageUrl" :alt="item.name">
          <div class="recommendation-copy">
            <h3>{{ item.name }}</h3>
            <p>{{ item.description }}</p>
          </div>
          <div class="recommendation-action">
            <strong>{{ currency(item.price) }}</strong>
            <button type="button" :disabled="props.addingItemId === item.id" @click="emit('add', item.id)">
              {{ props.addingItemId === item.id ? '加入中…' : '加入購物車' }}
            </button>
          </div>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.recommendation-rail { margin: 1rem 0 1.5rem; border: 1px solid #e9c78f; border-radius: 1.25rem; padding: 1rem; background: linear-gradient(135deg, #fff8e7, #fff0d6); box-shadow: 0 .8rem 2rem rgb(122 59 20 / 12%); }
.recommendation-heading { display: flex; align-items: start; justify-content: space-between; gap: 1rem; margin-bottom: .85rem; }
.recommendation-heading-copy { display: flex; min-width: 0; align-items: center; gap: .65rem; }.recommendation-icon { width: 2rem; height: 2rem; flex: none; color: #b75b21; font-size: 2rem; }.recommendation-heading h2 { margin: 0; color: #5d2f16; font-size: 1.05rem; }.recommendation-heading p { margin: .2rem 0 0; color: #785b47; font-size: .82rem; }.recommendation-count { flex: none; border-radius: 999px; padding: .35rem .55rem; color: #7c421f; background: #fff; font-size: .75rem; font-weight: 800; }
.recommendation-items { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: .75rem; }.recommendation-card { display: grid; min-width: 0; overflow: hidden; border: 1px solid #efdcc0; border-radius: .9rem; background: #fffdf9; grid-template-columns: 4.5rem minmax(0, 1fr); }.recommendation-image { width: 4.5rem; height: 100%; min-height: 5.6rem; object-fit: cover; }.recommendation-copy { min-width: 0; padding: .6rem .6rem .15rem; }.recommendation-copy h3 { margin: 0; color: #4d2d1f; font-size: .88rem; }.recommendation-copy p { display: -webkit-box; margin: .25rem 0 0; overflow: hidden; color: #806a5a; font-size: .7rem; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }.recommendation-action { display: flex; grid-column: 1 / span 2; align-items: center; justify-content: space-between; gap: .5rem; padding: .45rem .6rem .6rem; color: #4d2d1f; font-size: .82rem; }.recommendation-action button { border: 0; border-radius: .55rem; padding: .45rem .6rem; color: #fff; background: #c85525; font-size: .75rem; font-weight: 800; }.recommendation-action button:disabled { cursor: wait; opacity: .6; }
.recommendation-chip { display: inline-flex; align-items: center; gap: .4rem; border: 0; border-radius: 999px; padding: .5rem .7rem; color: #75401f; background: #fff; box-shadow: 0 .35rem .8rem rgb(122 59 20 / 12%); font-size: .8rem; font-weight: 800; }
@media (max-width: 700px) { .recommendation-rail { padding: .75rem; }.recommendation-heading { align-items: start; }.recommendation-count { display: none; } }
</style>
