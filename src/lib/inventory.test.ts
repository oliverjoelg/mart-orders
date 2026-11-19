import { describe, expect, it } from 'vitest'
import { buildInventory } from './inventory'
import { TEST_PRODUCTS } from './import/__fixtures__/fakeForm'

describe('buildInventory edge cases', () => {
  it('shows every offered size even with no orders, and adds custom sizes at the end', () => {
    const custom = {
      id: 'x',
      campaign_id: 'c1',
      buyer_id: 'b',
      product_id: 'p-white',
      size: 'Chest 38',
      print_name: null,
      batch: null,
      status: 'ordered' as const,
      status_changed_at: null,
      source_timestamp: null,
      source_slot: 1,
      created_at: '',
      buyer: { id: 'b', roll_no: 'R', name: '', email: null, phone: null, batch: null, course: null, section: null },
      product: TEST_PRODUCTS[3],
      handover: null,
    }
    const { rows } = buildInventory([custom], TEST_PRODUCTS, [])
    const white = rows.find((r) => r.product.id === 'p-white')!
    expect(white.sizes).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'Chest 38'])
    expect(white.total.ordered).toBe(1)
    expect(rows[0].product.id).toBe('p-navy')
  })
})
