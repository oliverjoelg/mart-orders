import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { friendlyError, type Snapshot } from './api'
import { useAuth } from './auth'
import { setPermissionData } from './permissions'
import { memberLabel, type Buyer, type Campaign, type ItemView, type Member, type Note, type Product } from './types'

interface DataState {
  loading: boolean
  error: string | null
  snapshot: Snapshot | null
  /** all items of the selected campaign, joined */
  items: ItemView[]
  products: Product[]
  campaigns: Campaign[]
  campaign: Campaign | null
  setCampaignId(id: string): void
  buyersById: Map<string, Buyer>
  productsById: Map<string, Product>
  notesByBuyer: Map<string, Note[]>
  memberName(userId: string | null | undefined): string
  membersByUserId: Map<string, Member>
  refresh(): Promise<void>
  lastLoaded: number
}

const Ctx = createContext<DataState | null>(null)
const CAMPAIGN_KEY = 'mart-campaign'

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { api } = useAuth()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [campaignId, setCampaignIdState] = useState<string | null>(() => readStored(CAMPAIGN_KEY))
  const [lastLoaded, setLastLoaded] = useState(0)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const s = await api.loadSnapshot()
      setSnapshot(s)
      setLastLoaded(Date.now())
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Pick up other people's changes when the tab comes back into view.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoaded > 30_000) void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh, lastLoaded])

  const value = useMemo<DataState>(() => {
    // roles & ticks drive can(); refresh them before any page renders with this data
    setPermissionData(snapshot?.roles ?? [], snapshot?.rolePermissions ?? [])
    const campaigns = [...(snapshot?.campaigns ?? [])].sort(
      (a, b) => Number(!!a.locked) - Number(!!b.locked) || Number(b.is_active) - Number(a.is_active) || (b.created_at ?? '').localeCompare(a.created_at ?? ''),
    )
    const campaign = campaigns.find((c) => c.id === campaignId) ?? campaigns[0] ?? null
    const buyersById = new Map((snapshot?.buyers ?? []).map((b) => [b.id, b]))
    const productsById = new Map((snapshot?.products ?? []).map((p) => [p.id, p]))
    const handoverByItem = new Map((snapshot?.handovers ?? []).map((h) => [h.item_id, h]))
    const membersByUserId = new Map<string, Member>()
    for (const m of snapshot?.members ?? []) if (m.user_id) membersByUserId.set(m.user_id, m)
    const notesByBuyer = new Map<string, Note[]>()
    for (const n of snapshot?.notes ?? []) {
      if (!n.buyer_id) continue
      const list = notesByBuyer.get(n.buyer_id) ?? []
      list.push(n)
      notesByBuyer.set(n.buyer_id, list)
    }
    const items: ItemView[] = []
    for (const i of snapshot?.items ?? []) {
      if (campaign && i.campaign_id !== campaign.id) continue
      const buyer = buyersById.get(i.buyer_id)
      const product = productsById.get(i.product_id)
      if (!buyer || !product) continue
      items.push({ ...i, buyer, product, handover: handoverByItem.get(i.id) ?? null })
    }
    return {
      loading,
      error,
      snapshot,
      items,
      products: (snapshot?.products ?? [])
        .filter((p) => !campaign || p.campaign_id === campaign.id)
        .sort((a, b) => a.sort_order - b.sort_order),
      campaigns,
      campaign,
      setCampaignId(id) {
        setCampaignIdState(id)
        try {
          localStorage.setItem(CAMPAIGN_KEY, id)
        } catch {
          /* private mode */
        }
      },
      buyersById,
      productsById,
      notesByBuyer,
      membersByUserId,
      memberName(userId) {
        if (!userId) return 'System'
        const m = membersByUserId.get(userId)
        return m ? memberLabel(m) : 'Unknown member'
      },
      refresh,
      lastLoaded,
    }
  }, [snapshot, loading, error, campaignId, refresh, lastLoaded])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useData(): DataState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useData outside DataProvider')
  return v
}
