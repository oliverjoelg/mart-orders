import { describe, expect, it } from 'vitest'
import { buildExport, emailList, exportRows, rollList } from './exports'
import { buildInventory } from './inventory'
import { TEST_PRODUCTS } from './import/__fixtures__/fakeForm'
import type { Buyer, ItemStatus, ItemView } from './types'

const [navy, pink, black] = TEST_PRODUCTS

function buyer(n: number, section = 'Section A'): Buyer {
  return {
    id: `b${n}`,
    roll_no: `R00${n}`,
    name: `Student ${n}`,
    email: n === 4 ? null : `s${n}@example.test`,
    phone: null,
    batch: "PG'26",
    course: 'PGDM',
    section,
  }
}

let seq = 0
function item(b: Buyer, product = navy, size = 'M', status: ItemStatus = 'ordered', other = false): ItemView {
  seq++
  return {
    id: `i${seq}`,
    campaign_id: 'c1',
    buyer_id: b.id,
    product_id: product.id,
    size,
    print_name: null,
    batch: b.batch,
    status,
    status_changed_at: null,
    source_timestamp: null,
    source_slot: 1,
    created_at: '',
    buyer: b,
    product,
    handover:
      status === 'handed_over'
        ? {
            id: `h${seq}`,
            item_id: `i${seq}`,
            type: other ? 'collected_by_other' : 'self',
            collector_name: other ? 'Friend' : null,
            collector_roll: other ? 'R999' : null,
            handed_by: 'u-ops',
            handed_at: '',
            undone_at: null,
            undo_reason: null,
          }
        : null,
  }
}

const b1 = buyer(1)
const b2 = buyer(2)
const b3 = buyer(3, 'Section B')
const b4 = buyer(4)
const items: ItemView[] = [
  // b1: both shirts arrived -> on the call list
  item(b1, navy, 'M', 'received'),
  item(b1, navy, 'M', 'received'),
  // b2: one arrived, one still with vendor -> only when "partly arrived" is on
  item(b2, pink, 'S', 'received'),
  item(b2, black, 'L', 'sent_to_vendor'),
  // b3: collected by a friend
  item(b3, black, 'XL', 'handed_over', true),
  // b4: nothing arrived, no email
  item(b4, navy, 'L', 'ordered'),
]

describe('buildExport', () => {
  it('call list: fully arrived students only, one line each', () => {
    const lines = buildExport(items, 'call_list', {})
    expect(lines.map((l) => [l.roll_no, l.shirts, l.count])).toEqual([['R001', 'Navy Blue M ×2', 2]])
  })

  it('call list with partly-arrived students', () => {
    const lines = buildExport(items, 'call_list', { includePartly: true })
    expect(lines.map((l) => [l.roll_no, l.shirts, l.pending])).toEqual([
      ['R001', 'Navy Blue M ×2', 0],
      ['R002', 'Baby Pink S', 1],
    ])
  })

  it('not yet arrived', () => {
    const lines = buildExport(items, 'not_arrived', {})
    expect(lines.map((l) => l.roll_no)).toEqual(['R002', 'R004'])
  })

  it('collected, with who handed over and who collected', () => {
    const lines = buildExport(items, 'collected', {}, () => 'Ops Person')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ roll_no: 'R003', handedBy: 'Ops Person', collectedBy: 'Friend (R999)' })
  })

  it('filters by product, size and section', () => {
    expect(buildExport(items, 'not_arrived', { productId: black.id }).map((l) => l.roll_no)).toEqual(['R002'])
    expect(buildExport(items, 'not_arrived', { size: 'L' }).map((l) => l.roll_no)).toEqual(['R002', 'R004'])
    expect(buildExport(items, 'collected', { section: 'Section A' })).toHaveLength(0)
  })

  it('copies roll numbers one per line and emails ready for Bcc', () => {
    const lines = buildExport(items, 'not_arrived', {})
    expect(rollList(lines)).toBe('R002\nR004')
    expect(emailList(lines)).toBe('s2@example.test') // b4 has no email
  })

  it('CSV rows have a header and one row per student', () => {
    const rows = exportRows(buildExport(items, 'collected', {}), 'collected')
    expect(rows[0]).toContain('Collected by')
    expect(rows).toHaveLength(2)
  })
})

describe('buildInventory', () => {
  it('counts product × size', () => {
    const { rows, total } = buildInventory(items, TEST_PRODUCTS, [
      { id: 's1', product_id: navy.id, size: 'M', quantity: 3, note: null },
    ])
    const navyRow = rows.find((r) => r.product.id === navy.id)!
    expect(navyRow.cells.M).toEqual({ ordered: 2, withVendor: 0, arrived: 2, handedOver: 0, onShelf: 2, spare: 3 })
    expect(navyRow.cells.L.withVendor).toBe(1)
    expect(total).toEqual({ ordered: 6, withVendor: 2, arrived: 4, handedOver: 1, onShelf: 3, spare: 3 })
  })
})
