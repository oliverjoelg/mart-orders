import Papa from 'papaparse'
import type { Product } from '../types'
import { buildColumnMap, type ColumnMap } from './headers'
import {
  cleanText,
  detectDateOrder,
  matchProduct,
  normaliseBatch,
  normaliseEmail,
  normalisePrintName,
  normaliseRoll,
  normaliseSize,
  parseFormTimestamp,
} from './normalize'

export type IssueCode =
  | 'unknown_product' // colour answer matches no product: cannot import
  | 'missing_roll' // no roll number: cannot import
  | 'missing_size' // shirt without a size: cannot import
  | 'custom_size' // size outside the standard list: imported, check it
  | 'size_not_offered' // standard size this product does not offer (e.g. XXS Black)
  | 'duplicate' // same roll no. + same shirt in another response or already in the tool
  | 'already_imported' // this exact response slot is already in the tool

export const BLOCKING: IssueCode[] = ['unknown_product', 'missing_roll', 'missing_size']

export const ISSUE_LABEL: Record<IssueCode, string> = {
  unknown_product: 'Unknown colour',
  missing_roll: 'No roll number',
  missing_size: 'No size',
  custom_size: 'Custom size',
  size_not_offered: 'Size not offered',
  duplicate: 'Possible duplicate',
  already_imported: 'Already imported',
}

export interface ParsedItem {
  key: string // unique in this preview
  row: number // spreadsheet row number (header = 1)
  slot: number // 1..4
  roll_no: string
  buyer_name: string
  product_id: string | null
  colour_raw: string
  size: string
  print_name: string | null
  batch: string | null
  source_timestamp: string | null
  issues: IssueCode[]
  duplicateOf?: string // human description of what it duplicates
  include: boolean // default choice in the preview
}

export interface ParsedBuyer {
  roll_no: string
  name: string
  email: string | null
  phone: string | null
  batch: string | null
  course: string | null
  section: string | null
}

export interface ParsedResponse {
  row: number
  roll_no: string
  name: string
  declared_total: number | null
  shirts: number
  /** what the student typed as amount paid, digits only */
  amount_paid: number | null
  /** sum of product prices of the parsed shirts */
  expected_amount: number
  comment: string | null
}

export interface ExistingItem {
  roll_no: string
  product_id: string
  size: string
  print_name: string | null
  source_timestamp: string | null
  source_slot: number | null
}

export interface ImportPreview {
  headers: string[]
  columns: ColumnMap
  fatal: string[] // problems that stop the import (e.g. no roll number column)
  responses: ParsedResponse[]
  items: ParsedItem[]
  buyers: ParsedBuyer[]
  stats: {
    dataRows: number
    blankRows: number
    responses: number
    shirts: number
    declaredTotal: number
    countMismatches: number
    duplicates: number
    alreadyImported: number
    blocked: number
    toImport: number
  }
}

function cell(row: string[], i: number | undefined): string {
  return i === undefined ? '' : (row[i] ?? '')
}

function firstFilled(row: string[], cols: number[]): string {
  for (const c of cols) {
    const v = (row[c] ?? '').trim()
    if (v) return v
  }
  return ''
}

export function shirtKey(i: { roll_no: string; product_id: string | null; size: string; print_name: string | null }) {
  return [i.roll_no, i.product_id ?? '?', i.size.toUpperCase(), (i.print_name ?? '').toUpperCase()].join('|')
}

function slotKey(roll: string, ts: string | null, slot: number | null) {
  return `${roll}|${ts ? new Date(ts).getTime() : '?'}|${slot ?? '?'}`
}

export function parseFormCsv(csv: string, products: Product[], existing: ExistingItem[] = []): ImportPreview {
  const parsed = Papa.parse<string[]>(csv.replace(/^﻿/, ''), { skipEmptyLines: false })
  const rows = parsed.data
  const headers = (rows[0] ?? []).map((h) => String(h ?? ''))
  return parseFormRows(headers, rows.slice(1), products, existing)
}

