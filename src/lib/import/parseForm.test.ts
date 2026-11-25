import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import { buildColumnMap } from './headers'
import { parseFormCsv, type ExistingItem } from './parseForm'
import {
  BATCH_FORM_HEADERS,
  FAKE_BATCH_FORM_CSV,
  FAKE_BATCH_FORM_SHIRTS,
  FAKE_REOPENING_CSV,
  TEST_PRODUCTS,
} from './__fixtures__/fakeForm'

describe('buildColumnMap (2026 batch form layout)', () => {
  const map = buildColumnMap(BATCH_FORM_HEADERS)

  it('finds the buyer columns', () => {
    expect(map.timestamp).toBe(0)
    expect(map.email).toBe(1)
    expect(map.buyerName).toBe(2)
    expect(map.phone).toBe(3)
    expect(map.roll).toBe(4)
    expect(map.batch).toBe(5)
    expect(map.course).toBe(6)
    expect(map.section).toBe(7)
    expect(map.total).toBe(26)
    expect(map.comments).toBe(37)
  })

  it('maps four shirt slots, including the columns appended after the form was edited', () => {
    expect(map.slots).toHaveLength(4)
    expect(map.slots[0]).toEqual({ colour: [8], size: [9], print: [10], batch: [] })
    expect(map.slots[1]).toEqual({ colour: [12, 33], size: [14], print: [15], batch: [13, 30] })
    expect(map.slots[2]).toEqual({ colour: [17, 34], size: [18], print: [20], batch: [19, 31] })
    expect(map.slots[3]).toEqual({ colour: [22, 35], size: [23], print: [25], batch: [24, 32] })
  })
})

describe('parseFormCsv on the fake batch form', () => {
  const preview = parseFormCsv(FAKE_BATCH_FORM_CSV, TEST_PRODUCTS)

  it('turns every response into one row per shirt', () => {
    expect(preview.fatal).toEqual([])
    expect(preview.stats.responses).toBe(7)
    expect(preview.stats.blankRows).toBe(2)
    expect(preview.stats.shirts).toBe(FAKE_BATCH_FORM_SHIRTS)
    expect(preview.items).toHaveLength(14)
  })

  it('matches the form total ("Total No. of t-shirt ordered")', () => {
    expect(preview.stats.declaredTotal).toBe(14)
    expect(preview.stats.countMismatches).toBe(0)
    for (const r of preview.responses) expect(r.shirts).toBe(r.declared_total)
  })

  it('flags the repeated response for review instead of adding it', () => {
    expect(preview.stats.duplicates).toBe(1)
    const dup = preview.items.find((i) => i.issues.includes('duplicate'))!
    expect(dup.row).toBe(7)
    expect(dup.roll_no).toBe('PGP26-001')
    expect(dup.include).toBe(false)
    expect(dup.duplicateOf).toBe('Same shirt as row 2')
    expect(preview.stats.toImport).toBe(13)
  })

  it('does not flag two identical shirts in the same response', () => {
    const zed = preview.items.filter((i) => i.roll_no === 'PGP26-006')
    expect(zed).toHaveLength(2)
    expect(zed.every((i) => i.include)).toBe(true)
  })

  it('normalises roll numbers, sizes, colours, back names and batches', () => {
    const s3 = preview.items.filter((i) => i.roll_no === 'PGP26-003')
    expect(s3.map((i) => [i.slot, i.product_id, i.size, i.print_name, i.batch])).toEqual([
      [1, 'p-pink', 'XXS', 'Riya', "PG'26"],
      [2, 'p-white', 'XL', null, "PG'26"],
      [3, 'p-navy', 'M', 'Dad', "PG'26"],
    ])
    const s2 = preview.items.filter((i) => i.roll_no === 'PGP26-002')
    expect(s2.map((i) => [i.product_id, i.size, i.print_name, i.batch])).toEqual([
      ['p-black', 'L', null, "PG'26"],
      ['p-pink', 'S', 'MOM', "PG'25"],
    ])
  })

  it('keeps a typed-in size as a custom size and flags it', () => {
    const custom = preview.items.find((i) => i.issues.includes('custom_size'))!
    expect(custom.size).toBe('Chest - 38 and Length - 27.5 / 28')
    expect(custom.product_id).toBe('p-white')
    expect(custom.include).toBe(true)
    expect(preview.responses.find((r) => r.roll_no === 'PGP26-005')!.comment).toBe('NEED TO COLLECT CASH')
  })

  it('collects one buyer per roll number with contact details', () => {
    expect(preview.buyers).toHaveLength(6)
    const b = preview.buyers.find((x) => x.roll_no === 'PGP26-001')!
    expect(b).toMatchObject({ name: 'Test Student 1', email: 'student1@example.test', batch: "PG'26", section: 'Section A' })
  })

  it('stores form timestamps as India time', () => {
    expect(preview.items[0].source_timestamp).toBe('2026-09-04T20:22:09+05:30')
  })
})

