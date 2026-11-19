import type { Product } from '../types'

/**
 * The sample order file people can download from Add orders. It uses the same layout as a
 * Google Form export (one row per student, up to 4 items side by side), with the current
 * sales round's real product names so it imports cleanly. Pure: the page turns it into .xlsx.
 */

const PRINT = "Name to be displayed on back (Put 'NA' if you don't want to display a name)"

export const SAMPLE_HEADERS = [
  'Timestamp',
  'Email Address',
  'Name (Fn Ln)',
  'Phone Number',
  'Roll Number',
  'Batch',
  'Course',
  'Applicable Section',
  'Item Details Color',
  'Size',
  PRINT,
  'Add another item',
  'Item Details Color 2',
  'Size 2',
  'Batch 2',
  `${PRINT} 2`,
  'Add another item 2',
  'Item Details Color 3',
  'Size 3',
  'Batch 3',
  `${PRINT} 3`,
  'Add another item 3',
  'Item Details Color 4',
  'Size 4',
  'Batch 4',
  `${PRINT} 4`,
  'Total No. of items ordered',
  'Amount paid',
]

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`
}

/** Header row + two example students (1 item and 2 items), using the round's products. */
export function buildSampleRows(products: Product[], now = new Date()): string[][] {
  const a = products[0]
  const b = products[1] ?? products[0]
  const size = (p: Product | undefined, i: number) => p?.sizes[Math.min(i, Math.max(p.sizes.length - 1, 0))] ?? 'M'
  const blank = () => SAMPLE_HEADERS.map(() => '')
  const row1 = blank()
  const row2 = blank()
  const set = (row: string[], header: string, value: string) => {
    row[SAMPLE_HEADERS.indexOf(header)] = value
  }

  set(row1, 'Timestamp', stamp(now))
  set(row1, 'Email Address', 'pgdm26example_a@mdi.ac.in')
  set(row1, 'Name (Fn Ln)', 'Example Student')
  set(row1, 'Phone Number', '9800000001')
  set(row1, 'Roll Number', 'PGP26-001')
  set(row1, 'Batch', "PG'26")
  set(row1, 'Course', 'PGDM')
  set(row1, 'Applicable Section', 'Section A')
  set(row1, 'Item Details Color', a?.name ?? 'Product name')
  set(row1, 'Size', size(a, 3))
  set(row1, PRINT, 'ASHA')
  set(row1, 'Add another item', 'No')
  set(row1, 'Total No. of items ordered', '1')
  set(row1, 'Amount paid', String(a?.price_inr ?? ''))

  set(row2, 'Timestamp', stamp(new Date(now.getTime() + 60_000)))
  set(row2, 'Email Address', 'pgdm26example_b@mdi.ac.in')
  set(row2, 'Name (Fn Ln)', 'Second Example')
  set(row2, 'Phone Number', '9800000002')
  set(row2, 'Roll Number', 'PGP26-002')
  set(row2, 'Batch', "PG'26")
  set(row2, 'Course', 'PGDM - HRM')
  set(row2, 'Applicable Section', 'Section B')
  set(row2, 'Item Details Color', a?.name ?? 'Product name')
  set(row2, 'Size', size(a, 4))
  set(row2, PRINT, 'NA')
  set(row2, 'Add another item', 'Yes')
  set(row2, 'Item Details Color 2', b?.name ?? 'Product name')
  set(row2, 'Size 2', size(b, 2))
  set(row2, 'Batch 2', "PG'26")
  set(row2, `${PRINT} 2`, 'MOM')
  set(row2, 'Add another item 2', 'No')
  set(row2, 'Total No. of items ordered', '2')
  set(row2, 'Amount paid', String((a?.price_inr ?? 0) + (b?.price_inr ?? 0)))

  return [SAMPLE_HEADERS, row1, row2]
}

/** Second sheet of the sample file: plain-English instructions. */
export function sampleInstructions(products: Product[]): string[][] {
  return [
    ['How to fill this file'],
    [''],
    ['One row per student. Up to 4 items per student, side by side (item 1, 2, 3, 4).'],
    ['Roll Number is required. Name, email and phone are used for the "come collect" lists.'],
    ['"Item Details Color" must contain the product name (or its colour word) exactly as on the Products page.'],
    ["Size: one of the product's sizes (e.g. S, M, L, XL). Anything else is kept as a custom size and flagged."],
    ['Name on back: leave empty or write NA for no name.'],
    ["Batch for items 2–4: leave empty to use the student's batch."],
    ['Timestamp: when they ordered (yyyy-mm-dd hh:mm). Can be left empty.'],
    ['Delete the two example rows before uploading.'],
    [''],
    ['Products in this sales round (copy the name into "Item Details Color"):'],
    ...products.map((p) => [`${p.name}  —  sizes: ${p.sizes.join(', ') || 'any'}  —  ₹${p.price_inr}`]),
  ]
}
