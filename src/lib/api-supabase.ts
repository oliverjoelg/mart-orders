import type { PostgrestError } from '@supabase/supabase-js'
import type { ActivityQuery, Api, AuthUser, ImportArgs, Snapshot } from './api'
import { getSupabase } from './supabase'
import type { AuditEntry, Member } from './types'

const PAGE = 1000 // Supabase returns at most 1000 rows per request

function check<T>(res: { data: T; error: PostgrestError | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data
}

async function fetchAll<T>(table: string, whereNull?: string): Promise<T[]> {
  const sb = getSupabase()
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select('*')
    if (whereNull) q = q.is(whereNull, null)
    const res = await q.order('id', { ascending: true }).range(from, from + PAGE - 1)
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

    async loadSnapshot(): Promise<Snapshot> {
      const [campaigns, products, buyers, items, handovers, notes, spare, members] = await Promise.all([
        fetchAll<Snapshot['campaigns'][number]>('campaigns'),
        fetchAll<Snapshot['products'][number]>('products'),
        fetchAll<Snapshot['buyers'][number]>('buyers'),
        fetchAll<Snapshot['items'][number]>('order_items'),
        fetchAll<Snapshot['handovers'][number]>('handovers', 'undone_at'),
        fetchAll<Snapshot['notes'][number]>('notes'),
        fetchAll<Snapshot['spare'][number]>('spare_stock'),
        fetchAll<Snapshot['members'][number]>('members'),
      ])
      return { campaigns, products, buyers, items, handovers, notes, spare, members }
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
        }),
      ) as { items_created: number }
    },

    async addNote(n) {
      const { data } = await sb.auth.getUser()
      check(await sb.from('notes').insert({ ...n, created_by: data.user?.id }))
    },

    async setNoteResolved(id, resolved) {
      check(await sb.from('notes').update({ resolved }).eq('id', id))
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
      const row = { email: m.email.trim().toLowerCase(), display_name: m.display_name.trim(), role: m.role, active: m.active }
      if (m.id) check(await sb.from('members').update(row).eq('id', m.id))
      else check(await sb.from('members').insert(row))
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

    async saveCampaign(c) {
      const { id, ...rest } = c
      if (id) check(await sb.from('campaigns').update(rest).eq('id', id))
      else check(await sb.from('campaigns').insert(rest))
    },
  }
}
