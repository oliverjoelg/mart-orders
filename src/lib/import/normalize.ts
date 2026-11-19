import type { Product } from '../types'

export const STANDARD_SIZES = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'] as const

const SIZE_SYNONYMS: Record<string, string> = {
  SMALL: 'S',
  MEDIUM: 'M',
  LARGE: 'L',
  'EXTRA LARGE': 'XL',
  'EXTRA SMALL': 'XS',
  '2XL': 'XXL',
  '3XL': 'XXXL',
  '2XS': 'XXS',
  '3XS': 'XXXS',
  'X-LARGE': 'XL',
  'X-SMALL': 'XS',
}

export interface SizeResult {
  size: string
  custom: boolean
}

/** "XXS (Only for Navy Blue/ Baby Pink)" -> XXS; "m " -> M; anything else is kept as a custom size. */
export function normaliseSize(raw: string | null | undefined): SizeResult | null {
  const trimmed = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!trimmed) return null
  const upper = trimmed.toUpperCase()
  const head = upper.replace(/\s*\(.*\)\s*$/, '').trim()
  const candidate = SIZE_SYNONYMS[head] ?? head
  if ((STANDARD_SIZES as readonly string[]).includes(candidate)) return { size: candidate, custom: false }
  return { size: trimmed, custom: true }
}

export function sizeRank(size: string): number {
  const i = (STANDARD_SIZES as readonly string[]).indexOf(size)
  return i === -1 ? 100 : i
}

export function compareSizes(a: string, b: string): number {
  return sizeRank(a) - sizeRank(b) || a.localeCompare(b)
}

/**
 * Matches the form's colour answer ("Classic MDI Batch T-Shirt Blue (Rs 699/-)") to a product
 * using each product's form_keywords. Returns null when nothing or more than one product matches.
 */
export function matchProduct(raw: string | null | undefined, products: Product[]): Product | null {
  const text = (raw ?? '').toLowerCase()
  if (!text.trim()) return null
  let best: Product | null = null
  let bestScore = 0
  let tie = false
  for (const p of products) {
    const words = p.form_keywords.length ? p.form_keywords : [p.colour.toLowerCase()]
    const score = words.filter((w) => w && new RegExp(`\\b${escapeRegExp(w.toLowerCase())}\\b`).test(text)).length
    if (score > bestScore) {
      best = p
      bestScore = score
      tie = false
    } else if (score > 0 && score === bestScore) {
      tie = true
    }
  }
  return tie ? null : best
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const NO_NAME = /^(n\/?a|none|nil|null|no|no name|nothing|-+|\.)$/i

/** Back-print name; "NA" and friends mean no name. Whitespace collapsed, case kept as typed. */
export function normalisePrintName(raw: string | null | undefined): string | null {
  const s = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (!s || NO_NAME.test(s)) return null
  return s
}

export function normaliseRoll(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, '').toUpperCase()
}

/** PG’26 / pg'26 -> PG'26 */
export function normaliseBatch(raw: string | null | undefined): string | null {
  const s = (raw ?? '').replace(/[’‘`´]/g, "'").replace(/\s+/g, '').toUpperCase()
  return s || null
}

export function cleanText(raw: string | null | undefined): string | null {
  const s = (raw ?? '').replace(/\s+/g, ' ').trim()
  return s || null
}

export function normaliseEmail(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().toLowerCase()
  return s || null
}

export type DateOrder = 'dmy' | 'mdy'

/** Looks at all timestamps in a file to tell D/M/Y from M/D/Y (Sheets export follows the sheet's locale). */
export function detectDateOrder(values: string[]): DateOrder {
  let dmy = 0
  let mdy = 0
  for (const v of values) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(v.trim())
    if (!m) continue
    if (Number(m[1]) > 12) dmy++
    if (Number(m[2]) > 12) mdy++
  }
  return mdy > dmy ? 'mdy' : 'dmy'
}

/**
 * Form timestamps are India time. Accepts "2026-09-04 20:22:09(.559)", "04/09/2026 20:22:09"
 * and "9/4/2026 20:22:09". Returns an ISO string with +05:30, or null.
 */
export function parseFormTimestamp(raw: string | null | undefined, order: DateOrder): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  let y: number, mo: number, d: number
  let rest: string
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T]?(.*)$/.exec(s)
  if (m) {
    y = Number(m[1])
    mo = Number(m[2])
    d = Number(m[3])
    rest = m[4]
  } else {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\s*(.*)$/.exec(s)
    if (!m) return null
    const a = Number(m[1])
    const b = Number(m[2])
    y = Number(m[3])
    ;[d, mo] = order === 'dmy' ? [a, b] : [b, a]
    rest = m[4]
  }
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(am|pm)?/i.exec(rest.trim())
  let hh = 0
  let mm = 0
  let ss = 0
  if (t) {
    hh = Number(t[1])
    mm = Number(t[2])
    ss = Number(t[3] ?? 0)
    const ampm = t[5]?.toLowerCase()
    if (ampm === 'pm' && hh < 12) hh += 12
    if (ampm === 'am' && hh === 12) hh = 0
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:${pad(ss)}+05:30`
}