export function parseFormRows(
  headers: string[],
  dataRows: string[][],
  products: Product[],
  existing: ExistingItem[] = [],
): ImportPreview {
  const columns = buildColumnMap(headers)
  const fatal: string[] = []
  if (columns.roll === undefined) fatal.push('No "Roll Number" column found.')
  if (columns.slots.length === 0) fatal.push('No T-shirt colour/size columns found.')

  const order = detectDateOrder(dataRows.map((r) => cell(r, columns.timestamp)))
  const responses: ParsedResponse[] = []
  const items: ParsedItem[] = []
  const buyers = new Map<string, ParsedBuyer>()
  let blankRows = 0
  let declaredTotal = 0
  let countMismatches = 0

  const existingShirts = new Map<string, ExistingItem>()
  const existingSlots = new Set<string>()
  for (const e of existing) {
    existingShirts.set(shirtKey(e), e)
    // only rows with a form timestamp can be recognised as the same response again
    if (e.source_timestamp) existingSlots.add(slotKey(e.roll_no, e.source_timestamp, e.source_slot))
  }
  const seenInFile = new Map<string, ParsedItem>()

  dataRows.forEach((row, idx) => {
    const rowNo = idx + 2
    if (row.every((v) => !String(v ?? '').trim())) {
      blankRows++
      return
    }
    const roll = normaliseRoll(cell(row, columns.roll))
    const name = cleanText(cell(row, columns.buyerName)) ?? ''
    const buyerBatch = normaliseBatch(cell(row, columns.batch))
    const ts = parseFormTimestamp(cell(row, columns.timestamp), order)
    // Google Sheets keeps rows that only have a few stray cells; treat rows with no
    // timestamp, roll number or shirt as blank.
    const slotValues = columns.slots.map((s) => ({
      colour: firstFilled(row, s.colour),
      size: firstFilled(row, s.size),
      print: firstFilled(row, s.print),
      batch: firstFilled(row, s.batch),
    }))
    const hasShirt = slotValues.some((s) => s.colour || s.size)
    if (!roll && !ts && !hasShirt) {
      blankRows++
      return
    }

    if (roll) {
      const prev = buyers.get(roll)
      // later responses update contact details
      buyers.set(roll, {
        roll_no: roll,
        name: name || prev?.name || '',
        email: normaliseEmail(cell(row, columns.email)) ?? prev?.email ?? null,
        phone: cleanText(cell(row, columns.phone)) ?? prev?.phone ?? null,
        batch: buyerBatch ?? prev?.batch ?? null,
        course: cleanText(cell(row, columns.course)) ?? prev?.course ?? null,
        section: cleanText(cell(row, columns.section)) ?? prev?.section ?? null,
      })
    }

    let shirts = 0
    let expected = 0
    slotValues.forEach((s, si) => {
      if (!s.colour && !s.size) return
      shirts++
      const slot = si + 1
      const product = matchProduct(s.colour, products)
      expected += product?.price_inr ?? 0
      const size = normaliseSize(s.size)
      const issues: IssueCode[] = []
      if (!roll) issues.push('missing_roll')
      if (!product) issues.push('unknown_product')
      if (!size) issues.push('missing_size')
      else if (size.custom) issues.push('custom_size')
      else if (product && product.sizes.length && !product.sizes.includes(size.size)) issues.push('size_not_offered')

      const item: ParsedItem = {
        key: `${rowNo}-${slot}`,
        row: rowNo,
        slot,
        roll_no: roll,
        buyer_name: name,
        product_id: product?.id ?? null,
        colour_raw: s.colour,
        size: size?.size ?? '',
        print_name: normalisePrintName(s.print),
        batch: normaliseBatch(s.batch) ?? buyerBatch,
        source_timestamp: ts,
        issues,
        include: true,
      }

      if (roll && ts && existingSlots.has(slotKey(roll, ts, slot))) {
        item.issues.push('already_imported')
        item.duplicateOf = 'This response is already in MART Orders'
      } else if (roll && product) {
        const k = shirtKey(item)
        const inDb = existingShirts.get(k)
        const inFile = seenInFile.get(k)
        if (inFile && inFile.row !== rowNo) {
          item.issues.push('duplicate')
          item.duplicateOf = `Same shirt as row ${inFile.row}`
        } else if (inDb) {
          item.issues.push('duplicate')
          item.duplicateOf = 'Same shirt already in MART Orders'
        }
        if (!inFile) seenInFile.set(k, item)
      }

      item.include = !item.issues.some(
        (c) => BLOCKING.includes(c) || c === 'duplicate' || c === 'already_imported',
      )
      items.push(item)
    })

    const totalRaw = cell(row, columns.total).trim()
    const declared = totalRaw && /^\d+$/.test(totalRaw) ? Number(totalRaw) : null
    if (declared !== null) {
      declaredTotal += declared
      if (declared !== shirts) countMismatches++
    }
    const amountDigits = cell(row, columns.amount).replace(/[^\d.]/g, '')
    responses.push({
      row: rowNo,
      roll_no: roll,
      name,
      declared_total: declared,
      shirts,
      amount_paid: amountDigits ? Math.round(Number(amountDigits)) : null,
      expected_amount: expected,
      comment: cleanText(cell(row, columns.comments)),
    })
  })

  const count = (c: IssueCode) => items.filter((i) => i.issues.includes(c)).length
  return {
    headers,
    columns,
    fatal,
    responses,
    items,
    buyers: [...buyers.values()],
    stats: {
      dataRows: dataRows.length,
      blankRows,
      responses: responses.length,
      shirts: items.length,
      declaredTotal,
      countMismatches,
      duplicates: count('duplicate'),
      alreadyImported: count('already_imported'),
      blocked: items.filter((i) => i.issues.some((c) => BLOCKING.includes(c))).length,
      toImport: items.filter((i) => i.include).length,
    },
  }
}

/** True if this item may be ticked in the preview (blocking issues can't be imported). */
export function canInclude(item: ParsedItem): boolean {
  return !item.issues.some((c) => BLOCKING.includes(c))
}