describe('amount paid check', () => {
  it('shows what a typo in the total looks like next to the amount paid', () => {
    const csv =
      'Timestamp,Roll Number,T-shirt Details Color,Size,Total No. of t-shirt ordered,Amount paid\n' +
      '2026-09-04 10:00:00,X1,Premium UCB Black,M,2,1049\n'
    const p = parseFormCsv(csv, TEST_PRODUCTS)
    expect(p.stats.countMismatches).toBe(1)
    expect(p.responses[0]).toMatchObject({ declared_total: 2, shirts: 1, amount_paid: 1049, expected_amount: 1049 })
  })
})

describe('re-importing', () => {
  it('skips responses already in the tool and flags same-shirt orders from new responses', () => {
    const first = parseFormCsv(FAKE_BATCH_FORM_CSV, TEST_PRODUCTS)
    const existing: ExistingItem[] = first.items
      .filter((i) => i.include && i.product_id)
      .map((i) => ({
        roll_no: i.roll_no,
        product_id: i.product_id!,
        size: i.size,
        print_name: i.print_name,
        source_timestamp: i.source_timestamp,
        source_slot: i.slot,
      }))
    const again = parseFormCsv(FAKE_BATCH_FORM_CSV, TEST_PRODUCTS, existing)
    expect(again.stats.alreadyImported).toBe(13)
    expect(again.stats.toImport).toBe(0)
  })
})

describe('parseFormCsv on the reopening layout', () => {
  const preview = parseFormCsv(FAKE_REOPENING_CSV, TEST_PRODUCTS)

  it('maps numbered columns and parses D/M/Y timestamps', () => {
    expect(preview.fatal).toEqual([])
    expect(preview.columns.slots).toHaveLength(4)
    expect(preview.stats.shirts).toBe(3)
    expect(preview.stats.declaredTotal).toBe(3)
    expect(preview.items[0].source_timestamp).toBe('2026-11-10T14:05:00+05:30')
    expect(preview.buyers.find((b) => b.roll_no === 'PGP26-101')!.email).toBe('late@example.test')
    expect(preview.items[1]).toMatchObject({ product_id: 'p-black', size: 'XXL', print_name: 'LB' })
  })
})

describe('parseFormCsv errors', () => {
  it('reports a file that is not a form export', () => {
    const p = parseFormCsv('a,b,c\n1,2,3\n', TEST_PRODUCTS)
    expect(p.fatal.length).toBeGreaterThan(0)
  })

  it('blocks shirts whose colour matches no product', () => {
    const csv = 'Timestamp,Roll Number,T-shirt Details Color,Size\n2026-09-04 10:00:00,X1,Rainbow,M\n'
    const p = parseFormCsv(csv, TEST_PRODUCTS)
    expect(p.items[0].issues).toContain('unknown_product')
    expect(p.items[0].include).toBe(false)
    expect(p.stats.blocked).toBe(1)
  })
})

describe('payment columns', () => {
  it('finds paid-to, transaction ID, amount and screenshot in both form layouts', () => {
    const batch = buildColumnMap(BATCH_FORM_HEADERS)
    expect([batch.paidTo, batch.txn, batch.amount, batch.screenshot]).toEqual([36, 27, 28, 29])
    // the payment columns must not be mistaken for shirt columns
    expect(batch.slots).toHaveLength(4)
  })
  it('keeps each response’s payment details', () => {
    const p = parseFormCsv(FAKE_REOPENING_CSV, TEST_PRODUCTS)
    expect(p.responses.map((r) => [r.paid_to, r.txn_id, r.amount_paid])).toEqual([
      ['QR', 'T1', 1748],
      ['QR', 'T2', 1049],
    ])
    expect(p.responses[0].source_timestamp).not.toBeNull()
  })
})

