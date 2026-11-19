import { ArrowLeft, Check, PackageOpen, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { Empty, Modal, PageHead, swatchColour } from '../components/ui'
import { friendlyError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { plural } from '../lib/format'
import { compareSizes } from '../lib/import/normalize'
import { can } from '../lib/permissions'
import { useData } from '../lib/store'
import type { ItemView, Product } from '../lib/types'

/**
 * Ops: "the vendor's box arrived". Pick the colour, tick the items that came (or a whole size
 * at once), confirm. They become "In MART" and show up as ready at the handover desk.
 */
export default function Receive() {
  const { items, products, refresh } = useData()
  const { api, member } = useAuth()
  const toast = useToast()
  const [productId, setProductId] = useState<string | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  const waiting = useMemo(() => items.filter((i) => i.status === 'ordered' || i.status === 'sent_to_vendor'), [items])
  const product = products.find((p) => p.id === productId) ?? null

  const bySize = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = waiting
      .filter((i) => i.product_id === productId)
      .filter(
        (i) =>
          !term ||
          (i.print_name ?? '').toLowerCase().includes(term) ||
          i.buyer.roll_no.toLowerCase().includes(term) ||
          i.buyer.name.toLowerCase().includes(term),
      )
    const groups = new Map<string, ItemView[]>()
    for (const i of list.sort((a, b) => compareSizes(a.size, b.size) || (a.print_name ?? '~').localeCompare(b.print_name ?? '~'))) {
      groups.set(i.size, [...(groups.get(i.size) ?? []), i])
    }
    return [...groups.entries()]
  }, [waiting, productId, q])

  if (!can(member?.role, 'setStatus')) {
    return (
      <div className="page narrow">
        <Empty icon={<PackageOpen size={20} />} title="Only Ops and admins can receive stock" />
      </div>
    )
  }

  const pick = (p: Product) => {
    setProductId(p.id)
    setTicked(new Set())
    setQ('')
    setDone(null)
    window.scrollTo({ top: 0 })
  }

  const toggle = (ids: string[], on: boolean) => {
    const n = new Set(ticked)
    for (const id of ids) {
      if (on) n.add(id)
      else n.delete(id)
    }
    setTicked(n)
  }

  const save = async () => {
    setBusy(true)
    try {
      const n = await api.setItemsStatus([...ticked], 'received')
      setDone(`${plural(n, `${product?.colour ?? ''} item`)} marked as arrived. Students can now collect them at the desk.`)
      setTicked(new Set())
      setConfirm(false)
      await refresh()
      window.scrollTo({ top: 0 })
    } catch (e) {
      toast.err(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  // ---------- step 1: which colour came?
  if (!product) {
    return (
      <div className="page narrow">
        <PageHead title="Receive stock" sub="The vendor's box has arrived? Start by tapping the colour that came." />
        {done && (
          <div className="callout ok" style={{ marginBottom: 12 }}>
            <Check size={16} />
            {done}
          </div>
        )}
        <div className="stack-sm">
          {products.map((p) => {
            const n = waiting.filter((i) => i.product_id === p.id).length
            return (
              <button key={p.id} className="choice" style={{ alignItems: 'center' }} disabled={n === 0} onClick={() => pick(p)}>
                <span className="swatch" style={{ width: 22, height: 22, borderRadius: 6, background: swatchColour(p.colour) }} />
                <div style={{ flex: 1 }}>
                  <div className="title">{p.name}</div>
                  <div className="hint">{n ? `${plural(n, 'item')} still with the vendor` : 'Nothing waiting — all arrived'}</div>
                </div>
                {n > 0 && <span className="badge badge-amber">{n}</span>}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ---------- step 2: tick what came
  const total = bySize.reduce((n, [, list]) => n + list.length, 0)
  const allIds = bySize.flatMap(([, list]) => list.map((i) => i.id))
  const allOn = allIds.length > 0 && allIds.every((id) => ticked.has(id))

  return (
    <div className="page narrow">
      <button className="btn btn-ghost" style={{ marginBottom: 8, paddingLeft: 4 }} onClick={() => setProductId(null)}>
        <ArrowLeft size={16} /> Choose another colour
      </button>
      <PageHead
        title={`Receive ${product.name}`}
        sub="Tick every item that is in the box. Use the size buttons if a whole size came."
      />

      {done && (
        <div className="callout ok" style={{ marginBottom: 12 }}>
          <Check size={16} />
          <div>
            {done} <Link to="/desk" style={{ textDecoration: 'underline' }}>Go to the handover desk</Link>
          </div>
        </div>
      )}

      {total === 0 && !q ? (
        <div className="card">
          <Empty icon={<Check size={20} />} title={`All ${product.colour} items have arrived`}>
            Nothing left with the vendor for this colour.
          </Empty>
        </div>
      ) : (
        <div className="stack">
          <div className="row">
            <div className="input-wrap" style={{ flex: 1, minWidth: 200 }}>
              <Search size={15} className="sm" />
              <input className="input input-sm-icon" placeholder="Find a back name or roll no." value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <button className="btn" onClick={() => toggle(allIds, !allOn)} disabled={!allIds.length}>
              {allOn ? 'Untick all' : `Everything came (${allIds.length})`}
            </button>
          </div>

          {bySize.map(([size, list]) => {
            const ids = list.map((i) => i.id)
            const on = ids.filter((id) => ticked.has(id)).length
            return (
              <div key={size} className="card">
                <div className="card-head">
                  <div className="row">
                    <span className="shirt-size" style={{ height: 34, minWidth: 40 }}>{size.length > 5 ? '…' : size}</span>
                    <div>
                      <div style={{ fontWeight: 600 }}>{size.length > 5 ? size : `Size ${size}`}</div>
                      <div className="hint">{on} of {list.length} ticked</div>
                    </div>
                  </div>
                  <button className={`btn btn-sm${on === list.length ? ' btn-outline-accent' : ''}`} onClick={() => toggle(ids, on !== list.length)}>
                    {on === list.length ? <><Check size={13} /> All {size} came</> : `All ${list.length} came`}
                  </button>
                </div>
                {list.map((i) => (
                  <label key={i.id} className={`shirt selectable${ticked.has(i.id) ? ' chosen' : ''}`}>
                    <input type="checkbox" checked={ticked.has(i.id)} onChange={(e) => toggle([i.id], e.target.checked)} />
                    <div className="body">
                      <div className="title">{i.print_name ?? <span className="subtle">No name on back</span>}</div>
                      <div className="hint">
                        <span className="mono">{i.buyer.roll_no}</span> · {i.buyer.name}
                        {i.batch && <> · {i.batch}</>}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )
          })}
          {total === 0 && <span className="hint">No item matches “{q}”.</span>}
        </div>
      )}

      {ticked.size > 0 && (
        <div className="bulk-bar">
          <span className="count">{plural(ticked.size, 'item')} ticked</span>
          <button className="btn btn-primary" onClick={() => setConfirm(true)}>
            <PackageOpen size={15} /> Mark as arrived
          </button>
        </div>
      )}

      {confirm && (
        <Modal
          title="Mark as arrived?"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
                <Check size={15} /> Yes, {plural(ticked.size, 'item')} arrived
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            {plural(ticked.size, `${product.colour} item`)} will show as <b>In MART</b>, and those students can collect them at the
            handover desk.
          </p>
          <span className="hint">Your name is saved with this change.</span>
        </Modal>
      )}
    </div>
  )
}
