/**
 * In-memory backend with made-up data, for `npm run dev:demo`. Lets anyone click through the
 * whole app (and switch roles) without a Supabase project or Google sign-in. Nothing is saved.
 * It mimics the database rules loosely; the real enforcement is in the SQL migrations.
 */
import type { Api, ImportArgs, Snapshot } from './api'
import { can } from './permissions'
import type {
  AuditEntry,
  Buyer,
  Campaign,
  Handover,
  ItemStatus,
  Member,
  Note,
  OrderItem,
  Product,
  Role,
  SpareStock,
} from './types'

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

let idSeq = 0
const uid = (p: string) => `${p}-${(++idSeq).toString(36).padStart(5, '0')}`

const FIRST = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Ananya', 'Vihaan', 'Isha', 'Arjun', 'Sara', 'Dev', 'Tara',
  'Neel', 'Zoya', 'Karan', 'Riya', 'Yash', 'Nisha', 'Aditya', 'Pooja', 'Ira', 'Varun', 'Aisha', 'Kunal']
const LAST = ['Sharma', 'Verma', 'Iyer', 'Nair', 'Gupta', 'Mehta', 'Rao', 'Das', 'Kapoor', 'Singh', 'Bose', 'Jain',
  'Malhotra', 'Reddy', 'Kulkarni', 'Chopra']
const SECTIONS = ['Section A', 'Section B', 'Section C', 'Section D', 'Section E', 'Section F']
const COURSES = ['PGDM', 'PGDM - HRM', 'PGDM - IB', 'PGDM - BFS']

const DEMO_MEMBERS: Member[] = [
  { id: 'm1', user_id: 'u1', email: 'super.admin@mdi.ac.in', display_name: 'Demo Super Admin', role: 'main_admin', active: true },
  { id: 'm2', user_id: 'u2', email: 'admin@mdi.ac.in', display_name: 'Priya Admin', role: 'admin', active: true },
  { id: 'm3', user_id: 'u3', email: 'ops.one@mdi.ac.in', display_name: 'Rahul Ops', role: 'ops', active: true },
  { id: 'm4', user_id: 'u4', email: 'ops.two@mdi.ac.in', display_name: 'Sneha Ops', role: 'ops', active: true },
  { id: 'm5', user_id: 'u5', email: 'admin.two@mdi.ac.in', display_name: 'Aman Admin', role: 'admin', active: true },
]
const USER_ID: Record<string, string> = { m1: 'u1', m2: 'u2', m3: 'u3', m4: 'u4', m5: 'u5' }

