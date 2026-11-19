import { Search, Shirt, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ItemDrawer } from '../components/ItemDrawer'
import { useToast } from '../components/Toast'
import { Empty, PageHead, ProductLabel, StatusBadge } from '../components/ui'
import { friendlyError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { downloadCsv, fileStamp } from '../lib/csv'
import { timeAgo, plural } from '../lib/format'
import { compareSizes } from '../lib/import/normalize'
import { can } from '../lib/permissions'
import { useData } from '../lib/store'
import { STATUS_LABEL, STATUSES, type ItemStatus } from '../lib/types'

const PAGE = 100

export default function Items() {
  const { items, products, refresh } = useData()
  const { api, member } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [busy, setBusy] = useState(false)
  const role = member?.role

  const f = {
    q: params.get('q') ?? '',
    product: params.get('product') ?? '',
    size: params.get('size') ?? '',
    status: params.get('status') ?? '',
    batch: params.get('batch') ?? '',
    section: params.get('section') ?? '',
  }
  const set = (k: keyof typeof f, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
    setLimit(PAGE)
  }

  const sizes = useMemo(() => [...new Set(items.map((i) => i.size))].sort(compareSizes), [items])
  const batches = useMemo(() => [...new Set(items.map((i) => i.batch ?? i.buyer.batch).filter(Boolean) as string[])].sort(), [items])
  const sections = useMemo(() => [...new Set(items.map((i) => i.buyer.section).filter(Boolean) as string[])].sort(), [items])

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    const qRoll = q.toUpperCase().replace(/\s+/g, '')
    return items
      .filter(
        (i) =>
          (!q ||
            i.buyer.roll_no.includes(qRoll) ||
            i.buyer.name.toLowerCase().includes(q) ||
            (i.print_name ?? '').toLowerCase().includes(q)) &&
          (!f.product || i.product_id === f.product) &&
          (!f.size || i.size === f.size) &&
          (!f.status || i.status === f.status) &&
          (!f.batch || (i.batch ?? i.buyer.batch) === f.batch) &&
          (!f.section || i.buyer.section === f.section),
      )
      .sort(
        (a, b) =>
          a.buyer.roll_no.localeCompare(b.buyer.roll_no) ||
          a.product.sort_order - b.product.sort_order ||
          compareSizes(a.size, b.size),
      )
  }, [items, f.q, f.product, f.size, f.status, f.batch, f.section])

  const shown = filtered.slice(0, limit)
  const allSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.id))
  const anyFilter = Object.values(f).some(Boolean)
  const close = useCallback(() => setOpenId(null), [])

  const toggle = (id: string) => {
    const n = new Set(selected)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setSelected(n)
  }

  const bulk = async (status: Exclude<ItemStatus, 'handed_over'>) => {
    const ids = filtered.filter((i) => selected.has(i.id) && i.status !== 'handed_over').map((i) => i.id)
    const skipped = selected.size - ids.length
    setBusy(true)
    try {
      const n = await api.setItemsStatus(ids, status)
      toast.ok(`${plural(n, 'shirt')} marked ${STATUS_LABEL[status]}${skipped ? ` · ${skipped} already handed over, left as is` : ''}`)
      setSelected(new Set())
      await refresh()
    } catch (e) {
      toast.err(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <PageHead
        title="Shirts"
        sub={`${plural(filtered.length, 'shirt')}${anyFilter ? ` of ${items.length}` : ''} · one row per shirt`}
        actions={
          <button
            className="btn"
            onClick={() =>
              downloadCsv(`mart-shirts-${fileStamp()}.csv`, [
                ['Roll number', 'Name', 'Product', 'Size', 'Back print', 'Batch', 'Section', 'Status'],
                ...filtered.map((i) => [
                  i.buyer.roll_no,
                  i.buyer.name,
                  i.product.name,
                  i.size,
                  i.print_name ?? '',
                  i.batch ?? '',
                  i.buyer.section ?? '',
                  STATUS_LABEL[i.status],
                ]),
              ])
            }
          >
            Download CSV
          </button>
        }
      />

      <div className="toolbar">
        <div className="input-wrap grow">
          <Search size={15} className="sm" />
          <input
            className="input input-sm-icon"
            placeholder="Roll no., name or back print"
            value={f.q}
            onChange={(e) => set('q', e.target.value)}
            aria-label="Search shirts"
          />
        </div>
        <select className="select" value={f.product} onChange={(e) => set('product', e.target.value)} aria-label="Product">
          <option value="">All products</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select className="select" value={f.size} onChange={(e) => set('size', e.target.value)} aria-label="Size">
          <option value="">All sizes</option>
          {sizes.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className="select" value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select className="select hide-mobile" value={f.batch} onChange={(e) => set('batch', e.target.value)} aria-label="Batch">
          <option value="">All batches</option>
          {batches.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className="select hide-mobile" value={f.section} onChange={(e) => set('section', e.target.value)} aria-label="Section">
          <option value="">All sections</option>
          {sections.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {anyFilter && (
          <button className="btn btn-ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            <X size={14} /> Clear
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <Empty icon={<Shirt size={20} />} title={items.length ? 'No shirts match' : 'No shirts yet'}>
            {items.length ? 'Try fewer filters.' : 'Import the Google Form responses to get started.'}
          </Empty>
        </div>
      ) : (
        <div className="table-wrap cards-on-mobile">
          <table className="table">
            <thead>
              <tr>
                {can(role, 'setStatus') && (
                  <th className="check-col">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((i) => i.id)))}
                      aria-label="Select all matching shirts"
                    />
                  </th>
                )}
                <th>Roll no.</th>
                <th>Name</th>
                <th>Product</th>
                <th>Size</th>
                <th>Back print</th>
                <th>Batch</th>
                <th>Status</th>
                <th className="right">Updated</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} className={`clickable${selected.has(i.id) ? ' selected' : ''}`} onClick={() => setOpenId(i.id)}>
                  {can(role, 'setStatus') && (
                    <td className="check-col" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} aria-label={`Select ${i.buyer.roll_no} ${i.size}`} />
                    </td>
                  )}
                  <td className="mono nowrap">{i.buyer.roll_no}</td>
                  <td className="nowrap">{i.buyer.name}</td>
                  <td>
                    <ProductLabel product={i.product} />
                  </td>
                  <td className="mono">{i.size}</td>
                  <td>{i.print_name ?? <span className="subtle">—</span>}</td>
                  <td className="nowrap">{i.batch ?? '—'}</td>
                  <td>
                    <StatusBadge status={i.status} />
                  </td>
                  <td className="right subtle nowrap">{timeAgo(i.status_changed_at ?? i.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="list-cards">
            {shown.map((i) => (
              <div key={i.id} className="list-card" onClick={() => setOpenId(i.id)}>
                {can(role, 'setStatus') && (
                  <input
                    type="checkbox"
                    style={{ marginTop: 3 }}
                    checked={selected.has(i.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggle(i.id)}
                    aria-label={`Select ${i.buyer.roll_no} ${i.size}`}
                  />
                )}
                <div className="body">
                  <div className="row between" style={{ flexWrap: 'nowrap' }}>
                    <span className="title">{i.buyer.name || i.buyer.roll_no}</span>
                    <StatusBadge status={i.status} />
                  </div>
                  <div className="row hint" style={{ gap: 6 }}>
                    <span className="mono">{i.buyer.roll_no}</span>·<ProductLabel product={i.product} short />
                    <b className="mono" style={{ color: 'var(--text)' }}>{i.size}</b>
                    {i.print_name && <>· “{i.print_name}”</>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {filtered.length > limit && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn" onClick={() => setLimit(limit + PAGE * 3)}>
            Show more ({filtered.length - limit} left)
          </button>
        </div>
      )}

      {selected.size > 0 && can(role, 'setStatus') && (
        <div className="bulk-bar">
          <span className="count">{plural(selected.size, 'shirt')} selected</span>
          <button className="btn btn-sm" disabled={busy} onClick={() => void bulk('sent_to_vendor')}>
            With vendor
          </button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void bulk('received')}>
            In MART
          </button>
          <button className="btn btn-sm" disabled={busy} onClick={() => void bulk('ordered')}>
            Ordered
          </button>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setSelected(new Set())} aria-label="Clear selection">
            <X size={14} />
          </button>
        </div>
      )}

      {openId && <ItemDrawer itemId={openId} onClose={close} />}
    </div>
  )
}
