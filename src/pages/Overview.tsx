import { ArrowRight, Copy, Flag, PackageCheck, Shirt, Truck, Warehouse } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDescribeCtx } from '../components/ItemDrawer'
import { useToast } from '../components/Toast'
import { PageHead, ProductLabel, Stat, STATUS_COLOR } from '../components/ui'
import { useAuth } from '../lib/auth'
import { copyText } from '../lib/csv'
import { describeEntry } from '../lib/describe'
import { buildExport, rollList } from '../lib/exports'
import { plural, timeAgo } from '../lib/format'
import { buildInventory } from '../lib/inventory'
import { useData } from '../lib/store'
import { STATUS_LABEL, STATUSES, type AuditEntry } from '../lib/types'

export default function Overview() {
  const { items, products, snapshot, campaign, buyersById } = useData()
  const { api } = useAuth()
  const toast = useToast()
  const ctx = useDescribeCtx()
  const [recent, setRecent] = useState<AuditEntry[] | null>(null)

  useEffect(() => {
    api.activity({ limit: 8 }).then(setRecent).catch(() => setRecent([]))
  }, [api, snapshot])

  const inv = useMemo(() => buildInventory(items, products, snapshot?.spare ?? []), [items, products, snapshot])
  const callList = useMemo(() => buildExport(items, 'call_list', {}), [items])
  const byStatus = STATUSES.map((s) => ({ s, n: items.filter((i) => i.status === s).length }))
  const total = items.length || 1
  const flags = (snapshot?.notes ?? []).filter((n) => n.is_flag && !n.resolved).slice(0, 6)

  return (
    <div className="page">
      <PageHead
        title="Overview"
        sub={campaign ? `${campaign.name} · ${plural(new Set(items.map((i) => i.buyer_id)).size, 'student')}` : 'No sales round yet'}
        actions={
          <>
            <button
              className="btn"
              disabled={callList.length === 0}
              onClick={async () => {
                await copyText(rollList(callList))
                toast.ok(`Copied ${plural(callList.length, 'roll number')} to call`)
              }}
            >
              <Copy size={15} /> Copy call list
            </button>
            <Link className="btn btn-primary" to="/desk">
              <PackageCheck size={15} /> Handover desk
            </Link>
          </>
        }
      />

      <div className="stack">
        <div className="stats">
          <Stat label="Items ordered" value={inv.total.ordered} icon={<Shirt size={14} />} sub={`${plural(products.length, 'product')}`} />
          <Stat label="With vendor" value={inv.total.withVendor} icon={<Truck size={14} />} sub="ordered or sent, not here yet" />
          <Stat label="On the shelf" value={inv.total.onShelf} icon={<Warehouse size={14} />} accent sub={`${inv.total.spare} spare`} />
          <Stat
            label="Handed over"
            value={inv.total.handedOver}
            icon={<PackageCheck size={14} />}
            sub={`${Math.round((inv.total.handedOver / total) * 100)}% of all items`}
          />
          <Stat label="Students to call" value={callList.length} icon={<Flag size={14} />} sub="all their items are in MART" />
        </div>

        <div className="card card-pad stack-sm">
          <div className="row between">
            <span className="label">Where every item is</span>
            <span className="hint">{plural(items.length, 'item')}</span>
          </div>
          <div className="progress" aria-hidden>
            {byStatus.map(({ s, n }) =>
              n ? <span key={s} style={{ width: `${(n / total) * 100}%`, background: STATUS_COLOR[s] }} /> : null,
            )}
          </div>
          <div className="legend">
            {byStatus.map(({ s, n }) => (
              <span key={s}>
                <i style={{ background: STATUS_COLOR[s] }} />
                {STATUS_LABEL[s]} <b className="num" style={{ color: 'var(--text)', fontWeight: 500 }}>{n}</b>
              </span>
            ))}
          </div>
        </div>

        <div className="grid-3">
          <div className="card">
            <div className="card-head">
              <h2>By product</h2>
              <Link to="/inventory" className="btn btn-ghost btn-sm">
                Inventory <ArrowRight size={14} />
              </Link>
            </div>
            <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="right">Ordered</th>
                    <th className="right hide-mobile">With vendor</th>
                    <th className="right">On shelf</th>
                    <th className="right">Handed over</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.rows.map((r) => (
                    <tr key={r.product.id}>
                      <td>
                        <span className="hide-mobile"><ProductLabel product={r.product} /></span>
                        <span className="show-mobile"><ProductLabel product={r.product} short /></span>
                      </td>
                      <td className="right num">{r.total.ordered}</td>
                      <td className="right num hide-mobile">{r.total.withVendor}</td>
                      <td className="right num">{r.total.onShelf}</td>
                      <td className="right num">{r.total.handedOver}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="stack">
            <div className="card">
              <div className="card-head">
                <h2>Open flags</h2>
                <span className="badge">{flags.length}</span>
              </div>
              <div className="card-body stack-sm">
                {flags.length === 0 && <span className="hint">No open flags.</span>}
                {flags.map((n) => {
                  const b = n.buyer_id ? buyersById.get(n.buyer_id) : undefined
                  return (
                    <div key={n.id} className="flag">
                      <Flag size={14} style={{ marginTop: 2 }} />
                      <div className="body">
                        {n.body}
                        {b && <div className="mono" style={{ fontSize: 12, opacity: 0.8 }}>{b.roll_no} · {b.name}</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>Recent activity</h2>
            <Link to="/activity" className="btn btn-ghost btn-sm">
              All activity <ArrowRight size={14} />
            </Link>
          </div>
          {recent?.length === 0 && <div className="card-body hint">Nothing yet.</div>}
          {recent?.map((e) => {
            const d = describeEntry(e, ctx)
            return (
              <div key={e.id} className="feed-item">
                <span className="avatar" style={{ width: 26, height: 26, fontSize: 10 }}>
                  {(e.actor_name ?? 'S').slice(0, 1).toUpperCase()}
                </span>
                <div className="body">
                  <b style={{ fontWeight: 500 }}>{e.actor_name ?? 'System'}</b> <span className="muted">{d.text}</span>
                </div>
                <span className="when">{timeAgo(e.at)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
