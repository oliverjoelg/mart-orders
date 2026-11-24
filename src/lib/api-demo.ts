/**
 * In-memory backend with made-up data, for `npm run dev:demo`. Lets anyone click through the
 * whole app (and switch roles) without a Supabase project or Google sign-in. Nothing is saved.
 * It mimics the database rules loosely; the real enforcement is in the SQL migrations.
 */
import { pickCampaign, type Api, type ImportArgs, type Snapshot } from './api'
import { can, isSuperRole, type PermissionRow, type RolePermissionRow, type RoleRow } from './permissions'

// Same defaults as migration 20261119120800 (the real list lives in the database).
const DEMO_ROLES: RoleRow[] = [
  { key: 'main_admin', name: 'Super admin', is_super: true, sort_order: 0 },
  { key: 'admin', name: 'Admin', is_super: false, sort_order: 1 },
  { key: 'ops', name: 'Ops', is_super: false, sort_order: 2 },
]
const DEMO_PERMISSIONS: PermissionRow[] = [
  ['receive_stock', 'Receive stock / change status', 'Mark items as with the vendor, arrived in MART, or back to ordered'],
  ['hand_over', 'Hand over items', 'Use the handover desk'],
  ['undo_handover', 'Undo a handover', 'Needs a reason; the item goes back on the shelf'],
  ['add_orders', 'Add orders', 'Upload the order file or add an order by hand'],
  ['edit_items', 'Edit item details', 'Change product, size, back name or batch of an item'],
  ['delete_items', 'Delete items', null],
  ['manage_products', 'Manage sales rounds & products', 'Create rounds, add, edit and delete products'],
  ['spare_stock', 'Edit spare stock', null],
  ['add_notes', 'Add notes & flags', null],
  ['resolve_flags', 'Mark flags as sorted', null],
  ['manage_team', 'Add team members & set roles', 'Cannot touch super admins'],
  ['remove_members', 'Remove team members', 'Cannot remove super admins'],
  ['check_payments', 'Check payments', 'Mark payments received or as a problem, fix typos, add a payment'],
].map(([key, label, hint], i): PermissionRow => ({ key: key!, label: label!, hint, kind: 'action', sort_order: (i + 1) * 10 }))
  .concat(
    [
      ['page_home', 'Home', null],
      ['page_desk', 'Handover desk', 'Search students and see their items'],
      ['page_lists', 'Student lists', 'Call lists, emails, CSV'],
      ['page_items', 'Items', null],
      ['page_inventory', 'Inventory', null],
      ['page_print_list', 'Vendor print list', null],
      ['page_activity', 'Activity', null],
      ['page_products', 'Products', null],
      ['page_payments', 'Payments', 'See who paid what, and to whom'],
    ].map(([key, label, hint], i): PermissionRow => ({ key: key!, label: label!, hint, kind: 'page', sort_order: 200 + i * 10 })),
  )
