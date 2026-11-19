import { Plus, Trash2, UserCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { friendlyError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { plural } from '../lib/format'
import { normaliseBatch, normalisePrintName, normaliseRoll } from '../lib/import/normalize'
import { useData } from '../lib/store'
import type { Buyer } from '../lib/types'

interface Line {
  productId: string
  size: string
  printName: string
}

const blankLine = (productId = ''): Line => ({ productId, size: '', printName: '' })

/**
 * One order typed in by hand (an order that came outside the Google Form).
 * Saved through the same import_orders RPC as the CSV import, so it is atomic and logged.
 */
export default function ManualOrder() {
  const { products, campaign, snapshot, refresh } = useData()
  const { api } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [roll, setRoll] = useState('')
  const [buyer, setBuyer] = useState({ name: '', email: '', phone: '', batch: '', course: '', section: '' })
  const [lines, setLines] = useState<Line[]>([blankLine(products[0]?.id)])
  const [busy, setBusy] = useState(false)

  const rollNo = normaliseRoll(roll)
  const [found, setFound] = useState<Buyer | null>(null)
  useEffect(() => {
    setFound(null)
    if (rollNo.length < 4) return
    let live = true
    const t = setTimeout(() => {
      api.findBuyer(rollNo).then((b) => live && setFound(b)).catch(() => {})
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [api, rollNo])
  const existing = useMemo(() => snapshot?.buyers.find((b) => b.roll_no === rollNo) ?? found, [snapshot, rollNo, found])
  const existingItems = useMemo(
    () => (existing ? (snapshot?.items ?? []).filter((i) => i.buyer_id === existing.id && i.campaign_id === campaign?.id) : []),
    [existing, snapshot, campaign],
  )

  const fillFrom = () => {
    if (!existing) return
    setBuyer({
      name: existing.name ?? '',
      email: existing.email ?? '',
      phone: existing.phone ?? '',
      batch: existing.batch ?? '',
      course: existing.course ?? '',
      section: existing.section ?? '',
    })
  }

  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  const isDuplicate = (l: Line) =>
    existingItems.some(
      (it) =>
        it.product_id === l.productId &&
        it.size.toUpperCase() === l.size.trim().toUpperCase() &&
        (it.print_name ?? '').toUpperCase() === (normalisePrintName(l.printName) ?? '').toUpperCase(),
    )

  const valid =
    !!campaign && rollNo.length > 1 && buyer.name.trim().length > 1 && lines.length > 0 && lines.every((l) => l.productId && l.size.trim())

  const save = async () => {
    if (!campaign) return
    setBusy(true)
    try {
      const now = new Date().toISOString()
      const res = await api.importOrders({
        campaignId: campaign.id,
        fileName: 'Manual entry',
        responses: 1,
        duplicatesSkipped: 0,
        buyers: [
          {
            roll_no: rollNo,
            name: buyer.name.trim(),
            email: buyer.email.trim().toLowerCase() || null,
            phone: buyer.phone.trim() || null,
            batch: normaliseBatch(buyer.batch),
            course: buyer.course.trim() || null,
            section: buyer.section.trim() || null,
          },
        ],
        items: lines.map((l, i) => ({
          roll_no: rollNo,
          product_id: l.productId,
          size: l.size.trim().toUpperCase(),
          print_name: normalisePrintName(l.printName),
          batch: normaliseBatch(buyer.batch),
          source_timestamp: now,
          source_slot: i < 4 ? i + 1 : null,
        })),
      })
      toast.ok(`Added ${plural(res.items_created, 'item')} for ${buyer.name.trim()} (${rollNo})`)
      await refresh()
      navigate(`/items?q=${encodeURIComponent(rollNo)}`)
    } catch (e) {
      toast.err(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  if (!campaign) return <div className="callout warn">Create a sales round on the Products page first.</div>
  if (products.length === 0) return <div className="callout warn">Add products to “{campaign.name}” on the Products page first.</div>

  return (
    <div className="stack">
      <div className="callout">
        <div>
          For an order that didn't come through the Google Form. It is added to <b>{campaign.name}</b> and logged with your name.
        </div>
      </div>

      <div className="card card-pad stack">
        <span className="label">Student</span>
        <div className="grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="mo-roll">Roll number *</label>
            <input id="mo-roll" className="input mono" autoCapitalize="characters" value={roll} onChange={(e) => setRoll(e.target.value)} />
            {existing && (
              <button type="button" className="btn btn-sm btn-outline-accent" style={{ alignSelf: 'flex-start' }} onClick={fillFrom}>
                <UserCheck size={13} /> Known student: {existing.name} — fill in details
              </button>
            )}
          </div>
          <div className="field">
            <label htmlFor="mo-name">Name *</label>
            <input id="mo-name" className="input" value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="mo-email">MDI email</label>
            <input id="mo-email" className="input" type="email" value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="mo-phone">Phone</label>
            <input id="mo-phone" className="input" inputMode="tel" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="mo-batch">Batch</label>
            <input id="mo-batch" className="input" placeholder="PG'26" value={buyer.batch} onChange={(e) => setBuyer({ ...buyer, batch: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="mo-section">Section</label>
            <input id="mo-section" className="input" placeholder="Section A" value={buyer.section} onChange={(e) => setBuyer({ ...buyer, section: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="card card-pad stack">
        <span className="label">What they ordered</span>
        {lines.map((l, i) => {
          const product = products.find((p) => p.id === l.productId)
          return (
            <div key={i} className="stack-sm" style={{ paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
              <div className="grid-2" style={{ gap: 12 }}>
                <div className="field">
                  <label>Product *</label>
                  <select className="select" value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })}>
                    <option value="">Choose…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Size *</label>
                  <input
                    className="input mono"
                    list={`sizes-${i}`}
                    autoCapitalize="characters"
                    placeholder={product?.sizes.slice(0, 4).join(', ') ?? 'M'}
                    value={l.size}
                    onChange={(e) => setLine(i, { size: e.target.value })}
                  />
                  <datalist id={`sizes-${i}`}>
                    {(product?.sizes ?? []).map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
                <div className="field">
                  <label>Name on back</label>
                  <input className="input" placeholder="Leave empty for none" value={l.printName} onChange={(e) => setLine(i, { printName: e.target.value })} />
                </div>
                <div className="field" style={{ justifyContent: 'flex-end' }}>
                  {lines.length > 1 && (
                    <button type="button" className="btn btn-ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                      <Trash2 size={14} /> Remove this item
                    </button>
                  )}
                </div>
              </div>
              {l.productId && l.size.trim() && isDuplicate(l) && (
                <div className="callout warn">This student already has this exact item in {campaign.name}. Save only if it's a second one.</div>
              )}
              {product && l.size.trim() && product.sizes.length > 0 && !product.sizes.includes(l.size.trim().toUpperCase()) && (
                <span className="hint">“{l.size.trim()}” isn't one of this product's sizes; it will be saved as a custom size.</span>
              )}
            </div>
          )
        })}
        <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setLines([...lines, blankLine(lines[lines.length - 1]?.productId)])}>
          <Plus size={14} /> Add another item
        </button>
      </div>

      <div className="row">
        <button className="btn btn-primary btn-lg" disabled={!valid || busy} onClick={() => void save()}>
          Add {plural(lines.length, 'item')} for {buyer.name.trim() || 'this student'}
        </button>
        {!valid && <span className="hint">Roll number, name, and a product and size for every item are needed.</span>}
      </div>
    </div>
  )
}
