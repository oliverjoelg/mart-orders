import { Copy, Download, Printer, Truck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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

export default function PrintList() {
  const { items, products, refresh } = useData()
  const { api, member } = useAuth()
  const toast = useToast()
  const [scope, setScope] = useState<Scope>('ordered')
  const [productId, setProductId] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  // ticked items; none ticked = the whole list
  const [picked, setPicked] = useState<Set<string>>(new Set())
  useEffect(() => {
    setPicked(new Set())
  }, [scope, productId])

  const list = useMemo(
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
            (a.batch ?? '').localeCompare(b.batch ?? '') ||
            (a.print_name ?? '~').localeCompare(b.print_name ?? '~'),
        ),
    [items, scope, productId],
  )

  const groups = useMemo(() => {
    const out: { product: ItemView['product']; sizes: { size: string; items: ItemView[] }[]; count: number }[] = []
    for (const i of list) {
      let g = out.find((x) => x.product.id === i.product_id)
      if (!g) out.push((g = { product: i.product, sizes: [], count: 0 }))
      let s = g.sizes.find((x) => x.size === i.size)
      if (!s) g.sizes.push((s = { size: i.size, items: [] }))
      s.items.push(i)
      g.count++
    }
    return out
  }, [list])

  const allSizes = useMemo(() => [...new Set(list.map((i) => i.size))].sort(compareSizes), [list])

  const target = picked.size ? list.filter((i) => picked.has(i.id)) : list
  const which = picked.size ? plural(target.length, 'ticked item') : plural(list.length, 'item')
  const toggle = (ids: string[], on: boolean) => {
    const n = new Set(picked)
    for (const id of ids) {
      if (on) n.add(id)
      else n.delete(id)
    }
    setPicked(n)
  }

  const targetGroups = useMemo(() => {
    const out: { product: ItemView['product']; sizes: { size: string; items: ItemView[] }[]; count: number }[] = []
    for (const i of target) {
      let g = out.find((x) => x.product.id === i.product_id)
      if (!g) out.push((g = { product: i.product, sizes: [], count: 0 }))
      let sz = g.sizes.find((x) => x.size === i.size)
      if (!sz) g.sizes.push((sz = { size: i.size, items: [] }))
      sz.items.push(i)
      g.count++
    }
    return out
  }, [target])

  const text = targetGroups
    .map(
      (g) =>
        `${g.product.name} — ${g.count}\n` +
        g.sizes
          .map((s) => `  ${s.size} (${s.items.length}): ${s.items.map((i) => `${i.print_name ?? '—'}${i.batch ? ` [${i.batch}]` : ''}`).join(', ')}`)
          .join('\n'),
    )
    .join('\n\n')

  const markSent = async () => {
    setBusy(true)
    try {
      const n = await api.setItemsStatus(
        target.filter((i) => i.status === 'ordered').map((i) => i.id),
        'sent_to_vendor',
      )
      toast.ok(`${plural(n, 'item')} marked as sent to the vendor`)
      setConfirm(false)
      setPicked(new Set())
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
        title="Vendor print list"
        sub="Per colour and size, with the names for the back. Send this to the vendor."
        actions={
          <>
            <button className="btn" disabled={!list.length} onClick={() => void copyText(text).then(() => toast.ok(`Copied ${which}`))}>
              <Copy size={15} /> Copy{picked.size ? ` ${picked.size}` : ''}
            </button>
            <button
              className="btn"
              disabled={!list.length}
              onClick={() =>
                downloadCsv(`mart-print-list-${fileStamp()}.csv`, [
                  ['Product', 'Colour', 'Size', 'Batch', 'Name on back', 'Roll number'],
                  ...target.map((i) => [i.product.name, i.product.colour, i.size, i.batch ?? '', i.print_name ?? '', i.buyer.roll_no]),
                ])
              }
            >
              <Download size={15} /> CSV{picked.size ? ` (${picked.size})` : ''}
            </button>
            <button className="btn hide-mobile" disabled={!list.length} onClick={() => window.print()}>
              <Printer size={15} /> Print{picked.size ? ` ${picked.size}` : ''}
            </button>
          </>
        }
      />

      <div className="toolbar">
        <Segmented label="Which items" value={scope} onChange={setScope} options={SCOPES} />
        <select className="select" value={productId} onChange={(e) => setProductId(e.target.value)} aria-label="Product">
          <option value="">All colours</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {scope === 'ordered' && can(member?.role, 'setStatus') && list.length > 0 && (
          <button className="btn btn-outline-accent" onClick={() => setConfirm(true)}>
            <Truck size={15} /> Mark {which} as sent
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <div className="card">
          <Empty icon={<Printer size={20} />} title="Nothing to print">
            {scope === 'ordered' ? 'Every ordered item has already been sent to the vendor.' : 'No items match.'}
          </Empty>
        </div>
      ) : (
        <div className="stack">
          <div className="callout no-print" style={{ alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              {picked.size ? (
                <>
                  <b>{plural(picked.size, 'item')} ticked.</b> Copy, CSV, Print and “Mark as sent” use only these.
                </>
              ) : (
                <>Everything below is included. To send only some orders, tick them (or tick a whole size).</>
              )}
            </div>
            {picked.size > 0 && (
              <button className="btn btn-sm" onClick={() => setPicked(new Set())}>Untick all</button>
            )}
          </div>

          <div className={`table-wrap hide-mobile${picked.size ? ' no-print' : ''}`}>
            <table className="table grid-table">
              <thead>
                <tr>
                  <th>Colour</th>
                  {allSizes.map((s) => (
                    <th key={s} className="cell" title={s}>{s.length > 6 ? 'Custom' : s}</th>
                  ))}
                  <th className="total">Total</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.product.id}>
                    <td className="nowrap"><ProductLabel product={g.product} /></td>
                    {allSizes.map((s) => {
                      const n = g.sizes.find((x) => x.size === s)?.items.length ?? 0
                      return <td key={s} className={`cell${n ? '' : ' zero'}`}>{n || '·'}</td>
                    })}
                    <td className="total">{g.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {groups.map((g) => (
            <div
              key={g.product.id}
              className={`card print-group${picked.size && !g.sizes.some((sz) => sz.items.some((i) => picked.has(i.id))) ? ' no-print' : ''}`}
            >
              <div className="card-head">
                <h3><ProductLabel product={g.product} /></h3>
                <span className="badge">{plural(g.count, 'item')}</span>
              </div>
              <div className="card-body stack">
                {g.sizes.map((s) => {
                  const ids = s.items.map((i) => i.id)
                  const on = ids.filter((id) => picked.has(id)).length
                  return (
                    <div key={s.size} className={`stack-sm${picked.size && !on ? ' no-print' : ''}`}>
                      <div className="row">
                        <label className="check no-print" title={`Tick all ${s.size}`}>
                          <input
                            type="checkbox"
                            checked={on === ids.length}
                            ref={(el) => {
                              if (el) el.indeterminate = on > 0 && on < ids.length
                            }}
                            onChange={(e) => toggle(ids, e.target.checked)}
                            aria-label={`Tick all ${g.product.colour} ${s.size}`}
                          />
                        </label>
                        <span className="shirt-size" style={{ height: 30, minWidth: 34 }}>{s.size.length > 5 ? '…' : s.size}</span>
                        <span className="muted">{s.size.length > 5 ? s.size : ''} {plural(s.items.length, 'item')}</span>
                      </div>
                      <div className="print-names">
                        {s.items.map((i) => (
                          <label key={i.id} className={`print-pick${picked.has(i.id) ? ' on' : ''}${picked.size && !picked.has(i.id) ? ' no-print' : ''}`}>
                            <input type="checkbox" className="no-print" checked={picked.has(i.id)} onChange={(e) => toggle([i.id], e.target.checked)} />
                            <b>{i.print_name ?? <span className="subtle">— no name —</span>}</b>
                            <span className="subtle">{i.batch}</span>
                            <span className="subtle mono no-print" style={{ fontSize: 11 }}>{i.buyer.roll_no}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
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
                Mark {plural(target.filter((i) => i.status === 'ordered').length, 'item')} sent
              </button>
            </>
          }
        >
          <p className="muted" style={{ margin: 0 }}>
            {picked.size ? `The ${which}` : `All ${which} on this list`} move from “Ordered” to “With vendor”. Each change is logged with your name.
          </p>
        </Modal>
      )}
    </div>
  )
}
