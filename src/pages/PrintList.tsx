import { Copy, Download, Printer, Search, Truck, X } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useToast } from '../components/Toast'
import { Empty, Modal, PageHead, ProductLabel, Segmented } from '../components/ui'
import { friendlyError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { copyText, downloadCsv, fileStamp } from '../lib/csv'
import { plural } from '../lib/format'
import { compareSizes } from '../lib/import/normalize'
import { can } from '../lib/permissions'
import { useData } from '../lib/store'
import type { ItemView } from '../lib/types'

type Scope = 'ordered' | 'with_vendor' | 'all'

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'ordered', label: 'Not yet sent' },
  { value: 'with_vendor', label: 'Sent to vendor' },
  { value: 'all', label: 'All items' },
]

interface Group {
  product: ItemView['product']
  sizes: { size: string; items: ItemView[] }[]
  count: number
}

function groupItems(list: ItemView[]): Group[] {
  const out: Group[] = []
  for (const i of list) {
    let g = out.find((x) => x.product.id === i.product_id)
    if (!g) out.push((g = { product: i.product, sizes: [], count: 0 }))
    let s = g.sizes.find((x) => x.size === i.size)
    if (!s) g.sizes.push((s = { size: i.size, items: [] }))
    s.items.push(i)
    g.count++
  }
  return out
}

/** Text the vendor gets when you press Copy. */
function vendorText(groups: Group[]): string {
  return groups
    .map(
      (g) =>
        `${g.product.name} — ${g.count}\n` +
        g.sizes
          .map((s) => `  ${s.size} (${s.items.length}): ${s.items.map((i) => `${i.print_name ?? '—'}${i.batch ? ` [${i.batch}]` : ''}`).join(', ')}`)
          .join('\n'),
    )
    .join('\n\n')
}