describe('2026 hoodie form layout ("Select your winter merch")', () => {
  const H = [
    'Timestamp', 'Email Address', 'Your Name', 'Roll Number', 'Section ',
    'Select your winter merch.\nNote: We have created relaxed version of these designs\n Official merch value = 50-60 euros. \n MART value = Rs 1050-1100 ',
    'Size', 'Do you want to order another item?', 'Select your winter merch', 'Size 2',
    'Do you want to order another item? 2', 'Select your winter merch 2', 'Size 3',
    'Select QR Code', 'Transaction ID', 'Total number of items bought', 'Amount Paid',
    'Upload Screenshot of Payment. \nMake sure Transaction ID, Amount and other details are presesnt',
  ]
  const HOODIES = [
    { id: 'h-emlyon', campaign_id: 'c2', name: 'Emlyon Hoodie', colour: 'Emlyon', price_inr: 1049, sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], form_keywords: ['emlyon', 'hoodie'], sort_order: 1 },
    { id: 'h-escp', campaign_id: 'c2', name: 'ESCP Hoodie', colour: 'ESCP', price_inr: 1049, sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], form_keywords: ['escp', 'hoodie'], sort_order: 2 },
    { id: 'h-zip', campaign_id: 'c2', name: 'ESCP Quarter Zip', colour: 'ESCP Zip', price_inr: 1099, sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], form_keywords: ['escp', 'quarter', 'zip'], sort_order: 3 },
  ]
  const EM = 'Emlyon Hoodie (Relaxed Fit)   ₹1049'
  const ES = 'ESCP Hoodie (Relaxed fit)  ₹1049'
  const QZ = 'ESCP Quarter Zip (Relaxed Fit)  ₹1099'
  const row = (cells: string[]) => cells
  const csv = Papa.unparse([
    H,
    row(['11/20/2026 10:00:00', 'a@example.test', 'Asha Rao', 'IB26-001', 'IB A', EM, 'M', 'No', '', '', '', '', '', 'Deepanshu', 'T1', '1', '1049', 'https://drive.google.com/a']),
    row(['11/20/2026 10:05:00', 'b@example.test', 'Ben Das', 'IB26-002', 'IB B', QZ, 'L', 'Yes', EM, 'XL', 'No', '', '', 'Deepanshu', 'T2', '2', '2148', 'https://drive.google.com/b']),
    row(['11/20/2026 10:10:00', 'c@example.test', 'Cara Sen', 'IB26-003', 'IB A', ES, 'S', 'No', '', '', '', '', '', 'Tanvi', 'T3', '1', '1049', 'https://drive.google.com/c']),
    // started the form, never paid: no roll number
    row(['', '', 'Dev Nair', '', 'IB B', EM, 'L', '', '', '', '', '', '', '', '', '', '', '']),
  ])

  it('reads product, second item, name, section and who was paid', () => {
    const map = buildColumnMap(H)
    expect(map.slots).toHaveLength(3)
    expect(map.slots[0].colour).toEqual([5])
    expect(map.slots[1].colour).toEqual([8])
    expect(map.buyerName).toBe(2)
    expect(map.paidTo).toBe(13)
    expect(map.txn).toBe(14)
    expect(map.screenshot).toBe(17)
  })

  it('matches the three products and skips the abandoned row', () => {
    const p = parseFormCsv(csv, HOODIES)
    const ok = p.items.filter((i) => i.include)
    expect(ok.map((i) => [i.roll_no, i.product_id, i.size])).toEqual([
      ['IB26-001', 'h-emlyon', 'M'],
      ['IB26-002', 'h-zip', 'L'],
      ['IB26-002', 'h-emlyon', 'XL'],
      ['IB26-003', 'h-escp', 'S'],
    ])
    expect(p.items.find((i) => !i.roll_no)?.issues).toContain('missing_roll')
    expect(p.buyers.find((b) => b.roll_no === 'IB26-002')?.name).toBe('Ben Das')
    expect(p.responses.filter((r) => r.roll_no).map((r) => r.paid_to)).toEqual(['Deepanshu', 'Deepanshu', 'Tanvi'])
  })
})
