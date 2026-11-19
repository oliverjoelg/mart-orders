import { compareSizes } from './import/normalize'
import type { ItemView } from './types'

export type ExportKind = 'call_list' | 'not_arrived' | 'collected'

export const EXPORT_LABEL: Record<ExportKind, string> = {
  call_list: 'Arrived, not collected',
  not_arrived: 'Not yet arrived',
  collected: 'Collected',
}

export interface ExportFilters {
  campaignId?: string
  productId?: string
  size?: string
  batch?: string
  section?: string
  /** call list only: also include students for whom only some shirts have arrived */
  includePartly?: boolean
}

export interface ExportLine {
  roll_no: string
  name: string
  email: string | null
  phone: string | null
  batch: string | null
  section: string | null
  /** e.g. "Navy Blue M ×2, Black L" — the shirts this line is about */
  shirts: string
  count: number
  /** shirts of this student still with the vendor (call list) */
  pending: number
  /** collected: who handed it over and who collected */
  handedBy?: string
  collectedBy?: string
}

export function matchesFilters(i: ItemView, f: ExportFilters): boolean {
  if (f.campaignId && i.campaign_id !== f.campaignId) return false
  if (f.productId && i.product_id !== f.productId) return false
  if (f.size && i.size !== f.size) return false
  if (f.batch && (i.batch ?? i.buyer.batch) !== f.batch) return false
  if (f.section && i.buyer.section !== f.section) return false
  return true
}

export function summariseShirts(items: ItemView[]): string {
  const counts = new Map<string, { label: string; n: number; sort: string }>()
  for (const i of [...items].sort(
    (a, b) => a.product.sort_order - b.product.sort_order || compareSizes(a.size, b.size),
  )) {
    const label = `${i.product.colour} ${i.size}`
    const c = counts.get(label) ?? { label, n: 0, sort: label }
    c.n++
    counts.set(label, c)
  }
  return [...counts.values()].map((c) => (c.n > 1 ? `${c.label} ×${c.n}` : c.label)).join(', ')
}

/**
 * One line per student.
 *  call_list   — has shirts in MART (received) not yet collected. Unless includePartly is on,
 *                students who still have shirts with the vendor are left out (call them once).
 *  not_arrived — has shirts still ordered / with the vendor.
 *  collected   — has collected shirts, with who handed over and who collected.
 */
export function buildExport(
  items: ItemView[],
  kind: ExportKind,
  filters: ExportFilters,
  memberName: (userId: string) => string = (id) => id,
): ExportLine[] {
  const scoped = items.filter((i) => !filters.campaignId || i.campaign_id === filters.campaignId)
  const byBuyer = new Map<string, ItemView[]>()
  for (const i of scoped) {
    const list = byBuyer.get(i.buyer_id) ?? []
    list.push(i)
    byBuyer.set(i.buyer_id, list)
  }

  const lines: ExportLine[] = []
  for (const all of byBuyer.values()) {
    const matching = all.filter((i) => matchesFilters(i, filters))
    if (matching.length === 0) continue
    const b = all[0].buyer
    const base = {
      roll_no: b.roll_no,
      name: b.name,
      email: b.email,
      phone: b.phone,
      batch: matching[0].batch ?? b.batch,
      section: b.section,
    }
    const pendingAll = all.filter((i) => i.status === 'ordered' || i.status === 'sent_to_vendor')

    if (kind === 'call_list') {
      const ready = matching.filter((i) => i.status === 'received')
      if (ready.length === 0) continue
      if (!filters.includePartly && pendingAll.length > 0) continue
      lines.push({ ...base, shirts: summariseShirts(ready), count: ready.length, pending: pendingAll.length })
    } else if (kind === 'not_arrived') {
      const pending = matching.filter((i) => i.status === 'ordered' || i.status === 'sent_to_vendor')
      if (pending.length === 0) continue
      lines.push({ ...base, shirts: summariseShirts(pending), count: pending.length, pending: pending.length })
    } else {
      const done = matching.filter((i) => i.status === 'handed_over')
      if (done.length === 0) continue
      const handedBy = [...new Set(done.map((i) => (i.handover ? memberName(i.handover.handed_by) : '—')))]
      const collectors = [
        ...new Set(
          done.map((i) =>
            i.handover?.type === 'collected_by_other'
              ? `${i.handover.collector_name} (${i.handover.collector_roll})`
              : 'Self',
          ),
        ),
      ]
      lines.push({
        ...base,
        shirts: summariseShirts(done),
        count: done.length,
        pending: pendingAll.length,
        handedBy: handedBy.join(', '),
        collectedBy: collectors.join(', '),
      })
    }
  }
  return lines.sort((a, b) => a.roll_no.localeCompare(b.roll_no))
}

export function rollList(lines: ExportLine[]): string {
  return lines.map((l) => l.roll_no).join('\n')
}

/** Comma-separated, ready to paste into Gmail's Bcc field. Students without an email are skipped. */
export function emailList(lines: ExportLine[]): string {
  return [...new Set(lines.map((l) => l.email).filter((e): e is string => !!e))].join(', ')
}

export function exportRows(lines: ExportLine[], kind: ExportKind): (string | number)[][] {
  const head = ['Roll number', 'Name', 'Email', 'Phone', 'Batch', 'Section', 'Shirts', 'Count']
  if (kind === 'call_list') head.push('Still with vendor')
  if (kind === 'collected') head.push('Handed over by', 'Collected by')
  return [
    head,
    ...lines.map((l) => {
      const r: (string | number)[] = [
        l.roll_no,
        l.name,
        l.email ?? '',
        l.phone ?? '',
        l.batch ?? '',
        l.section ?? '',
        l.shirts,
        l.count,
      ]
      if (kind === 'call_list') r.push(l.pending)
      if (kind === 'collected') r.push(l.handedBy ?? '', l.collectedBy ?? '')
      return r
    }),
  ]
}
