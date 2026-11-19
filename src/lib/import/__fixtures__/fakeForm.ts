/**
 * Made-up Google Form exports for tests. No real student data.
 * FAKE_BATCH_FORM copies the column layout of the 2026 "Batch Tshirts form (Responses)" sheet,
 * including the columns Google appended at the end after the form was edited.
 */
import Papa from 'papaparse'
import type { Product } from '../../types'

const PRINT = "Name to be displayed on back (Put 'NA' if you don't want to display a name)"

export const BATCH_FORM_HEADERS = [
  'Timestamp', // 0
  'Email Address', // 1
  'Name (Fn Ln)', // 2
  'Phone Number ', // 3
  'Roll Number ', // 4
  'Batch', // 5
  'Course ', // 6
  'Applicable Section', // 7
  'T-shirt Details Color ', // 8  shirt 1
  'Size ', // 9
  PRINT, // 10
  'Add another T-shirt', // 11
  'Color ', // 12 shirt 2 (old)
  'Batch 2', // 13
  'Size  2', // 14
  `${PRINT} 2`, // 15
  'Add another T-shirt 2', // 16
  'Color  2', // 17 shirt 3 (old)
  'Size  3', // 18
  'Batch 3', // 19
  `${PRINT} 3`, // 20
  'Add Another T-Shirt2', // 21
  'Color', // 22 shirt 4 (old)
  'Size', // 23
  'Batch 4', // 24
  `${PRINT} 4`, // 25
  'Total No. of t-shirt ordered', // 26
  'Transaction ID ', // 27
  'Amount paid ', // 28
  'Payment Screenshot with visible transaction ID\n(Please pay the total amount on the above QR Code and attach the screenshot here )', // 29
  'Batch 5', // 30 shirt 2 batch (new)
  'Batch 6', // 31 shirt 3 batch (new)
  'Batch 7', // 32 shirt 4 batch (new)
  'T-shirt Details Color  2', // 33 shirt 2 colour (new)
  'T-shirt Details Color  3', // 34 shirt 3 colour (new)
  'T-shirt Details Color  4', // 35 shirt 4 colour (new)
  'Payment (Scan any one of the QR codes below to pay)', // 36
  'COMMENTS', // 37
]

const NAVY = 'Classic MDI Batch T-Shirt Navy Blue (Rs 699/-)'
const PINK = 'Classic MDI Batch T-Shirt Baby Pink (Rs 699/-)'
const BLUE_OLD = 'Classic MDI Batch T-Shirt Blue (Rs 699/-)'
const PINK_OLD = 'Classic MDI Batch T-Shirt Pink (Rs 699/-)'
const BLACK = 'Premium UCB Batch T-Shirt Black (Rs 1049/-)'
const WHITE = 'Premium UCB Batch T-Shirt White (Rs 1049/-)'

function row(cells: Record<number, string>): string[] {
  return BATCH_FORM_HEADERS.map((_, i) => cells[i] ?? '')
}

function buyer(ts: string, n: number, extra: Record<number, string>): string[] {
  return row({
    0: ts,
    1: `student${n}@example.test`,
    2: `Test Student ${n}`,
    3: `90000000${String(n).padStart(2, '0')}`,
    4: n === 3 ? ` pgp26-00${n} ` : `PGP26-00${n}`, // messy roll no. is normalised
    5: "PG'26",
    6: 'PGDM',
    7: 'Section A',
    ...extra,
  })
}

