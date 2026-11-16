import snapshot from './vendorCatalog.json' with { type: 'json' }

/** Frozen public API snapshot; the original numeric IDs remain the service identity. */
export const revision = 'pb-1kgJeql-2026-11-16-v6'
export const basePath = '/order/store/1kgJeql/internal_use'
export const tables = ['櫃台取餐', 'A1 桌', 'A2 桌', 'A3 桌', ...Array.from({ length: 7 }, (_, i) => `B${i + 1} 吧檯`)]
export const categories = snapshot.categories.map(category => ({ ...category, id: String(category.id) }))
const aliases = ['chicken', 'pork', 'three-cup', 'soy-chicken', 'dumplings', 'beef-noodles', 'spicy-noodles', 'soup-dumplings', 'beef-soup', 'egg-soup', 'fish-soup', 'combo-a', 'combo-b']
export const products = snapshot.products.map((item, index) => ({
  ...item,
  vendorId: item.id,
  id: aliases[index],
  categoryId: String(item.categoryId),
  image: item.id === 2503 ? '/assets/chicken.jpg' : item.id === 2504 ? '/assets/pork.jpg' : undefined,
  ...(item.id === 2589 ? { extraPrice: 8, extraMax: 100 } : {}),
}))
