import { compareSizes } from './import/normalize'
import type { ItemView, Product, SpareStock } from './types'

export interface GridCell {
  ordered: number // all shirts ordered (any status)
  withVendor: number // ordered + sent_to_vendor: not in MART yet
  arrived: number // received + handed_over
  handedOver: number
  onShelf: number // received, not handed over
  spare: number // extra stock, not tied to an order
}

export interface GridRow {
  product: Product
  sizes: string[]
  cells: Record<string, GridCell>
  total: GridCell
}

const empty = (): GridCell => ({ ordered: 0, withVendor: 0, arrived: 0, handedOver: 0, onShelf: 0, spare: 0 })

function add(a: GridCell, b: GridCell) {
  a.ordered += b.ordered
  a.withVendor += b.withVendor
  a.arrived += b.arrived
  a.handedOver += b.handedOver
  a.onShelf += b.onShelf
  a.spare += b.spare
}

export function buildInventory(items: ItemView[], products: Product[], spare: SpareStock[]): {
  rows: GridRow[]
  total: GridCell
} {
  const rows = [...products]
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((product): GridRow => {
      const mine = items.filter((i) => i.product_id === product.id)
      const mySpare = spare.filter((s) => s.product_id === product.id)
      const sizes = [...new Set([...product.sizes, ...mine.map((i) => i.size), ...mySpare.map((s) => s.size)])].sort(
        compareSizes,
      )
      const cells: Record<string, GridCell> = {}
      for (const s of sizes) cells[s] = empty()
      for (const i of mine) {
        const c = cells[i.size]
        c.ordered++
        if (i.status === 'ordered' || i.status === 'sent_to_vendor') c.withVendor++
        if (i.status === 'received' || i.status === 'handed_over') c.arrived++
        if (i.status === 'handed_over') c.handedOver++
        if (i.status === 'received') c.onShelf++
      }
      for (const s of mySpare) cells[s.size].spare += s.quantity
      const total = empty()
      for (const s of sizes) add(total, cells[s])
      return { product, sizes, cells, total }
    })
  const total = empty()
  for (const r of rows) add(total, r.total)
  return { rows, total }
}
