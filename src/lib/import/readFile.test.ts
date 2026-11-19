import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { readSpreadsheet } from './readFile'

describe('readSpreadsheet', () => {
  it('keeps every digit of long transaction IDs that Excel stores as numbers', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Roll Number', 'Transaction ID', 'Amount paid'], ['PGP26-001', 512345678901, 699]]), 'Orders')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const [sheet] = await readSpreadsheet(new File([buf], 'orders.xlsx'))
    expect(sheet.rows[1]).toEqual(['PGP26-001', '512345678901', '699'])
  })
})
