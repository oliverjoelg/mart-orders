import { Boxes } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { Empty, PageHead, ProductLabel, Segmented, Stat } from '../components/ui'
import { friendlyError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { compareSizes } from '../lib/import/normalize'
import { buildInventory, type GridCell } from '../lib/inventory'
import { can } from '../lib/permissions'
import { useData } from '../lib/store'

type Metric = keyof GridCell

const METRICS: { value: Metric; label: string; status?: string; hint: string }[] = [
  { value: 'ordered', label: 'Ordered', hint: 'Every item ordered, whatever its status.' },
  { value: 'withVendor', label: 'With vendor', hint: 'Ordered or sent to the vendor; not in MART yet.' },
  { value: 'arrived', label: 'Arrived', hint: 'Received from the vendor (on the shelf + handed over).' },
  { value: 'onShelf', label: 'On shelf', status: 'received', hint: 'In MART, waiting for the student.' },
  { value: 'handedOver', label: 'Handed over', status: 'handed_over', hint: 'Collected by the student or someone for them.' },
  { value: 'spare', label: 'Spare', hint: 'Extra stock not tied to any order. Ops and admins can edit these counts.' },
]

export default function Inventory() {
  const { items, products, snapshot, refresh } = useData()
  const { api, member } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [metric, setMetric] = useState<Metric>('onShelf')
  const inv = useMemo(() => buildInventory(items, products, snapshot?.spare ?? []), [items, products, snapshot])
  const sizes = useMemo(() => [...new Set(inv.rows.flatMap((r) => r.sizes))].sort(compareSizes), [inv])
  const m = METRICS.find((x) => x.value === metric)!
  const editSpare = metric === 'spare' && can(member?.role, 'spare')

  const colTotal = (s: string) => inv.rows.reduce((n, r) => n + (r.cells[s]?.[metric] ?? 0), 0)

  const open = (productId: string, size?: string) => {
    if (metric === 'spare') return
    const p = new URLSearchParams({ product: productId })
    if (size) p.set('size', size)
    if (m.status) p.set('status', m.status)
    if (metric === 'withVendor') p.set('status', 'sent_to_vendor')
    navigate(`/items?${p}`)
  }

  const saveSpare = async (productId: string, size: string, value: string, prev: number) => {
    const n = Math.max(0, Math.floor(Number(value) || 0))
    if (n === prev) return
    try {
      await api.setSpare(productId, size, n)
      await refresh()
      toast.ok('Spare stock updated')
    } catch (e) {
      toast.err(friendlyError(e))
    }
  }

  return (
    <div className="page">
      <PageHead title="Inventory" sub="Product × size. Click a number to see those items." />

      <div className="stack">
        <div className="stats">
          <Stat label="Ordered" value={inv.total.ordered} />
          <Stat label="With vendor" value={inv.total.withVendor} />
          <Stat label="On shelf" value={inv.total.onShelf} accent />
          <Stat label="Handed over" value={inv.total.handedOver} />
          <Stat label="Spare" value={inv.total.spare} />
        </div>

        <div className="row between">
          <Segmented label="Count" value={metric} options={METRICS.map((x) => ({ value: x.value, label: x.label }))} onChange={setMetric} />
          <span className="hint">{m.hint}</span>
        </div>

        {products.length === 0 ? (
          <div className="card">
            <Empty icon={<Boxes size={20} />} title="No products">Add products on the Products page.</Empty>
          </div>
        ) : (
          <div className="table-wrap inv-grid">
            <table className="table grid-table">
              <thead>
                <tr>
                  <th>Product</th>
                  {sizes.map((s) => (
                    <th key={s} className="cell" title={s}>
                      {s.length > 6 ? 'Custom' : s}
                    </th>
                  ))}
                  <th className="total">Total</th>
                </tr>
              </thead>
              <tbody>
                {inv.rows.map((r) => (
                  <tr key={r.product.id}>
                    <td className="nowrap">
                      <ProductLabel product={r.product} />
                    </td>
                    {sizes.map((s) => {
                      const c = r.cells[s]
                      if (!c) return <td key={s} className="cell zero">·</td>
                      const v = c[metric]
                      if (editSpare) {
                        return (
                          <td key={s} className="cell">
                            <input
                              className="cell-input num"
                              type="number"
                              min={0}
                              inputMode="numeric"
                              defaultValue={v}
                              aria-label={`Spare ${r.product.colour} ${s}`}
                              onBlur={(e) => void saveSpare(r.product.id, s, e.target.value, v)}
                              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                            />
                          </td>
                        )
                      }
                      return (
                        <td
                          key={s}
                          className={`cell${v === 0 ? ' zero' : ''}${metric !== 'spare' && v > 0 ? ' link' : ''}`}
                          onClick={() => v > 0 && open(r.product.id, s)}
                          title={`${r.product.colour} ${s}: ${v}`}
                        >
                          {v}
                        </td>
                      )
                    })}
                    <td className={`total${metric !== 'spare' ? ' link' : ''}`} style={{ cursor: metric === 'spare' ? 'default' : 'pointer' }} onClick={() => open(r.product.id)}>
                      {r.total[metric]}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  {sizes.map((s) => (
                    <td key={s} className="cell">{colTotal(s)}</td>
                  ))}
                  <td className="total">{inv.total[metric]}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* phones: one card per product, sizes listed top to bottom */}
        <div className="inv-cards">
          {inv.rows.map((r) => (
            <div key={r.product.id} className="card inv-card">
              <div className="card-head">
                <h3><ProductLabel product={r.product} /></h3>
                <span className="badge">{r.total[metric]} {m.label.toLowerCase()}</span>
              </div>
              {r.sizes
                .filter((s) => (r.cells[s]?.[metric] ?? 0) > 0 || editSpare)
                .map((s) => {
                  const v = r.cells[s]?.[metric] ?? 0
                  return (
                    <div key={s} className="size-row" onClick={() => v > 0 && open(r.product.id, s)}>
                      <span className="shirt-size" style={{ height: 32, minWidth: 40 }}>{s.length > 5 ? '…' : s}</span>
                      <span className="muted" style={{ flex: 1, marginLeft: 10 }}>{s.length > 5 ? s : ''}</span>
                      {editSpare ? (
                        <input
                          className="cell-input num"
                          type="number"
                          min={0}
                          inputMode="numeric"
                          defaultValue={v}
                          aria-label={`Spare ${r.product.colour} ${s}`}
                          onBlur={(e) => void saveSpare(r.product.id, s, e.target.value, v)}
                        />
                      ) : (
                        <b className="num" style={{ fontSize: 16 }}>{v}</b>
                      )}
                    </div>
                  )
                })}
              {!editSpare && r.total[metric] === 0 && <div className="size-row hint">None</div>}
            </div>
          ))}
        </div>

        {sizes.some((s) => s.length > 6) && (
          <span className="hint">“Custom” columns are sizes typed into the form (e.g. chest/length). Hover for the full text.</span>
        )}
      </div>
    </div>
  )
}