// like the database: the payment permissions start with the super admin only
const NEW_PERMS = ['remove_members', 'check_payments', 'page_payments']
const DEMO_ROLE_PERMS: RolePermissionRow[] = [
  ...DEMO_PERMISSIONS.filter((p) => !NEW_PERMS.includes(p.key)).map((p) => ({ role_key: 'admin', permission: p.key })),
  ...DEMO_PERMISSIONS.filter(
    (p) => (p.kind === 'page' && p.key !== 'page_payments') || ['receive_stock', 'hand_over', 'spare_stock', 'add_notes', 'resolve_flags'].includes(p.key),
  ).map((p) => ({ role_key: 'ops', permission: p.key })),
]
import type {
  AuditEntry,
  Buyer,
  Campaign,
  Handover,
  ItemStatus,
  Member,
  Note,
  OrderItem,
  Payment,
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

// some back names are printed in other scripts (Hindi, Tamil, Kannada, Bengali), as in real orders
const INDIC_NAMES = ['राहुल', 'प्रिया', 'अर्जुन', 'स्नेहा', 'அருண்', 'ಅನಿಲ್', 'অমিত']
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

function build(): { db: Snapshot & { payments: Payment[] }; log: AuditEntry[] } {
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
  const payments: Payment[] = []
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
    const firstItem = items.length
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
        print_name: r() < 0.3 ? null : r() < 0.12 ? pick(INDIC_NAMES) : r() < 0.5 ? first.toUpperCase() : first,
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
    // what they say they paid: mostly right, a few typos, some already checked
    const cost = items.slice(firstItem).reduce((sum, it) => sum + (products.find((p) => p.id === it.product_id)?.price_inr ?? 0), 0)
    const odd = r()
    const checked = r()
    payments.push({
      id: uid('pay'), campaign_id: campaign.id, buyer_id: b.id, source_timestamp: ts,
      paid_to: r() < 0.78 ? 'Animesh Pratap Kumawat' : 'Ekta Bansal',
      amount_paid: odd < 0.04 ? cost + 1 : odd < 0.07 ? cost - 699 : odd < 0.08 ? null : cost,
      txn_id: n === 42 ? payments[3]?.txn_id ?? null : String(500000000000 + Math.floor(r() * 99999999999)),
      screenshot_url: 'https://drive.google.com/open?id=demo',
      status: checked < 0.45 ? 'received' : checked < 0.48 ? 'problem' : 'unchecked',
      note: checked >= 0.45 && checked < 0.48 ? 'Not in UPI history' : null,
      checked_by: checked < 0.48 ? 'u1' : null,
      checked_at: checked < 0.48 ? new Date(t0 + 5 * 86400_000).toISOString() : null,
      created_at: ts,
    })
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
  return {
    db: {
      campaigns: [campaign], products, buyers, items, handovers, notes, payments, spare, members: DEMO_MEMBERS,
      roles: structuredClone(DEMO_ROLES), permissions: DEMO_PERMISSIONS, rolePermissions: structuredClone(DEMO_ROLE_PERMS),
      campaignId: null as string | null,
    },
    log,
  }
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
    id, at, actor_id: USER_ID[m.id] ?? null, actor_email: m.email, actor_name: m.nickname?.trim() || m.display_name, actor_role: m.role,
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

    async loadSnapshot(campaignId) {
      await delay(200)
      // like the database: locked rounds are invisible to anyone but super admins
      const hidden = new Set(isSuperRole(role) ? [] : db.campaigns.filter((c) => c.locked).map((c) => c.id))
      const campaigns = db.campaigns.filter((c) => !hidden.has(c.id))
      const cid = pickCampaign(campaigns, campaignId)
      // like the real backend: only one round's items are loaded
      const items = db.items.filter((i) => i.campaign_id === cid)
      const itemIds = new Set(items.map((i) => i.id))
      const buyerIds = new Set(items.map((i) => i.buyer_id))
      return clone({
        ...db,
        campaigns,
        products: db.products.filter((p) => !hidden.has(p.campaign_id)),
        items,
        buyers: db.buyers.filter((b) => buyerIds.has(b.id)),
        handovers: db.handovers.filter((h) => !h.undone_at && itemIds.has(h.item_id)),
        campaignId: cid,
      })
    },

    async loadItems(ids) {
      await delay(60)
      const set = new Set(ids)
      return clone({
        items: db.items.filter((i) => set.has(i.id)),
        handovers: db.handovers.filter((h) => !h.undone_at && set.has(h.item_id)),
      })
    },

    async findBuyer(rollNo) {
      await delay(60)
      return clone(db.buyers.find((b) => b.roll_no === rollNo) ?? null)
    },

    async exportAll() {
      await delay(300)
      return clone({
        campaigns: db.campaigns, products: db.products, buyers: db.buyers, order_items: db.items, handovers: db.handovers,
        notes: db.notes, payments: db.payments, spare_stock: db.spare, members: db.members, roles: db.roles, role_permissions: db.rolePermissions,
        audit_log: log,
      }) as unknown as Record<string, Record<string, unknown>[]>
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
      let added = 0
      for (const x of a.payments ?? []) {
        const b = db.buyers.find((y) => y.roll_no === x.roll_no)
        if (!b || !db.items.some((i) => i.buyer_id === b.id && i.campaign_id === a.campaignId)) continue
        if (db.payments.some((p) => p.campaign_id === a.campaignId && p.buyer_id === b.id && p.source_timestamp === x.source_timestamp)) continue
        const pay: Payment = {
          id: uid('pay'), campaign_id: a.campaignId, buyer_id: b.id, source_timestamp: x.source_timestamp, paid_to: x.paid_to,
          amount_paid: x.amount_paid, txn_id: x.txn_id, screenshot_url: x.screenshot_url, status: 'unchecked', note: null,
          checked_by: null, checked_at: null, created_at: new Date().toISOString(),
        }
        db.payments.push(pay)
        record('INSERT', 'payments', pay.id, null, null, { ...pay })
        added++
      }
      return { items_created: a.items.length, payments_added: added }
    },

    async loadPayments(campaignId) {
      await delay(80)
      if (!can(role, 'pagePayments')) return []
      return clone(db.payments.filter((p) => p.campaign_id === campaignId))
    },

    async updatePayment(id, patch) {
      await delay()
      if (!can(role, 'checkPayments')) deny()
      const p = db.payments.find((x) => x.id === id)!
      const old = { ...p }
      Object.assign(p, patch)
      if (patch.status && patch.status !== old.status) {
        p.checked_by = patch.status === 'unchecked' ? null : meId()
        p.checked_at = patch.status === 'unchecked' ? null : new Date().toISOString()
      }
      record('UPDATE', 'payments', id, null, old, { ...p })
      return clone(p)
    },

    async addPayment(x) {
      await delay()
      if (!can(role, 'checkPayments')) deny()
      const p: Payment = {
        id: uid('pay'), source_timestamp: null, screenshot_url: null, created_at: new Date().toISOString(), ...x,
        checked_by: x.status === 'unchecked' ? null : meId(), checked_at: x.status === 'unchecked' ? null : new Date().toISOString(),
      }
      db.payments.push(p)
      record('INSERT', 'payments', p.id, null, null, { ...p })
      return clone(p)
    },

    async deletePayment(id) {
      await delay()
      if (!isSuperRole(role)) deny()
      const i = db.payments.findIndex((p) => p.id === id)
      record('DELETE', 'payments', id, null, { ...db.payments[i] }, null)
      db.payments.splice(i, 1)
    },

    async usageStats() {
      await delay(150)
      if (!isSuperRole(role)) throw new Error('Only a super admin can see usage')
      const mb = 1024 * 1024
      return {
        db_bytes: Math.round(14.2 * mb),
        public_bytes: Math.round(3.1 * mb),
        tables: [
          { name: 'audit_log', bytes: Math.round(1.4 * mb), rows: log.length },
          { name: 'order_items', bytes: Math.round(0.6 * mb), rows: db.items.length },
          { name: 'buyers', bytes: Math.round(0.3 * mb), rows: db.buyers.length },
          { name: 'payments', bytes: Math.round(0.25 * mb), rows: db.payments.length },
          { name: 'handovers', bytes: Math.round(0.2 * mb), rows: db.handovers.length },
        ],
        storage_bytes: 0,
        storage_files: 0,
        first_round_at: new Date(Date.now() - 80 * 86400_000).toISOString(),
        orders: db.items.length,
        measured_at: new Date().toISOString(),
      }
    },

    async txnElsewhere(txnIds, campaignId) {
      await delay(60)
      const set = new Set(txnIds)
      return db.payments.filter((p) => p.campaign_id !== campaignId && p.txn_id && set.has(p.txn_id)).map((p) => ({ txn_id: p.txn_id!, campaign_id: p.campaign_id }))
    },

    async addNote(n) {
      await delay()
      const note: Note = {
        id: uid('n'), buyer_id: n.buyer_id ?? null, item_id: n.item_id ?? null, body: n.body, is_flag: n.is_flag,
        resolved: false, created_by: meId(), created_at: new Date().toISOString(),
      }
      db.notes.push(note)
      record('INSERT', 'notes', note.id, note.item_id, null, { ...note })
      return clone(note)
    },

    async setNoteResolved(id, resolved) {
      await delay()
      if (!can(role, 'resolveNotes')) deny()
      const n = db.notes.find((x) => x.id === id)!
      const old = { ...n }
      n.resolved = resolved
      record('UPDATE', 'notes', id, n.item_id, old, { ...n })
      return clone(n)
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
      if (!m.email.endsWith('@mdi.ac.in') && !isSuperRole(m.role)) {
        throw new Error('Team members need an @mdi.ac.in email (only a super admin can use another email)')
      }
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
      const i = db.members.findIndex((m) => m.id === id)
      const m = db.members[i]
      if (!(isSuperRole(role) || (can(role, 'removeMembers') && !isSuperRole(m.role)))) throw new Error("Your role can't remove this member.")
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
      if (existing?.locked) throw new Error('This sales round is locked. A super admin must unlock it first.')
      if (existing) Object.assign(existing, c)
      else db.campaigns.push({ id: uid('c'), name: c.name, is_active: c.is_active, locked: false })
    },

    async setCampaignLocked(id, locked) {
      await delay()
      if (!isSuperRole(role)) throw new Error('Only a super admin can lock or unlock a sales round')
      const c = db.campaigns.find((x) => x.id === id)!
      const old = { ...c }
      c.locked = locked
      record('UPDATE', 'campaigns', id, null, old, { ...c })
    },

    async saveRole(r) {
      await delay()
      if (!isSuperRole(role)) deny()
      if (r.key) {
        const row = db.roles.find((x) => x.key === r.key)!
        if (row.is_super) throw new Error('The super admin role cannot be changed')
        row.name = r.name.trim()
        return
      }
      const key = r.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'role'
      if (db.roles.some((x) => x.key === key || x.name.toLowerCase() === r.name.trim().toLowerCase())) throw new Error('That role already exists')
      db.roles.push({ key, name: r.name.trim(), is_super: false, sort_order: 100 })
    },

    async deleteRole(key) {
      await delay()
      if (!isSuperRole(role)) deny()
      const row = db.roles.find((x) => x.key === key)
      if (row?.is_super) throw new Error('The super admin role cannot be deleted')
      if (db.members.some((m) => m.role === key)) throw new Error('Move everyone off this role first, then delete it.')
      db.roles = db.roles.filter((x) => x.key !== key)
      db.rolePermissions = db.rolePermissions.filter((x) => x.role_key !== key)
    },

    async setPermission(roleKey, permission, allowed) {
      await delay(60)
      if (!isSuperRole(role)) deny()
      db.rolePermissions = db.rolePermissions.filter((x) => !(x.role_key === roleKey && x.permission === permission))
      if (allowed) db.rolePermissions.push({ role_key: roleKey, permission })
    },
  }
}
