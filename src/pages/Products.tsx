import { DatabaseBackup, Lock, Plus, Unlock } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '../components/Toast'
import { Modal, PageHead, ProductLabel } from '../components/ui'
import { friendlyError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { inr } from '../lib/format'
import { downloadXlsx } from '../lib/import/readFile'
import { can, isSuperRole } from '../lib/permissions'
import { useData } from '../lib/store'
import type { Product } from '../lib/types'

const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

export default function Products() {
  const { products, campaigns, campaign, items, snapshot, refresh, setCampaignId } = useData()
  const { api, member } = useAuth()
  const toast = useToast()
  const [editing, setEditing] = useState<Partial<Product> | null>(null)
  const [newRound, setNewRound] = useState<string | null>(null)
  const admin = can(member?.role, 'editProducts')
  const superAdmin = isSuperRole(member?.role)

  const save = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn()
      toast.ok(ok)
      await refresh()
      return true
    } catch (e) {
      toast.err(friendlyError(e))
      return false
    }
  }

  return (
    <div className="page">
      <PageHead
        title="Products"
        sub={campaign ? `${campaign.name} · used to match the form's colour answers at import` : 'No sales round yet'}
        actions={
          admin && (
            <>
              <button className="btn" onClick={() => setNewRound('')}>New sales round</button>
              {campaign && (
                <button className="btn btn-primary" onClick={() => setEditing({ campaign_id: campaign.id, sizes: [], form_keywords: [] })}>
                  <Plus size={15} /> Add product
                </button>
              )}
            </>
          )
        }
      />

      <div className="stack">
        <div className="table-wrap cards-on-mobile">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="right">Price</th>
                <th>Sizes</th>
                <th>Matches form text</th>
                <th className="right">Items</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td><ProductLabel product={p} /></td>
                  <td className="right num">{inr(p.price_inr)}</td>
                  <td className="mono muted">{p.sizes.join(' ')}</td>
                  <td className="muted">{p.form_keywords.join(', ')}</td>
                  <td className="right num">{items.filter((i) => i.product_id === p.id).length}</td>
                  <td className="right">{admin && <button className="btn btn-sm" onClick={() => setEditing(p)}>Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="list-cards">
            {products.map((p) => (
              <div key={p.id} className="list-card" onClick={() => admin && setEditing(p)}>
                <div className="body">
                  <div className="row between">
                    <ProductLabel product={p} />
                    <span className="num">{inr(p.price_inr)}</span>
                  </div>
                  <div className="hint mono">{p.sizes.join(' ')}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {superAdmin && <BackupCard />}

        <div className="card">
          <div className="card-head"><h3>Sales rounds</h3></div>
          {campaigns.map((c) => (
            <div key={c.id} className="feed-item" style={{ alignItems: 'center' }}>
              <div className="body">
                <b style={{ fontWeight: 500 }}>{c.name}</b>{' '}
                {c.id === campaign?.id && <span className="badge badge-green">Showing</span>}{' '}
                {!c.is_active && <span className="badge">Closed</span>}{' '}
                {c.locked && <span className="badge badge-amber"><Lock size={11} /> Locked — only super admins see it</span>}
              </div>
              {c.id !== campaign?.id && <button className="btn btn-sm" onClick={() => setCampaignId(c.id)}>Show</button>}
              {admin && !c.locked && (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => void save(() => api.saveCampaign({ id: c.id, name: c.name, is_active: !c.is_active }), c.is_active ? 'Round closed' : 'Round reopened')}
                >
                  {c.is_active ? 'Close' : 'Reopen'}
                </button>
              )}
              {superAdmin && (
                <button
                  className={`btn btn-sm${c.locked ? ' btn-outline-accent' : ''}`}
                  onClick={() => {
                    if (!c.locked && !window.confirm(`Lock “${c.name}”?

Only super admins will see it, and nobody can change anything in it until you unlock it.`)) return
                    void save(() => api.setCampaignLocked(c.id, !c.locked), c.locked ? 'Round unlocked: everyone can see it again' : 'Round locked: hidden from everyone but super admins')
                  }}
                >
                  {c.locked ? <><Unlock size={13} /> Unlock</> : <><Lock size={13} /> Lock</>}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <ProductModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (p) => {
            if (await save(() => api.saveProduct(p), p.id ? 'Product updated' : 'Product added')) setEditing(null)
          }}
          orderCount={editing.id ? (snapshot?.items ?? []).filter((i) => i.product_id === editing.id).length : 0}
          onDelete={
            editing.id
              ? async () => {
                  if (await save(() => api.deleteProduct(editing.id!), 'Product deleted')) setEditing(null)
                }
              : undefined
          }
        />
      )}
      {newRound !== null && (
        <Modal
          title="New sales round"
          onClose={() => setNewRound(null)}
          footer={
            <>
              <button className="btn" onClick={() => setNewRound(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={!newRound.trim()}
                onClick={async () => {
                  if (await save(() => api.saveCampaign({ name: newRound.trim(), is_active: true }), 'Sales round created')) setNewRound(null)
                }}
              >
                Create
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="round">Name</label>
            <input id="round" className="input" autoFocus placeholder="e.g. Reopening round 2026" value={newRound} onChange={(e) => setNewRound(e.target.value)} />
            <span className="hint">Then add its products. Each round keeps its own items and stock.</span>
          </div>
        </Modal>
      )}
    </div>
  )
}

function ProductModal({
  initial,
  onClose,
  onSave,
  orderCount,
  onDelete,
}: {
  initial: Partial<Product>
  onClose(): void
  onSave(p: Partial<Product> & { campaign_id: string }): Promise<void>
  /** how many orders use this product (any round) */
  orderCount: number
  onDelete?(): Promise<void>
}) {
  const [p, setP] = useState({
    name: initial.name ?? '',
    colour: initial.colour ?? '',
    price: String(initial.price_inr ?? ''),
    sizes: (initial.sizes ?? ['XS', 'S', 'M', 'L', 'XL', 'XXL']).join(', '),
    keywords: (initial.form_keywords ?? []).join(', '),
    sort: String(initial.sort_order ?? 10),
  })
  const valid = p.name.trim() && p.colour.trim() && /^\d+$/.test(p.price.trim())
  return (
    <Modal
      title={initial.id ? 'Edit product' : 'Add product'}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button
              className="btn btn-danger"
              style={{ marginRight: 'auto' }}
              disabled={orderCount > 0}
              title={orderCount > 0 ? `${orderCount} orders use this product, so it can't be deleted. Close its sales round instead.` : undefined}
              onClick={() => {
                if (window.confirm(`Delete “${p.name}”? It has no orders, so nothing else changes.`)) void onDelete()
              }}
            >
              Delete
            </button>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!valid}
            onClick={() =>
              void onSave({
                id: initial.id,
                campaign_id: initial.campaign_id!,
                name: p.name.trim(),
                colour: p.colour.trim(),
                price_inr: Number(p.price),
                sizes: splitList(p.sizes).map((s) => s.toUpperCase()),
                form_keywords: splitList(p.keywords).map((s) => s.toLowerCase()),
                sort_order: Number(p.sort) || 0,
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      <div className="grid-2" style={{ gap: 10 }}>
        <div className="field">
          <label>Name</label>
          <input className="input" value={p.name} placeholder="Classic MDI Navy Blue" onChange={(e) => setP({ ...p, name: e.target.value })} />
        </div>
        <div className="field">
          <label>Colour</label>
          <input className="input" value={p.colour} placeholder="Navy Blue" onChange={(e) => setP({ ...p, colour: e.target.value })} />
        </div>
        <div className="field">
          <label>Price (₹)</label>
          <input className="input" inputMode="numeric" value={p.price} onChange={(e) => setP({ ...p, price: e.target.value })} />
        </div>
        <div className="field">
          <label>Order in lists</label>
          <input className="input" inputMode="numeric" value={p.sort} onChange={(e) => setP({ ...p, sort: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label>Sizes offered</label>
        <input className="input mono" value={p.sizes} onChange={(e) => setP({ ...p, sizes: e.target.value })} />
        <span className="hint">Comma-separated. Other sizes typed into the form are still imported, as custom sizes.</span>
      </div>
      <div className="field">
        <label>Words that identify it in the form</label>
        <input className="input" value={p.keywords} placeholder="navy, blue" onChange={(e) => setP({ ...p, keywords: e.target.value })} />
        <span className="hint">Matched against the form's colour answer, e.g. “Classic MDI Batch T-Shirt Blue (Rs 699/-)”.</span>
      </div>
    </Modal>
  )
}

/** Super admin: download every table (all rounds, change log included) as one Excel file. */
function BackupCard() {
  const { api } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const all = await api.exportAll()
      const sheets = Object.entries(all).map(([name, rows]) => {
        const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]
        const cell = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
        return { name, rows: [keys, ...rows.map((r) => keys.map((k) => cell(r[k])))] }
      })
      const stamp = new Date().toISOString().slice(0, 10)
      await downloadXlsx(`MART Orders backup ${stamp}.xlsx`, sheets)
      const total = Object.values(all).reduce((n, r) => n + r.length, 0)
      toast.ok(`Backup downloaded: ${total.toLocaleString('en-IN')} rows. Put it in the MART Google Drive.`)
    } catch (e) {
      toast.err(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card card-pad row between">
      <div style={{ maxWidth: 560 }}>
        <b style={{ fontWeight: 600 }}>Backup</b>
        <div className="hint">
          The free database has no automatic backups. Once a month, download everything (all rounds, students, the change log)
          and keep it in the MART Google Drive. It contains student contact details: never put it on GitHub or a personal drive.
        </div>
      </div>
      <button className="btn" disabled={busy} onClick={() => void run()}>
        <DatabaseBackup size={15} /> {busy ? 'Preparing…' : 'Download full backup'}
      </button>
    </div>
  )
}
