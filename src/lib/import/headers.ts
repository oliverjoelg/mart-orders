/**
 * Works out which CSV column holds what in a Google Form export.
 *
 * The 2026 form was edited while it was live, so the export has two layouts mixed:
 *  - a main block where each shirt's questions sit between "Add another T-shirt" columns, and
 *  - extra columns appended after "Total No. of t-shirt ordered" (Google appends new questions
 *    at the end): "Batch 5/6/7" and "T-shirt Details Color 2/3/4", which belong to shirts 2, 3, 4.
 * Header numbers are not reliable ("Color  2" is shirt 3), so slots are found by position.
 */

export type HeaderKind =
  | 'timestamp'
  | 'email'
  | 'buyerName'
  | 'phone'
  | 'roll'
  | 'batch'
  | 'course'
  | 'section'
  | 'colour'
  | 'size'
  | 'print'
  | 'addAnother'
  | 'total'
  | 'amount'
  | 'paidTo'
  | 'txn'
  | 'screenshot'
  | 'end'
  | 'comments'
  | 'other'

export interface SlotColumns {
  colour: number[]
  size: number[]
  print: number[]
  batch: number[]
}

export interface ColumnMap {
  timestamp?: number
  email?: number
  buyerName?: number
  phone?: number
  roll?: number
  batch?: number
  course?: number
  section?: number
  total?: number
  amount?: number
  /** whose QR code the student paid to */
  paidTo?: number
  txn?: number
  screenshot?: number
  comments?: number
  /** index 0 = shirt 1 */
  slots: SlotColumns[]
}

export function normaliseHeader(h: string): string {
  return h
    .replace(/_x000a_/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function classifyHeader(raw: string): HeaderKind {
  const h = normaliseHeader(raw)
  if (!h) return 'other'
  if (h.startsWith('timestamp')) return 'timestamp'
  // payment questions (checked first: they mention "transaction", "total amount", "qr")
  if (h.includes('screenshot')) return 'screenshot'
  if (/^(transaction|txn|utr|upi ref)/.test(h)) return 'txn'
  if (/^(payment|paid to|pay to)/.test(h) && /qr|scan|paid to|pay to/.test(h)) return 'paidTo'
  // other forms word these differently (e.g. the 2026 hoodie form: "Select QR Code",
  // "Select your winter merch", "Do you want to order another item?", "Your Name")
  if (/\bqr\b/.test(h)) return 'paidTo'
  if (h.includes('email')) return 'email'
  if (h.includes('name to be displayed') || h.includes('back')) return 'print'
  if (/^(your |full |student )?name\b/.test(h)) return 'buyerName'
  if (h.startsWith('add another') || /\b(order|add|buy) another\b/.test(h)) return 'addAnother'
  if (/^(select|choose|pick)\b.*\b(merch|item|product|hoodie|t-?shirt|design)/.test(h) || /^(merch|item|product)\b/.test(h)) return 'colour'
  if (h.includes('phone') || h.includes('mobile')) return 'phone'
  if (h.includes('roll')) return 'roll'
  if (h.startsWith('total')) return 'total'
  if (h.startsWith('amount')) return 'amount'
  if (/payment|transaction/.test(h)) return 'end'
  if (h.startsWith('add another')) return 'addAnother'
  if (/colou?r/.test(h)) return 'colour'
  if (h.startsWith('size')) return 'size'
  if (h.startsWith('batch')) return 'batch'
  if (h.startsWith('course')) return 'course'
  if (h.includes('section')) return 'section'
  if (h.startsWith('comment')) return 'comments'
  return 'other'
}

const BUYER_KINDS = ['timestamp', 'email', 'buyerName', 'phone', 'roll', 'course', 'section', 'comments'] as const
type BuyerKind = (typeof BUYER_KINDS)[number]

const emptySlot = (): SlotColumns => ({ colour: [], size: [], print: [], batch: [] })

export function buildColumnMap(headers: string[]): ColumnMap {
  const map: ColumnMap = { slots: [] }
  let slot = 0 // 0 = no shirt question seen yet; 1 = shirt 1 ...
  let inMainBlock = true
  const trailing: { colour: number[]; batch: number[]; size: number[]; print: number[] } = {
    colour: [],
    batch: [],
    size: [],
    print: [],
  }

  const slotCols = (n: number): SlotColumns => {
    while (map.slots.length < n) map.slots.push(emptySlot())
    return map.slots[n - 1]
  }

  headers.forEach((raw, i) => {
    const kind = classifyHeader(raw)

    if ((BUYER_KINDS as readonly string[]).includes(kind)) {
      const k = kind as BuyerKind
      if (map[k] === undefined) map[k] = i
      return
    }
    if (kind === 'total') {
      if (map.total === undefined) map.total = i
      inMainBlock = false
      return
    }
    if (kind === 'amount') {
      if (map.amount === undefined) map.amount = i
      inMainBlock = false
      return
    }
    if (kind === 'paidTo' || kind === 'txn' || kind === 'screenshot') {
      if (map[kind] === undefined) map[kind] = i
      inMainBlock = false
      return
    }
    if (kind === 'end') {
      inMainBlock = false
      return
    }
    if (kind === 'other') return

    if (!inMainBlock) {
      if (kind === 'colour' || kind === 'batch' || kind === 'size' || kind === 'print') {
        trailing[kind].push(i)
      }
      return
    }

    if (kind === 'addAnother') {
      slot = Math.max(slot, 1) + 1
      return
    }
    // A batch question before any shirt question is the buyer's batch (and shirt 1's).
    if (kind === 'batch' && slot === 0) {
      if (map.batch === undefined) map.batch = i
      return
    }
    if (kind === 'colour' || kind === 'size' || kind === 'print' || kind === 'batch') {
      if (slot === 0) slot = 1
      slotCols(slot)[kind].push(i)
    }
  })

  // Columns appended after the main block fill shirts 2, 3, 4 in order.
  for (const kind of ['colour', 'batch', 'size', 'print'] as const) {
    trailing[kind].forEach((col, j) => slotCols(j + 2)[kind].push(col))
  }
  // Drop slots that have neither a colour nor a size column (e.g. a stray "Add another").
  map.slots = map.slots.filter((s) => s.colour.length > 0 || s.size.length > 0)
  return map
}

export function describeColumnMap(headers: string[], map: ColumnMap): string[] {
  const name = (i: number | undefined) => (i === undefined ? '—' : `"${headers[i].trim()}"`)
  const lines = [
    `Roll number: ${name(map.roll)}`,
    `Name: ${name(map.buyerName)} · Email: ${name(map.email)} · Phone: ${name(map.phone)}`,
    `Batch: ${name(map.batch)} · Course: ${name(map.course)} · Section: ${name(map.section)}`,
    `Total shirts: ${name(map.total)}`,
    `Payment: paid to ${name(map.paidTo)} · amount ${name(map.amount)} · transaction ID ${name(map.txn)} · screenshot ${name(map.screenshot)}`,
  ]
  map.slots.forEach((s, i) => {
    const list = (cols: number[]) => (cols.length ? cols.map((c) => name(c)).join(' or ') : '—')
    lines.push(
      `Shirt ${i + 1}: colour ${list(s.colour)}, size ${list(s.size)}, back name ${list(s.print)}, batch ${list(s.batch)}`,
    )
  })
  return lines
}