export default function PrintList() {
  const { items, products, refreshItems } = useData()
  const { api, member } = useAuth()
  const toast = useToast()
  const [scope, setScope] = useState<Scope>('ordered')
  const [productId, setProductId] = useState('')
  const [size, setSize] = useState('')
  const [q, setQ] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  // ticked items; none ticked = everything shown
  const [picked, setPicked] = useState<Set<string>>(new Set())
  useEffect(() => {
    setPicked(new Set())
  }, [scope, productId])

  const inScope = useMemo(
    () =>
      items
        .filter(
          (i) =>
            (scope === 'all' || (scope === 'ordered' ? i.status === 'ordered' : i.status === 'sent_to_vendor')) &&
            (!productId || i.product_id === productId),
        )
        .sort(
          (a, b) =>
            a.product.sort_order - b.product.sort_order ||
            compareSizes(a.size, b.size) ||
            (a.print_name ?? '~').localeCompare(b.print_name ?? '~') ||
            a.buyer.roll_no.localeCompare(b.buyer.roll_no),
        ),
    [items, scope, productId],
  )
  const sizes = useMemo(() => [...new Set(inScope.map((i) => i.size))].sort(compareSizes), [inScope])

  // what the table shows (size + search narrow it down)
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return inScope.filter(
      (i) =>
        (!size || i.size === size) &&
        (!term ||
          (i.print_name ?? '').toLowerCase().includes(term) ||
          i.buyer.roll_no.toLowerCase().includes(term) ||
          i.buyer.name.toLowerCase().includes(term)),
    )
  }, [inScope, size, q])

  const groups = useMemo(() => groupItems(shown), [shown])
  const target = picked.size ? inScope.filter((i) => picked.has(i.id)) : shown
  const targetGroups = useMemo(() => groupItems(target), [target])
  const which = picked.size ? plural(target.length, 'ticked item') : plural(shown.length, 'item')
  const toSend = target.filter((i) => i.status === 'ordered')
  const allShownTicked = shown.length > 0 && shown.every((i) => picked.has(i.id))

  const toggle = (ids: string[], on: boolean) => {
    const n = new Set(picked)
    for (const id of ids) {
      if (on) n.add(id)
      else n.delete(id)
    }
    setPicked(n)
  }

  const copy = () => void copyText(vendorText(targetGroups)).then(() => toast.ok(`Copied ${which}`))
  const csv = () =>
    downloadCsv(`mart-print-list-${fileStamp()}.csv`, [
      ['Product', 'Colour', 'Size', 'Name on back', 'Batch', 'Roll number'],
      ...target.map((i) => [i.product.name, i.product.colour, i.size, i.print_name ?? '', i.batch ?? '', i.buyer.roll_no]),
    ])

  const markSent = async () => {
    setBusy(true)
    try {
      const ids = toSend.map((i) => i.id)
      const n = await api.setItemsStatus(ids, 'sent_to_vendor')
      toast.ok(`${plural(n, 'item')} marked as sent to the vendor`)
      setConfirm(false)
      setPicked(new Set())
      await refreshItems(ids)
    } catch (e) {
      toast.err(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const canSend = scope !== 'with_vendor' && can(member?.role, 'setStatus') && toSend.length > 0

  return (
    <div className={`page${picked.size ? ' printing-picked' : ''}`}>
      <PageHead
        title="Vendor print list"
        sub="What to send the vendor: each colour and size, with the names for the back."
        actions={
          <>
            <button className="btn" disabled={!target.length} onClick={copy}>
              <Copy size={15} /> Copy
            </button>
            <button className="btn" disabled={!target.length} onClick={csv}>
              <Download size={15} /> CSV
            </button>
            <button className="btn hide-mobile" disabled={!target.length} onClick={() => window.print()}>
              <Printer size={15} /> Print
            </button>
          </>
        }
      />

      <div className="toolbar">
        <Segmented label="Which items" value={scope} onChange={setScope} options={SCOPES} />
      </div>
      <div className="toolbar">
        <select className="select" value={productId} onChange={(e) => setProductId(e.target.value)} aria-label="Colour">
          <option value="">All colours</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select className="select" value={size} onChange={(e) => setSize(e.target.value)} aria-label="Size">
          <option value="">All sizes</option>
          {sizes.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <div className="input-wrap grow">
          <Search size={15} className="sm" />
          <input className="input input-sm-icon" placeholder="Find a back name or roll no." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {inScope.length === 0 ? (
        <div className="card">
          <Empty icon={<Printer size={20} />} title="Nothing to print">
            {scope === 'ordered' ? 'Every ordered item has already been sent to the vendor.' : 'No items match.'}
          </Empty>
        </div>
      ) : (
        <div className="stack">
          {/* totals the vendor needs first */}
          <div className="table-wrap hide-mobile print-totals">
            <table className="table grid-table">
              <thead>
                <tr>
                  <th>Colour</th>
                  {sizes.map((s) => (
                    <th key={s} className="cell" title={s}>{s.length > 6 ? 'Custom' : s}</th>
                  ))}
                  <th className="total">Total</th>
                </tr>
              </thead>
              <tbody>
                {groupItems(target).map((g) => (
                  <tr key={g.product.id}>
                    <td className="nowrap"><ProductLabel product={g.product} /></td>
                    {sizes.map((s) => {
                      const n = g.sizes.find((x) => x.size === s)?.items.length ?? 0
                      return <td key={s} className={`cell${n ? '' : ' zero'}`}>{n || '·'}</td>
                    })}
                    <td className="total">{g.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row between no-print">
            <span className="muted">
              {picked.size
                ? `${plural(picked.size, 'item')} ticked — Copy, CSV, Print and “Mark as sent” use only these.`
                : `Showing ${plural(shown.length, 'item')}. Nothing ticked = everything shown is included.`}
            </span>
            {shown.length > 0 && (
              <button className="btn btn-sm" onClick={() => toggle(shown.map((i) => i.id), !allShownTicked)}>
                {allShownTicked ? 'Untick all shown' : `Tick all shown (${shown.length})`}
              </button>
            )}
          </div>

          {shown.length === 0 && <span className="hint">No item matches “{q}”.</span>}

          {groups.map((g) => (
            <div key={g.product.id} className={`card print-group${picked.size && !g.sizes.some((s) => s.items.some((i) => picked.has(i.id))) ? ' no-print' : ''}`}>
              <div className="card-head">
                <h3><ProductLabel product={g.product} /></h3>
                <span className="badge">{plural(g.count, 'item')}</span>
              </div>
              <div className="table-wrap print-table" style={{ border: 0, borderRadius: 0 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th className="check-col no-print" />
                      <th style={{ width: 70 }}>Size</th>
                      <th>Name on back</th>
                      <th style={{ width: 90 }}>Batch</th>
                      <th className="no-print hide-mobile">Roll no.</th>
                      <th className="no-print hide-mobile">Student</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.sizes.map((s) => {
                      const ids = s.items.map((i) => i.id)
                      const on = ids.filter((id) => picked.has(id)).length
                      return (
                        <Fragment key={s.size}>
                          <tr className={`size-row-head${picked.size && !on ? ' no-print' : ''}`}>
                            <td className="check-col no-print">
                              <input
                                type="checkbox"
                                checked={on === ids.length}
                                ref={(el) => {
                                  if (el) el.indeterminate = on > 0 && on < ids.length
                                }}
                                onChange={(e) => toggle(ids, e.target.checked)}
                                aria-label={`Tick all ${g.product.colour} ${s.size}`}
                              />
                            </td>
                            <td colSpan={5}>
                              <b>{s.size}</b> <span className="muted">· {plural(s.items.length, 'item')}</span>
                            </td>
                          </tr>
                          {s.items.map((i) => (
                            <tr
                              key={i.id}
                              className={`clickable${picked.has(i.id) ? ' selected' : ''}${picked.size && !picked.has(i.id) ? ' no-print' : ''}`}
                              onClick={() => toggle([i.id], !picked.has(i.id))}
                            >
                              <td className="check-col no-print">
                                <input type="checkbox" checked={picked.has(i.id)} readOnly aria-label={`Tick ${i.print_name ?? 'no name'} ${i.buyer.roll_no}`} />
                              </td>
                              <td className="mono">{i.size}</td>
                              <td style={{ fontWeight: 500 }}>{i.print_name ?? <span className="subtle">— no name —</span>}</td>
                              <td className="nowrap">{i.batch ?? '—'}</td>
                              <td className="mono muted no-print hide-mobile">{i.buyer.roll_no}</td>
                              <td className="muted no-print hide-mobile">{i.buyer.name}</td>
                            </tr>
                          ))}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {(picked.size > 0 || canSend) && (
        <div className="bulk-bar no-print">
          <span className="count">{picked.size ? plural(picked.size, 'item') + ' ticked' : `All ${plural(shown.length, 'item')} shown`}</span>
          <button className="btn btn-sm" onClick={copy}>
            <Copy size={14} /> Copy
          </button>
          <button className="btn btn-sm" onClick={csv}>
            <Download size={14} /> CSV
          </button>
          <button className="btn btn-sm hide-mobile" onClick={() => window.print()}>
            <Printer size={14} /> Print
          </button>
          {canSend && (
            <button className="btn btn-sm btn-primary" onClick={() => setConfirm(true)}>
              <Truck size={14} /> Mark {toSend.length} as sent
            </button>
          )}
          {picked.size > 0 && (
            <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setPicked(new Set())} aria-label="Untick all">
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {confirm && (
        <Modal
          title="Mark as sent to the vendor"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void markSent()}>
                Mark {plural(toSend.length, 'item')} sent
              </button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            {plural(toSend.length, 'item')} {picked.size ? '(the ticked ones)' : '(everything shown)'} move from “Ordered” to “With vendor”.
            Each change is logged with your name.
          </p>
        </Modal>
      )}
    </div>
  )
}
