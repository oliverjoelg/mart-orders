import { STATUS_LABEL, type AuditEntry, type Buyer, type ItemStatus, type Product, type Role } from './types'
import { ROLE_LABEL } from './types'

export interface DescribeCtx {
  productsById: Map<string, Product>
  buyersById: Map<string, Buyer>
  /** item id -> { product_id, size, buyer_id } for items whose own row isn't in the entry */
  itemLookup(itemId: string): { product_id: string; size: string; buyer_id: string } | undefined
}

export type Tone = 'green' | 'blue' | 'amber' | 'red' | ''

type Row = Record<string, unknown>

const str = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v))

function shirt(ctx: DescribeCtx, row: Row | null, itemId: string | null): string {
  const src = (row && row.product_id ? row : itemId ? ctx.itemLookup(itemId) : undefined) as Row | undefined
  if (!src) return 'a shirt'
  const p = ctx.productsById.get(String(src.product_id))
  const b = ctx.buyersById.get(String(src.buyer_id))
  return `${p?.colour ?? 'Shirt'} ${str(src.size)}${b ? ` (${b.roll_no})` : ''}`
}

export function describeEntry(e: AuditEntry, ctx: DescribeCtx): { text: string; tone: Tone } {
  const o = e.old_data ?? {}
  const n = e.new_data ?? {}
  const changed = e.changed ?? []

  switch (e.table_name) {
    case 'order_items': {
      const s = shirt(ctx, e.action === 'DELETE' ? o : n, e.item_id)
      if (e.action === 'INSERT') return { text: `added ${s}${n.import_id ? ' (import)' : ''}`, tone: '' }
      if (e.action === 'DELETE') return { text: `deleted ${s}`, tone: 'red' }
      if (changed.includes('status')) {
        const to = n.status as ItemStatus
        const tone: Tone = to === 'received' ? 'green' : to === 'handed_over' ? 'blue' : to === 'sent_to_vendor' ? 'amber' : ''
        return { text: `marked ${s} ${STATUS_LABEL[to]} (was ${STATUS_LABEL[o.status as ItemStatus]})`, tone }
      }
      const parts = changed.map((k) => `${k.replace(/_/g, ' ')} ${str(o[k])} → ${str(n[k])}`)
      return { text: `edited ${s}: ${parts.join(', ')}`, tone: 'amber' }
    }
    case 'handovers': {
      const s = shirt(ctx, null, e.item_id)
      if (e.action === 'INSERT') {
        const who = n.type === 'collected_by_other' ? `collected by ${str(n.collector_name)} (${str(n.collector_roll)})` : 'to the student'
        return { text: `handed over ${s} ${who}`, tone: 'blue' }
      }
      if (e.action === 'UPDATE' && n.undone_at) return { text: `undid the handover of ${s}: “${str(n.undo_reason)}”`, tone: 'red' }
      return { text: `changed a handover of ${s}`, tone: '' }
    }
    case 'notes': {
      const target = e.item_id ? shirt(ctx, null, e.item_id) : ctx.buyersById.get(String(n.buyer_id ?? o.buyer_id))?.roll_no ?? 'a student'
      if (e.action === 'INSERT') return { text: `added a ${n.is_flag ? 'flag' : 'note'} on ${target}: “${str(n.body)}”`, tone: n.is_flag ? 'amber' : '' }
      if (e.action === 'DELETE') return { text: `deleted a note on ${target}`, tone: 'red' }
      if (changed.includes('resolved')) return { text: `${n.resolved ? 'resolved' : 'reopened'} a flag on ${target}: “${str(n.body)}”`, tone: n.resolved ? 'green' : 'amber' }
      return { text: `edited a note on ${target}`, tone: '' }
    }
    case 'buyers': {
      const roll = str(n.roll_no ?? o.roll_no)
      if (e.action === 'INSERT') return { text: `added student ${roll}`, tone: '' }
      if (e.action === 'DELETE') return { text: `deleted student ${roll}`, tone: 'red' }
      return { text: `updated student ${roll} (${changed.join(', ')})`, tone: '' }
    }
    case 'members': {
      const name = str(n.display_name ?? o.display_name)
      if (e.action === 'INSERT') return { text: `added ${name} to the team as ${ROLE_LABEL[n.role as Role]}`, tone: 'green' }
      if (e.action === 'DELETE') return { text: `removed ${name} from the team`, tone: 'red' }
      if (changed.includes('role')) return { text: `changed ${name}'s role: ${ROLE_LABEL[o.role as Role]} → ${ROLE_LABEL[n.role as Role]}`, tone: 'amber' }
      if (changed.includes('active')) return { text: `${n.active ? 're-activated' : 'deactivated'} ${name}`, tone: n.active ? 'green' : 'red' }
      if (changed.length === 1 && changed[0] === 'user_id') return { text: `${name} signed in for the first time`, tone: '' }
      return { text: `updated team member ${name}`, tone: '' }
    }
    case 'products':
      return { text: `${e.action === 'INSERT' ? 'added' : e.action === 'DELETE' ? 'deleted' : 'edited'} product ${str(n.name ?? o.name)}`, tone: '' }
    case 'campaigns':
      return { text: `${e.action === 'INSERT' ? 'created' : e.action === 'DELETE' ? 'deleted' : 'edited'} sales round ${str(n.name ?? o.name)}`, tone: '' }
    case 'imports':
      return { text: `imported ${str(n.file_name)} (${str(n.responses)} responses)`, tone: 'green' }
    case 'spare_stock': {
      const p = ctx.productsById.get(String(n.product_id ?? o.product_id))
      return { text: `set spare ${p?.colour ?? ''} ${str(n.size ?? o.size)} to ${str(n.quantity)}`, tone: '' }
    }
    default:
      return { text: `${e.action.toLowerCase()} on ${e.table_name}`, tone: '' }
  }
}
