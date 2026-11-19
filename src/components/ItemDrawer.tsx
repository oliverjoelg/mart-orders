import { Flag, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { friendlyError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { describeEntry, type DescribeCtx } from '../lib/describe'
import { formatDateTime } from '../lib/format'
import { can } from '../lib/permissions'
import { useData } from '../lib/store'
import { STATUS_LABEL, type AuditEntry, type ItemStatus, type ItemView } from '../lib/types'
import { useToast } from './Toast'
import { Drawer, Modal, ProductLabel, Spinner, StatusBadge } from './ui'

const SETTABLE: Exclude<ItemStatus, 'handed_over'>[] = ['ordered', 'sent_to_vendor', 'received']

export function useDescribeCtx(): DescribeCtx {
  const { productsById, buyersById, snapshot } = useData()
  return useMemo(() => {
    const items = new Map((snapshot?.items ?? []).map((i) => [i.id, i]))
    return { productsById, buyersById, itemLookup: (id: string) => items.get(id) }
  }, [productsById, buyersById, snapshot])
}

export function UndoHandoverModal({ item, onClose, onDone }: { item: ItemView; onClose(): void; onDone(): void }) {
  const { api } = useAuth()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await api.undoHandover(item.id, reason)
      toast.ok('Handover undone. The item is back on the shelf.')
      onDone()
    } catch (e) {
      toast.err(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Undo handover"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" disabled={!reason.trim() || busy} onClick={() => void submit()}>
            Undo handover
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        {item.product.colour} {item.size} for {item.buyer.name} ({item.buyer.roll_no}) goes back to “In MART”. The reason is kept in
        the activity log.
      </p>
      <div className="field">
        <label htmlFor="undo-reason">Reason</label>
        <input id="undo-reason" className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Handed to the wrong student" />
      </div>
    </Modal>
  )
}

/** Looks the item up live, so the drawer updates after each change (and closes if it was deleted). */
export function ItemDrawer({ itemId, onClose }: { itemId: string; onClose(): void }) {
  const { items } = useData()
  const item = items.find((i) => i.id === itemId)
  useEffect(() => {
    if (!item) onClose()
  }, [item, onClose])
  return item ? <ItemDrawerInner key={item.id} item={item} onClose={onClose} /> : null
}

function ItemDrawerInner({ item, onClose }: { item: ItemView; onClose(): void }) {
  const { api, member } = useAuth()
  const { refresh, memberName, products, snapshot } = useData()
  const toast = useToast()
  const ctx = useDescribeCtx()
  const role = member?.role
  const [history, setHistory] = useState<AuditEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [undo, setUndo] = useState(false)
  const [edit, setEdit] = useState({ size: item.size, print_name: item.print_name ?? '', batch: item.batch ?? '', product_id: item.product_id })
  const [note, setNote] = useState('')
  const notes = (snapshot?.notes ?? []).filter((n) => n.item_id === item.id)

  useEffect(() => {
    let live = true
    api.itemHistory(item.id).then((h) => live && setHistory(h)).catch(() => live && setHistory([]))
    return () => {
      live = false
    }
  }, [api, item.id, item.status, item.size, item.print_name])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast.ok(ok)
      await refresh()
    } catch (e) {
      toast.err(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const dirty =
    edit.size !== item.size ||
    edit.print_name !== (item.print_name ?? '') ||
    edit.batch !== (item.batch ?? '') ||
    edit.product_id !== item.product_id

  return (
    <Drawer
      title={<>{item.product.colour} {item.size} · <span className="mono">{item.buyer.roll_no}</span></>}
      onClose={onClose}
      footer={
        can(role, 'delete') ? (
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete this item (${item.product.colour} ${item.size}, ${item.buyer.roll_no})? The activity log keeps a copy.`)) {
                void run(() => api.deleteItem(item.id), 'Item deleted').then(onClose)
              }
            }}
          >
            <Trash2 size={14} /> Delete item
          </button>
        ) : undefined
      }
    >
      <dl className="dl">
        <dt>Student</dt>
        <dd>
          {item.buyer.name} <span className="mono muted">{item.buyer.roll_no}</span>
        </dd>
        <dt>Contact</dt>
        <dd className="muted">{[item.buyer.email, item.buyer.phone].filter(Boolean).join(' · ') || '—'}</dd>
        <dt>Section</dt>
        <dd>{[item.buyer.course, item.buyer.section].filter(Boolean).join(' · ') || '—'}</dd>
        <dt>Product</dt>
        <dd>
          <ProductLabel product={item.product} />
        </dd>
        <dt>Back print</dt>
        <dd>{item.print_name ?? <span className="subtle">No name</span>}</dd>
        <dt>Batch</dt>
        <dd>{item.batch ?? '—'}</dd>
        <dt>Status</dt>
        <dd>
          <StatusBadge status={item.status} />
        </dd>
        {item.handover && (
          <>
            <dt>Handed over</dt>
            <dd>
              {formatDateTime(item.handover.handed_at)} by {memberName(item.handover.handed_by)}
              <div className="muted">
                {item.handover.type === 'self'
                  ? 'To the student'
                  : `Collected by ${item.handover.collector_name} (${item.handover.collector_roll})`}
              </div>
            </dd>
          </>
        )}
        <dt>Ordered</dt>
        <dd>{formatDateTime(item.source_timestamp)} {item.source_slot ? <span className="subtle">· item {item.source_slot} on the form</span> : null}</dd>
      </dl>

      {can(role, 'setStatus') && item.status !== 'handed_over' && (
        <div className="field">
          <span className="label">Change status</span>
          <div className="row">
            {SETTABLE.map((s) => (
              <button
                key={s}
                className={`btn btn-sm${s === item.status ? ' btn-outline-accent' : ''}`}
                disabled={busy || s === item.status}
                onClick={() => void run(() => api.setItemsStatus([item.id], s), `Marked ${STATUS_LABEL[s]}`)}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          <span className="hint">Hand items over from the Handover desk.</span>
        </div>
      )}
      {item.status === 'handed_over' && can(role, 'undoHandover') && (
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setUndo(true)}>
          <Undo2 size={14} /> Undo handover
        </button>
      )}

      {can(role, 'editItem') && (
        <details className="disclosure">
          <summary>Edit item details</summary>
          <div className="stack-sm" style={{ marginTop: 12 }}>
            <div className="grid-2" style={{ gap: 10 }}>
              <div className="field">
                <label>Product</label>
                <select className="select" value={edit.product_id} onChange={(e) => setEdit({ ...edit, product_id: e.target.value })}>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Size</label>
                <input className="input" value={edit.size} onChange={(e) => setEdit({ ...edit, size: e.target.value })} />
              </div>
              <div className="field">
                <label>Back print</label>
                <input className="input" value={edit.print_name} placeholder="No name" onChange={(e) => setEdit({ ...edit, print_name: e.target.value })} />
              </div>
              <div className="field">
                <label>Batch</label>
                <input className="input" value={edit.batch} onChange={(e) => setEdit({ ...edit, batch: e.target.value })} />
              </div>
            </div>
            <button
              className="btn btn-primary"
              style={{ alignSelf: 'flex-start' }}
              disabled={!dirty || busy || !edit.size.trim()}
              onClick={() =>
                void run(
                  () =>
                    api.updateItem(item.id, {
                      size: edit.size.trim(),
                      print_name: edit.print_name.trim() || null,
                      batch: edit.batch.trim() || null,
                      product_id: edit.product_id,
                    }),
                  'Item updated',
                )
              }
            >
              Save changes
            </button>
          </div>
        </details>
      )}

      <div className="stack-sm">
        <span className="label">Notes</span>
        {notes.map((n) => (
          <div key={n.id} className={`flag${n.resolved ? ' done' : ''}`}>
            <Flag size={14} style={{ marginTop: 2 }} />
            <div className="body">{n.body}</div>
          </div>
        ))}
        {can(role, 'notes') && (
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input" value={note} placeholder="Add a note about this item" onChange={(e) => setNote(e.target.value)} />
            <button
              className="btn"
              disabled={!note.trim() || busy}
              onClick={() =>
                void run(() => api.addNote({ item_id: item.id, buyer_id: item.buyer_id, body: note.trim(), is_flag: true }), 'Note added').then(() =>
                  setNote(''),
                )
              }
            >
              Add
            </button>
          </div>
        )}
      </div>

      <div className="stack-sm">
        <span className="label">History</span>
        {history === null ? (
          <Spinner />
        ) : history.length === 0 ? (
          <span className="hint">No changes recorded yet.</span>
        ) : (
          <ol className="timeline">
            {history.map((h) => {
              const d = describeEntry(h, ctx)
              return (
                <li key={h.id} className={d.tone}>
                  <div>
                    <b style={{ fontWeight: 500 }}>{h.actor_name ?? 'System'}</b> {d.text}
                  </div>
                  <div className="hint">{formatDateTime(h.at)}</div>
                </li>
              )
            })}
          </ol>
        )}
      </div>

      {undo && (
        <UndoHandoverModal
          item={item}
          onClose={() => setUndo(false)}
          onDone={() => {
            setUndo(false)
            void refresh()
          }}
        />
      )}
    </Drawer>
  )
}
