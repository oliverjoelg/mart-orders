import type { PostgrestError } from '@supabase/supabase-js'
import { pickCampaign, type ActivityQuery, type Api, type AuthUser, type ImportArgs, type Snapshot } from './api'
import { getSupabase } from './supabase'
import type { AuditEntry, Buyer, Handover, Member, Note, OrderItem, Payment } from './types'



const PAGE = 1000 // Supabase returns at most 1000 rows per request

function check<T>(res: { data: T; error: PostgrestError | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data
}

interface FetchOpts {
  select?: string
  eq?: [string, string][]
}

async function fetchAll<T>(table: string, whereNull?: string, orderBy = 'id', opts: FetchOpts = {}): Promise<T[]> {
  const sb = getSupabase()
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(opts.select ?? '*')
    if (whereNull) q = q.is(whereNull, null)
    for (const [col, val] of opts.eq ?? []) q = q.eq(col, val)
    const res = await q.order(orderBy, { ascending: true }).range(from, from + PAGE - 1)
    const rows = check(res) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export function createSupabaseApi(): Api {
  const sb = getSupabase()

  return {
    mode: 'supabase',

    async getUser() {
      const { data } = await sb.auth.getSession()
      const u = data.session?.user
      return u ? { id: u.id, email: (u.email ?? '').toLowerCase() } : null
    },

    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange(() => cb())
      return () => data.subscription.unsubscribe()
    },

    async signIn() {
      const redirectTo = window.location.origin + import.meta.env.BASE_URL
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, queryParams: { hd: 'mdi.ac.in', prompt: 'select_account' } },
      })
      if (error) throw error
    },

    async signOut() {
      await sb.auth.signOut()
    },

    async getMyMember(user: AuthUser) {
      await sb.rpc('link_my_member')
      const res = await sb.from('members').select('*').eq('email', user.email).eq('active', true).maybeSingle()
      return check(res) as Member | null
    },

    async loadSnapshot(campaignId?: string | null): Promise<Snapshot> {
      // small shared tables first, to know which round to load
      const [campaigns, products, spare, members, roles, permissions, rolePermissions] = await Promise.all([
        fetchAll<Snapshot['campaigns'][number]>('campaigns'),
        fetchAll<Snapshot['products'][number]>('products'),
        fetchAll<Snapshot['spare'][number]>('spare_stock'),
        fetchAll<Snapshot['members'][number]>('members'),
        fetchAll<Snapshot['roles'][number]>('roles', undefined, 'sort_order'),
        fetchAll<Snapshot['permissions'][number]>('permissions', undefined, 'sort_order'),
        fetchAll<Snapshot['rolePermissions'][number]>('role_permissions', undefined, 'role_key'),
      ])
      const cid = pickCampaign(campaigns, campaignId)
      if (!cid) {
        return { campaigns, products, spare, members, roles, permissions, rolePermissions, buyers: [], items: [], handovers: [], notes: [], campaignId: null }
      }
      // only this round's items, the students who ordered in it, and its live handovers
      const strip = <T,>(rows: (T & { order_items?: unknown })[]) =>
        rows.map((r) => {
          const copy = { ...r }
          delete copy.order_items
          return copy as T
        })
      const [items, buyers, handovers, notes] = await Promise.all([
        fetchAll<Snapshot['items'][number]>('order_items', undefined, 'id', { eq: [['campaign_id', cid]] }),
        fetchAll<Snapshot['buyers'][number] & { order_items?: unknown }>('buyers', undefined, 'id', {
          select: '*, order_items!inner(campaign_id)',
          eq: [['order_items.campaign_id', cid]],
        }).then((r) => strip<Snapshot['buyers'][number]>(r)),
        fetchAll<Snapshot['handovers'][number] & { order_items?: unknown }>('handovers', 'undone_at', 'id', {
          select: '*, order_items!inner(campaign_id)',
          eq: [['order_items.campaign_id', cid]],
        }).then((r) => strip<Snapshot['handovers'][number]>(r)),
        fetchAll<Snapshot['notes'][number]>('notes'),
      ])
      return { campaigns, products, buyers, items, handovers, notes, spare, members, roles, permissions, rolePermissions, campaignId: cid }
    },

    async loadItems(ids) {
      const items: OrderItem[] = []
      const handovers: Handover[] = []
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100)
        const [it, ho] = await Promise.all([
          sb.from('order_items').select('*').in('id', chunk),
          sb.from('handovers').select('*').in('item_id', chunk).is('undone_at', null),
        ])
        items.push(...(check(it) as OrderItem[]))
        handovers.push(...(check(ho) as Handover[]))
      }
      return { items, handovers }
    },

    async findBuyer(rollNo) {
      return check(await sb.from('buyers').select('*').eq('roll_no', rollNo).maybeSingle()) as Buyer | null
    },

    async exportAll() {
      const tables: [string, string][] = [
        ['campaigns', 'id'], ['products', 'id'], ['buyers', 'id'], ['order_items', 'id'], ['handovers', 'id'],
        ['notes', 'id'], ['payments', 'id'], ['spare_stock', 'id'], ['imports', 'id'], ['members', 'id'], ['roles', 'sort_order'],
        ['role_permissions', 'role_key'], ['audit_log', 'id'],
      ]
      const out: Record<string, Record<string, unknown>[]> = {}
      for (const [t, order] of tables) out[t] = await fetchAll<Record<string, unknown>>(t, undefined, order)
      return out
    },

    async setItemsStatus(ids, status) {
      return check(await sb.rpc('set_items_status', { p_item_ids: ids, p_status: status })) as number
    },

    async recordHandover(ids, type, collectorName, collectorRoll) {
      return check(
        await sb.rpc('record_handover', {
          p_item_ids: ids,
          p_type: type,
          p_collector_name: collectorName ?? null,
          p_collector_roll: collectorRoll ?? null,
        }),
      ) as number
    },

    async undoHandover(itemId, reason) {
      check(await sb.rpc('undo_handover', { p_item_id: itemId, p_reason: reason }))
    },

    async updateItem(id, patch) {
      check(await sb.from('order_items').update(patch).eq('id', id))
    },

    async deleteItem(id) {
      const res = await sb.from('order_items').delete().eq('id', id).select('id')
      if ((check(res) as unknown[]).length === 0) throw new Error("Your role isn't allowed to delete.")
    },

    async importOrders(a: ImportArgs) {
      return check(
        await sb.rpc('import_orders', {
          p_campaign_id: a.campaignId,
          p_file_name: a.fileName,
          p_responses: a.responses,
          p_duplicates_skipped: a.duplicatesSkipped,
          p_buyers: a.buyers,
          p_items: a.items,
          p_payments: a.payments ?? [],
        }),
      ) as { items_created: number; payments_added: number }
    },

    async loadPayments(campaignId) {
      return fetchAll<Payment>('payments', undefined, 'id', { eq: [['campaign_id', campaignId]] })
    },

    async updatePayment(id, patch) {
      return check(await sb.from('payments').update(patch).eq('id', id).select().single()) as Payment
    },

    async addPayment(p) {
      return check(await sb.from('payments').insert(p).select().single()) as Payment
    },

    async deletePayment(id) {
      check(await sb.from('payments').delete().eq('id', id))
    },

    async screenshotLink(path) {
      const { data, error } = await sb.storage.from('payment-screenshots').createSignedUrl(path, 600)
      if (error) throw error
      return data.signedUrl
    },

    async txnElsewhere(txnIds, campaignId) {
      const out: { txn_id: string; campaign_id: string }[] = []
      for (let i = 0; i < txnIds.length; i += 100) {
        const res = await sb.from('payments').select('txn_id, campaign_id').in('txn_id', txnIds.slice(i, i + 100)).neq('campaign_id', campaignId)
        out.push(...(check(res) as { txn_id: string; campaign_id: string }[]))
      }
      return out
    },

    async addNote(n) {
      const { data } = await sb.auth.getUser()
      return check(await sb.from('notes').insert({ ...n, created_by: data.user?.id }).select().single()) as Note
    },

    async setNoteResolved(id, resolved) {
      return check(await sb.from('notes').update({ resolved }).eq('id', id).select().single()) as Note
    },

    async setSpare(productId, size, quantity) {
      check(
        await sb
          .from('spare_stock')
          .upsert({ product_id: productId, size, quantity }, { onConflict: 'product_id,size' }),
      )
    },

    async activity(q: ActivityQuery) {
      let query = sb.from('audit_log').select('*').order('id', { ascending: false }).limit(q.limit)
      if (q.beforeId) query = query.lt('id', q.beforeId)
      if (q.table) query = query.eq('table_name', q.table)
      return check(await query) as AuditEntry[]
    },

    async itemHistory(itemId) {
      return check(
        await sb.from('audit_log').select('*').eq('item_id', itemId).order('id', { ascending: true }),
      ) as AuditEntry[]
    },

    async saveMember(m) {
      // Names come from Google at sign-in (see link_my_member); edits only change role / active.
      if (m.id) check(await sb.from('members').update({ role: m.role, active: m.active, nickname: m.nickname }).eq('id', m.id))
      else
        check(
          await sb.from('members').insert({
            email: m.email.trim().toLowerCase(),
            display_name: m.display_name.trim(),
            nickname: m.nickname,
            role: m.role,
            active: m.active,
          }),
        )
    },

    async deleteMember(id) {
      const res = await sb.from('members').delete().eq('id', id).select('id')
      if ((check(res) as unknown[]).length === 0) throw new Error('Only the super admin can remove team members.')
    },

    async saveProduct(p) {
      const { id, ...rest } = p
      if (id) check(await sb.from('products').update(rest).eq('id', id))
      else check(await sb.from('products').insert(rest))
    },

    async deleteProduct(id) {
      const res = await sb.from('products').delete().eq('id', id).select('id')
      if (res.error) {
        if (/foreign key/i.test(res.error.message)) throw new Error('This product has orders, so it can’t be deleted. Close its sales round instead.')
        throw new Error(res.error.message)
      }
      if ((res.data ?? []).length === 0) throw new Error("Your role isn't allowed to delete products.")
    },

    async setCampaignLocked(id, locked) {
      const res = await sb.from('campaigns').update({ locked }).eq('id', id).select('id')
      if ((check(res) as unknown[]).length === 0) throw new Error('Only a super admin can lock or unlock a sales round.')
    },

    async saveRole(r) {
      if (r.key) {
        check(await sb.from('roles').update({ name: r.name.trim() }).eq('key', r.key))
        return
      }
      const key = r.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28) || 'role'
      check(await sb.from('roles').insert({ key: /^[a-z]/.test(key) ? key : `r_${key}`, name: r.name.trim() }))
    },

    async deleteRole(key) {
      const res = await sb.from('roles').delete().eq('key', key).select('key')
      if (res.error) {
        if (/foreign key/i.test(res.error.message)) throw new Error('Move everyone off this role first, then delete it.')
        throw new Error(res.error.message)
      }
    },

    async setPermission(roleKey, permission, allowed) {
      if (allowed) check(await sb.from('role_permissions').upsert({ role_key: roleKey, permission }, { onConflict: 'role_key,permission' }))
      else check(await sb.from('role_permissions').delete().eq('role_key', roleKey).eq('permission', permission))
    },

    async saveCampaign(c) {
      const { id, ...rest } = c
      if (id) check(await sb.from('campaigns').update(rest).eq('id', id))
      else check(await sb.from('campaigns').insert(rest))
    },
  }
}