export const FAKE_BATCH_FORM_ROWS: string[][] = [
  // 1 shirt
  buyer('2026-09-04 20:22:09.559', 1, { 8: NAVY, 9: 'M', 10: 'ARJUN', 11: 'No', 26: '1', 36: 'QR 1' }),
  // 2 shirts, shirt 2 in the old "Color " column
  buyer('2026-09-04 20:25:00', 2, {
    8: BLACK, 9: 'L', 10: 'NA', 11: 'Yes',
    12: PINK_OLD, 13: "PG'25", 14: 'S', 15: 'MOM', 16: 'No',
    26: '2',
  }),
  // 3 shirts, shirts 2 and 3 in the new appended columns; XXS label is normalised
  buyer('2026-09-05 09:10:00', 3, {
    8: PINK, 9: 'XXS (Only for Navy Blue/ Baby Pink)', 10: 'Riya', 11: 'Yes',
    14: 'XL', 15: 'na', 16: 'Yes',
    18: 'M', 20: 'Dad', 21: 'No',
    26: '3', 30: "PG'26", 31: "PG'26", 33: WHITE, 34: BLUE_OLD,
  }),
  // 4 shirts, all old columns
  buyer('2026-09-05 10:00:00', 4, {
    8: NAVY, 9: 'S', 10: 'K', 11: 'Yes',
    12: BLUE_OLD, 13: "PG'26", 14: 'M', 15: 'K2', 16: 'Yes',
    17: PINK_OLD, 18: 'L', 19: "PG'26", 20: '', 21: 'Yes',
    22: BLACK, 23: 'XL', 24: "PG'26", 25: 'K4',
    26: '4',
  }),
  // a blank row, as Google Sheets exports them
  row({}),
  // student 1 again with the same shirt: a duplicate to review
  buyer('2026-09-06 11:00:00', 1, { 8: NAVY, 9: 'M', 10: 'ARJUN', 11: 'No', 26: '1' }),
  // custom size
  buyer('2026-09-06 12:00:00', 5, {
    8: WHITE, 9: 'Chest - 38 and Length - 27.5 / 28', 10: 'NA', 11: 'No', 26: '1', 37: 'NEED TO COLLECT CASH',
  }),
  // total typed as "02"
  buyer('2026-09-07 08:00:00', 6, {
    8: BLACK, 9: 'M', 10: 'ZED', 11: 'Yes', 14: 'M', 15: 'ZED', 33: BLACK, 30: "PG'26",
    26: '02',
  }),
  row({}),
]

export const FAKE_BATCH_FORM_CSV = Papa.unparse([BATCH_FORM_HEADERS, ...FAKE_BATCH_FORM_ROWS])

/** shirts per non-blank response above: 1 + 2 + 3 + 4 + 1 + 1 + 2 */
export const FAKE_BATCH_FORM_SHIRTS = 14

/** The later "Reopening" form uses one numbered column set per shirt. */
export const FAKE_REOPENING_CSV = Papa.unparse([
  [
    'Timestamp', 'Name (Fn Ln)', 'Phone Number', 'Roll Number', 'Batch', 'Course', 'Applicable Section',
    'T-shirt Details\n\nColor', 'Size', PRINT, 'Add another T-shirt',
    'T-shirt Details\n\nColor 2', 'Size 2', 'Batch 2', `${PRINT} 2`, 'Add another T-shirt 2',
    'T-shirt Details\n\nColor 3', 'Size 3', 'Batch 3', `${PRINT} 3`, 'Add another T-shirt 3',
    'T-shirt Details\n\nColor 4', 'Size 4', 'Batch 4', `${PRINT} 4`,
    'Payment (Scan any one of the QR codes below to pay)', 'Total No. of t-shirt ordered', 'Transaction ID',
    'Amount paid ', 'Email Address',
  ],
  ['10/11/2026 14:05:00', 'Late Buyer', '9111111111', 'PGP26-101', "PG'26", 'PGDM', 'Section B',
    NAVY, 'L', 'NA', 'Yes', BLACK, 'XXL', "PG'26", 'LB', 'No', '', '', '', '', '', '', '', '', '',
    'QR', '2', 'T1', '1748', 'late@example.test'],
  ['13/11/2026 09:00:00', 'Second Late', '9222222222', 'PGP26-102', "PG'25", 'PGDM - IB', 'NA',
    WHITE, 'S', 'S2', 'No', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
    'QR', '1', 'T2', '1049', 'second@example.test'],
])

export const TEST_PRODUCTS: Product[] = [
  { id: 'p-navy', campaign_id: 'c1', name: 'Classic MDI Navy Blue', colour: 'Navy Blue', price_inr: 699,
    sizes: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'], form_keywords: ['navy', 'blue'], sort_order: 1 },
  { id: 'p-pink', campaign_id: 'c1', name: 'Classic MDI Baby Pink', colour: 'Baby Pink', price_inr: 699,
    sizes: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'], form_keywords: ['pink'], sort_order: 2 },
  { id: 'p-black', campaign_id: 'c1', name: 'Premium UCB Black', colour: 'Black', price_inr: 1049,
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'], form_keywords: ['black'], sort_order: 3 },
  { id: 'p-white', campaign_id: 'c1', name: 'Premium UCB White', colour: 'White', price_inr: 1049,
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'], form_keywords: ['white'], sort_order: 4 },
]