function build(): { db: Snapshot; log: AuditEntry[] } {
  const r = rng(26)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const campaign: Campaign = { id: 'c-2026', name: 'Batch Tees 2026', is_active: true }
  const products: Product[] = [
    { id: 'p-navy', campaign_id: campaign.id, name: 'Classic MDI Navy Blue', colour: 'Navy Blue', price_inr: 699,
      sizes: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'], form_keywords: ['navy', 'blue'], sort_order: 1 },
    { id: 'p-pink', campaign_id: campaign.id, name: 'Classic MDI Baby Pink', colour: 'Baby Pink', price_inr: 699,
      sizes: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'], form_keywords: ['pink'], sort_order: 2 },
    { id: 'p-black', campaign_id: campaign.id, name: 'Premium UCB Black', colour: 'Black', price_inr: 1049,
      sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'], form_keywords: ['black'], sort_order: 3 },
    { id: 'p-white', campaign_id: campaign.id, name: 'Premium UCB White', colour: 'White', price_inr: 1049,
      sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'], form_keywords: ['white'], sort_order: 4 },
  ]
  const sizeWeights = ['XS', 'S', 'S', 'M', 'M', 'M', 'L', 'L', 'L', 'XL', 'XL', 'XXL']
  const buyers: Buyer[] = []
  const items: OrderItem[] = []
  const handovers: Handover[] = []
  const log: AuditEntry[] = []
  const t0 = Date.parse('2026-09-04T14:00:00Z')

  for (let n = 1; n <= 160; n++) {
    const first = pick(FIRST)
    const last = pick(LAST)
    const batch = r() < 0.85 ? "PG'26" : "PG'25"
    const b: Buyer = {
      id: uid('b'),
      roll_no: `${batch === "PG'26" ? 'PGP26' : 'PGP25'}-${String(n).padStart(3, '0')}`,
      name: `${first} ${last}`,
      email: `${first}.${last}.${n}@example.test`.toLowerCase(),
      phone: `98${Math.floor(10000000 + r() * 89999999)}`,
      batch,
      course: pick(COURSES),
      section: batch === "PG'26" ? pick(SECTIONS) : 'NA',
    }
    buyers.push(b)
    const shirts = r() < 0.55 ? 1 : r() < 0.8 ? 2 : r() < 0.93 ? 3 : 4
    const ts = new Date(t0 + n * 37 * 60_000).toISOString()
    for (let s = 1; s <= shirts; s++) {
      const product = r() < 0.38 ? products[0] : r() < 0.55 ? products[2] : r() < 0.7 ? products[1] : products[3]
      const roll = r()
      // Navy and Black boxes have arrived; Pink is with the vendor; White partly.
      const status: ItemStatus =
        product.id === 'p-pink' ? (roll < 0.7 ? 'sent_to_vendor' : 'ordered')
        : product.id === 'p-white' ? (roll < 0.5 ? 'received' : 'sent_to_vendor')
        : roll < 0.45 ? 'handed_over' : 'received'
      const item: OrderItem = {
        id: uid('i'),
        campaign_id: campaign.id,
        buyer_id: b.id,
        product_id: product.id,
        size: product.id === 'p-pink' && r() < 0.1 ? 'XXS' : pick(sizeWeights),
        print_name: r() < 0.3 ? null : r() < 0.5 ? first.toUpperCase() : first,
        batch,
        status,
        status_changed_at: new Date(t0 + 40 * 86400_000 + n * 3_600_000).toISOString(),
        source_timestamp: ts,
        source_slot: s,
        created_at: ts,
      }
      items.push(item)
      if (status === 'handed_over') {
        const other = r() < 0.2
        const by = pick(DEMO_MEMBERS.slice(1, 4))
        handovers.push({
          id: uid('h'),
          item_id: item.id,
          type: other ? 'collected_by_other' : 'self',
          collector_name: other ? `${pick(FIRST)} ${pick(LAST)}` : null,
          collector_roll: other ? `PGP26-${String(Math.floor(r() * 400)).padStart(3, '0')}` : null,
          handed_by: USER_ID[by.id],
          handed_at: new Date(Date.now() - Math.floor(r() * 5 * 86400_000)).toISOString(),
          undone_at: null,
          undo_reason: null,
        })
      }
    }
  }

  const notes: Note[] = [
    { id: uid('n'), buyer_id: buyers[4].id, item_id: null, body: 'NEED TO COLLECT CASH', is_flag: true, resolved: false,
      created_by: 'u2', created_at: new Date(t0).toISOString() },
    { id: uid('n'), buyer_id: buyers[11].id, item_id: null, body: 'Wants to exchange M for L if stock allows', is_flag: true,
      resolved: false, created_by: 'u3', created_at: new Date(t0 + 86400_000).toISOString() },
  ]
  const spare: SpareStock[] = [
    { id: uid('s'), product_id: 'p-navy', size: 'M', quantity: 4, note: null },
    { id: uid('s'), product_id: 'p-navy', size: 'L', quantity: 2, note: null },
    { id: uid('s'), product_id: 'p-black', size: 'XL', quantity: 3, note: null },
  ]

  // a little recent history so the activity feed isn't empty
  let logId = 0
  const recent = [...handovers].sort((a, b) => a.handed_at.localeCompare(b.handed_at)).slice(-40)
  for (const h of recent) {
    const m = DEMO_MEMBERS.find((x) => USER_ID[x.id] === h.handed_by)!
    const it = items.find((i) => i.id === h.item_id)!
    log.push(entry(++logId, h.handed_at, m, 'INSERT', 'handovers', h.id, it.id, null, { ...h }))
    log.push(entry(++logId, h.handed_at, m, 'UPDATE', 'order_items', it.id, it.id, { ...it, status: 'received' },
      { ...it }, ['status']))
  }
  return { db: { campaigns: [campaign], products, buyers, items, handovers, notes, spare, members: DEMO_MEMBERS }, log }
}

function entry(
  id: number,
  at: string,
  m: Member,
  action: AuditEntry['action'],
  table: string,
  rowId: string,
  itemId: string | null,
  oldData: object | null,
  newData: object | null,
  changed: string[] | null = null,
): AuditEntry {
  return {
    id, at, actor_id: USER_ID[m.id] ?? null, actor_email: m.email, actor_name: m.display_name, actor_role: m.role,
    action, table_name: table, row_id: rowId, item_id: itemId,
    old_data: oldData as Record<string, unknown> | null, new_data: newData as Record<string, unknown> | null, changed,
  }
}

const delay = (ms = 120) => new Promise((res) => setTimeout(res, ms))

export function createDemoApi(): Api {
  const { db, log } = build()
  let logId = log.length
  let role: Role = (localStorage.getItem('mart-demo-role') as Role | null) ?? 'main_admin'
  let signedIn = localStorage.getItem('mart-demo-signed-in') !== 'no'
  const listeners = new Set<() => void>()

  const me = () => DEMO_MEMBERS.find((m) => m.role === role)!
  const meId = () => USER_ID[me().id]
  const deny = () => {
    throw new Error("Your role isn't allowed to do that.")
  }
  const record = (
    action: AuditEntry['action'], table: string, rowId: string, itemId: string | null,
    oldData: object | null, newData: object | null,
  ) => {
    const changed =
      action === 'UPDATE' && oldData && newData
        ? Object.keys(newData).filter(
            (k) => JSON.stringify((newData as never)[k]) !== JSON.stringify((oldData as never)[k]) && k !== 'status_changed_at',
          )
        : null
    log.push(entry(++logId, new Date().toISOString(), me(), action, table, rowId, itemId, oldData, newData, changed))
  }
  const setStatus = (it: OrderItem, status: ItemStatus) => {
    const old = { ...it }
    it.status = status
    it.status_changed_at = new Date().toISOString()
    record('UPDATE', 'order_items', it.id, it.id, old, { ...it })
  }
  const clone = <T,>(x: T): T => structuredClone(x)

  return {
    mode: 'demo',
    async getUser() {
      return signedIn ? { id: meId(), email: me().email } : null
    },
    onAuthChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    async signIn() {
      signedIn = true
      localStorage.setItem('mart-demo-signed-in', 'yes')
      listeners.forEach((l) => l())
    },
    async signOut() {
      signedIn = false
      localStorage.setItem('mart-demo-signed-in', 'no')
      listeners.forEach((l) => l())
    },
    async getMyMember() {
      return me()
    },
    setDemoRole(r) {
      role = r
      localStorage.setItem('mart-demo-role', r)
      listeners.forEach((l) => l())
    },

    async loadSnapshot() {
      await delay(200)
      return clone({ ...db, handovers: db.handovers.filter((h) => !h.undone_at) })
    },

    async setItemsStatus(ids, status) {
      await delay()
      if (!can(role, 'setStatus')) deny()
      let n = 0
      for (const it of db.items) {
        if (!ids.includes(it.id) || it.status === status) continue
        if (it.status === 'handed_over') throw new Error("Undo the handover (with a reason) before changing this item's status")
        setStatus(it, status)
        n++
      }
      return n
    },

    async recordHandover(ids, type, collectorName, collectorRoll) {
      await delay()
      if (!can(role, 'handover')) deny()
      if (type === 'collected_by_other' && (!collectorName?.trim() || !collectorRoll?.trim())) {
        throw new Error('Enter the name and roll number of the person collecting')
      }
      const list = db.items.filter((i) => ids.includes(i.id))
      if (list.some((i) => i.status !== 'received')) throw new Error('Only items that are in MART (received) can be handed over')
      for (const it of list) {
        const h: Handover = {
          id: uid('h'), item_id: it.id, type,
          collector_name: type === 'collected_by_other' ? collectorName!.trim() : null,
          collector_roll: type === 'collected_by_other' ? collectorRoll!.trim().toUpperCase() : null,
          handed_by: meId(), handed_at: new Date().toISOString(), undone_at: null, undo_reason: null,
        }
        db.handovers.push(h)
        record('INSERT', 'handovers', h.id, it.id, null, { ...h })
        setStatus(it, 'handed_over')
      }
      return list.length
    },

    async undoHandover(itemId, reason) {
      await delay()
      if (!can(role, 'undoHandover')) throw new Error('Only admins can undo a handover')
      if (!reason.trim()) throw new Error('Give a reason for the undo')
      const h = db.handovers.find((x) => x.item_id === itemId && !x.undone_at)
      if (!h) throw new Error('This item has no handover to undo')
      const old = { ...h }
      h.undone_at = new Date().toISOString()
      h.undo_reason = reason.trim()
      record('UPDATE', 'handovers', h.id, itemId, old, { ...h })
      setStatus(db.items.find((i) => i.id === itemId)!, 'received')
    },

    async updateItem(id, patch) {
      await delay()
      if (!can(role, 'editItem')) deny()
      const it = db.items.find((i) => i.id === id)!
      const old = { ...it }
      Object.assign(it, patch)
      record('UPDATE', 'order_items', id, id, old, { ...it })
    },

    async deleteItem(id) {
      await delay()
      if (!can(role, 'delete')) deny()
      const i = db.items.findIndex((x) => x.id === id)
      const [old] = db.items.splice(i, 1)
      record('DELETE', 'order_items', id, id, old, null)
    },

    async importOrders(a: ImportArgs) {
      await delay(400)
      if (!can(role, 'import')) deny()
      for (const pb of a.buyers) {
        let b = db.buyers.find((x) => x.roll_no === pb.roll_no)
        if (!b) {
          b = { id: uid('b'), ...pb }
          db.buyers.push(b)
          record('INSERT', 'buyers', b.id, null, null, { ...b })
        }
      }
      for (const x of a.items) {
        const b = db.buyers.find((y) => y.roll_no === x.roll_no)!
        const it: OrderItem = {
          id: uid('i'), campaign_id: a.campaignId, buyer_id: b.id, product_id: x.product_id, size: x.size,
          print_name: x.print_name, batch: x.batch, status: 'ordered', status_changed_at: null,
          source_timestamp: x.source_timestamp, source_slot: x.source_slot, created_at: new Date().toISOString(),
        }
        db.items.push(it)
        record('INSERT', 'order_items', it.id, it.id, null, { ...it })
      }
      return { items_created: a.items.length }
    },

    async addNote(n) {
      await delay()
      const note: Note = {
        id: uid('n'), buyer_id: n.buyer_id ?? null, item_id: n.item_id ?? null, body: n.body, is_flag: n.is_flag,
        resolved: false, created_by: meId(), created_at: new Date().toISOString(),
      }
      db.notes.push(note)
      record('INSERT', 'notes', note.id, note.item_id, null, { ...note })
    },

    async setNoteResolved(id, resolved) {
      await delay()
      if (!can(role, 'resolveNotes')) deny()
      const n = db.notes.find((x) => x.id === id)!
      const old = { ...n }
      n.resolved = resolved
      record('UPDATE', 'notes', id, n.item_id, old, { ...n })
    },

    async setSpare(productId, size, quantity) {
      await delay()
      if (!can(role, 'spare')) deny()
      let s = db.spare.find((x) => x.product_id === productId && x.size === size)
      const old = s ? { ...s } : null
      if (!s) {
        s = { id: uid('s'), product_id: productId, size, quantity, note: null }
        db.spare.push(s)
      }
      s.quantity = quantity
      record(old ? 'UPDATE' : 'INSERT', 'spare_stock', s.id, null, old, { ...s })
    },

    async activity(q) {
      await delay(80)
      return clone(
        [...log]
          .reverse()
          .filter((e) => (!q.beforeId || e.id < q.beforeId) && (!q.table || e.table_name === q.table))
          .slice(0, q.limit),
      )
    },

    async itemHistory(itemId) {
      await delay(80)
      return clone(log.filter((e) => e.item_id === itemId))
    },

    async saveMember(m) {
      await delay()
      if (!can(role, 'manageMembers')) deny()
      if (!m.email.endsWith('@mdi.ac.in')) throw new Error('Team members need an @mdi.ac.in email')
      const existing = db.members.find((x) => x.id === m.id)
      if (existing) {
        const old = { ...existing }
        Object.assign(existing, m)
        record('UPDATE', 'members', existing.id, null, old, { ...existing })
      } else {
        const row = { ...m, id: uid('m') }
        db.members.push(row)
        record('INSERT', 'members', row.id, null, null, row)
      }
    },

    async deleteMember(id) {
      await delay()
      if (role !== 'main_admin') throw new Error('Only the super admin can remove team members.')
      const i = db.members.findIndex((m) => m.id === id)
      const m = db.members[i]
      if (m.role === 'main_admin' && db.members.filter((x) => x.role === 'main_admin' && x.active).length <= 1) {
        throw new Error('There must always be at least one active super admin')
      }
      db.members.splice(i, 1)
      record('DELETE', 'members', id, null, m, null)
    },

    async saveProduct(p) {
      await delay()
      if (!can(role, 'editProducts')) deny()
      const existing = db.products.find((x) => x.id === p.id)
      if (existing) {
        const old = { ...existing }
        Object.assign(existing, p)
        record('UPDATE', 'products', existing.id, null, old, { ...existing })
      } else {
        const { id: _ignored, ...rest } = p
        void _ignored
        const row: Product = {
          name: '', colour: '', price_inr: 0, sizes: [], form_keywords: [], sort_order: 99, ...rest, id: uid('p'),
        }
        db.products.push(row)
        record('INSERT', 'products', row.id, null, null, row)
      }
    },

    async deleteProduct(id) {
      await delay()
      if (!can(role, 'editProducts')) deny()
      if (db.items.some((i) => i.product_id === id)) {
        throw new Error('This product has orders, so it can’t be deleted. Close its sales round instead.')
      }
      const i = db.products.findIndex((p) => p.id === id)
      const [old] = db.products.splice(i, 1)
      record('DELETE', 'products', id, null, old, null)
    },

    async saveCampaign(c) {
      await delay()
      if (!can(role, 'editProducts')) deny()
      const existing = db.campaigns.find((x) => x.id === c.id)
      if (existing) Object.assign(existing, c)
      else db.campaigns.push({ id: uid('c'), name: c.name, is_active: c.is_active })
    },
  }
}
