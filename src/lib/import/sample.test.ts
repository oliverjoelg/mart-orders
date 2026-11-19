import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseFormRows } from './parseForm'
import { buildSampleRows } from './sample'
import { TEST_PRODUCTS } from './__fixtures__/fakeForm'

describe('sample order file', () => {
  const rows = buildSampleRows(TEST_PRODUCTS, new Date('2026-11-19T10:00:00'))

  it('imports cleanly: 2 students, 3 items, matching the form total', () => {
    const p = parseFormRows(rows[0], rows.slice(1), TEST_PRODUCTS)
    expect(p.fatal).toEqual([])
    expect(p.stats.responses).toBe(2)
    expect(p.stats.shirts).toBe(3)
    expect(p.stats.declaredTotal).toBe(3)
    expect(p.stats.blocked).toBe(0)
    expect(p.items.map((i) => [i.roll_no, i.product_id, i.print_name])).toEqual([
      ['PGP26-001', 'p-navy', 'ASHA'],
      ['PGP26-002', 'p-navy', null],
      ['PGP26-002', 'p-pink', 'MOM'],
    ])
  })

  it('survives a round trip through a real .xlsx file', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Orders')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const back = XLSX.read(buf)
    const sheet = XLSX.utils.sheet_to_json<string[]>(back.Sheets.Orders, { header: 1, raw: false, defval: '' })
    const p = parseFormRows(sheet[0], sheet.slice(1), TEST_PRODUCTS)
    expect(p.stats.shirts).toBe(3)
    expect(p.responses[1].amount_paid).toBe(1398)
  })

  it('rows without a timestamp are not mistaken for already-imported ones', () => {
    const noTs = rows.map((r, i) => (i === 0 ? r : ['', ...r.slice(1)]))
    const first = parseFormRows(noTs[0], noTs.slice(1), TEST_PRODUCTS)
    const existing = first.items.slice(0, 1).map((i) => ({
      roll_no: i.roll_no, product_id: i.product_id!, size: i.size, print_name: i.print_name,
      source_timestamp: null, source_slot: i.slot,
    }))
    // PGP26-001 slot 1 is "in the tool"; PGP26-002's items are different and must still import
    const again = parseFormRows(noTs[0], noTs.slice(1), TEST_PRODUCTS, existing)
    expect(again.stats.alreadyImported).toBe(0)
    expect(again.items.filter((i) => i.include).map((i) => i.roll_no)).toEqual(['PGP26-002', 'PGP26-002'])
  })
})
