import { Check, ChevronRight, Flag, PackageCheck, Search, UserRound, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { UndoHandoverModal } from '../components/ItemDrawer'
import { useToast } from '../components/Toast'
import { Avatar, Empty, Modal, PageHead, ProductLabel, StatusBadge } from '../components/ui'
import { friendlyError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatDateTime, plural } from '../lib/format'
import { compareSizes } from '../lib/import/normalize'
import { can } from '../lib/permissions'
import { useData } from '../lib/store'
import type { Buyer, ItemView } from '../lib/types'

interface Student {
  buyer: Buyer
  items: ItemView[]
  ready: number
  pending: number
  done: number
}

const norm = (s: string) => s.toUpperCase().replace(/\s+/g, '')

export default function Handover() {
  const { items, notesByBuyer, memberName, refresh } = useData()
  const { api, member } = useAuth()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [buyerId, setBuyerId] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [undoItem, setUndoItem] = useState<ItemView | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const role = member?.role

  const students = useMemo(() => {
    const map = new Map<string, Student>()
    for (const i of items) {
      const s = map.get(i.buyer_id) ?? { buyer: i.buyer, items: [], ready: 0, pending: 0, done: 0 }
      s.items.push(i)
      if (i.status === 'received') s.ready++
      else if (i.status === 'handed_over') s.done++
      else s.pending++
      map.set(i.buyer_id, s)
    }
    return map
  }, [items])

  const results = useMemo(() => {
    const term = q.trim()
    if (!term) return []
    const roll = norm(term)
    const lower = term.toLowerCase()
    const list = [...students.values()].filter(
      (s) => norm(s.buyer.roll_no).includes(roll) || s.buyer.name.toLowerCase().includes(lower),
    )
    const rank = (s: Student) =>
      norm(s.buyer.roll_no) === roll ? 0 : norm(s.buyer.roll_no).startsWith(roll) ? 1 : s.buyer.name.toLowerCase().startsWith(lower) ? 2 : 3
    return list.sort((a, b) => rank(a) - rank(b) || a.buyer.roll_no.localeCompare(b.buyer.roll_no)).slice(0, 30)
  }, [q, students])

  const student = buyerId ? students.get(buyerId) : undefined
  const waiting = useMemo(() => [...students.values()].filter((s) => s.ready > 0).length, [students])

  // default selection: every item that is in MART
  useEffect(() => {
    setChosen(new Set(student?.items.filter((i) => i.status === 'received').map((i) => i.id) ?? []))
  }, [buyerId]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = (id: string) => {
    setBuyerId(id)
    window.scrollTo({ top: 0 })
  }
  /** back to an empty search, ready for the next student */
  const reset = () => {
    setBuyerId(null)
    setQ('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const flags = (student && notesByBuyer.get(student.buyer.id)?.filter((n) => n.is_flag && !n.resolved && !n.item_id)) ?? []
  const sorted = student
    ? [...student.items].sort(
        (a, b) =>
          ['received', 'sent_to_vendor', 'ordered', 'handed_over'].indexOf(a.status) -
            ['received', 'sent_to_vendor', 'ordered', 'handed_over'].indexOf(b.status) ||
          a.product.sort_order - b.product.sort_order ||
          compareSizes(a.size, b.size),
      )
    : []
  const readyCount = sorted.filter((i) => i.status === 'received').length
  const chosenItems = sorted.filter((i) => i.status === 'received' && (readyCount === 1 || chosen.has(i.id)))

  return (
    <div className="page narrow">
      <PageHead
        title="Handover desk"
        sub={`${plural(waiting, 'student')} with items waiting in MART`}
        hideTitleOnMobile
      />

      <div className="desk-search">
        <div className="input-wrap">
          <Search size={18} />
          <input
            ref={inputRef}
            className="input input-lg"
            placeholder="Roll number or name"
            value={q}
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            enterKeyHint="search"
            onChange={(e) => {
              setQ(e.target.value)
              setBuyerId(null)
              setDone(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results.length > 0) open(results[0].buyer.id)
            }}
            aria-label="Search by roll number or name"
          />
          {q && (
            <button
              className="btn btn-ghost btn-icon btn-sm"
              style={{ position: 'absolute', right: 8, top: 11 }}
              onClick={reset}
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {!student && q.trim() && (
        <div className="card">
          {results.length === 0 ? (
            <Empty icon={<Search size={18} />} title="No student found">
              Check the roll number. Only students with an order in this sales round show up.
            </Empty>
          ) : (
            <div className="result-list">
              {results.map((s) => (
                <button key={s.buyer.id} className="result" onClick={() => open(s.buyer.id)}>
                  <Avatar name={s.buyer.name || s.buyer.roll_no} />
                  <div className="body">
                    <div className="name">{s.buyer.name || '—'}</div>
                    <div className="mono muted">{s.buyer.roll_no}</div>
                  </div>
                  <div className="counts">
                    {s.ready > 0 && <span className="badge badge-green">{s.ready} ready</span>}
                    {s.pending > 0 && <span className="badge badge-amber">{s.pending} not arrived</span>}
                    {s.done > 0 && <span className="badge badge-blue">{s.done} already taken</span>}
                  </div>
                  <ChevronRight size={16} className="subtle" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!student && !q.trim() && done && (
        <div className="callout ok" role="status" style={{ fontSize: 15, padding: '16px 18px', marginBottom: 12 }}>
          <Check size={20} />
          <div>
            <b style={{ fontWeight: 600 }}>{done}</b>
            <div style={{ opacity: 0.85 }}>Type the next roll number.</div>
          </div>
        </div>
      )}

      {!student && !q.trim() && !done && (
        <div className="card">
          <Empty icon={<PackageCheck size={20} />} title="Type the student's roll number">
            Even the last 3 digits are enough. Then tap their name.
          </Empty>
        </div>
      )}

      {student && (
        <div className="card">
          <div className="card-body stack">
            <div className="student-head">
              <Avatar name={student.buyer.name || student.buyer.roll_no} />
              <div style={{ minWidth: 0 }}>
                <h2>{student.buyer.name || '—'}</h2>
                <div className="mono muted">{student.buyer.roll_no}</div>
              </div>
            </div>
            <div className="meta">
              {student.buyer.batch && <span>{student.buyer.batch}</span>}
              {student.buyer.course && <span>{student.buyer.course}</span>}
              {student.buyer.section && student.buyer.section !== 'NA' && <span>{student.buyer.section}</span>}
              {student.buyer.phone && <a href={`tel:${student.buyer.phone}`}>{student.buyer.phone}</a>}
            </div>
            {flags.map((n) => (
              <div key={n.id} className="flag">
                <Flag size={15} style={{ marginTop: 2 }} />
                <div className="body">{n.body}</div>
                {can(role, 'resolveNotes') && (
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      try {
                        await api.setNoteResolved(n.id, true)
                        await refresh()
                      } catch (e) {
                        toast.err(friendlyError(e))
                      }
                    }}
                  >
                    <Check size={13} /> Sorted
                  </button>
                )}
              </div>
            ))}
          </div>

          {readyCount > 1 && can(role, 'handover') && (
            <div className="hint" style={{ padding: '0 16px 10px' }}>
              All ready items are ticked. Untick any they are not taking today.
            </div>
          )}
          {sorted.map((i) => {
            // with a single ready item there is nothing to choose, so no checkbox
            const selectable = i.status === 'received' && can(role, 'handover') && readyCount > 1
            const on = chosen.has(i.id) && selectable
            return (
              <div
                key={i.id}
                className={`shirt${selectable ? ' selectable' : ''}${on ? ' chosen' : ''}`}
                onClick={() => {
                  if (!selectable) return
                  const n = new Set(chosen)
                  if (n.has(i.id)) n.delete(i.id)
                  else n.add(i.id)
                  setChosen(n)
                }}
              >
                {selectable && <input type="checkbox" checked={on} readOnly aria-label={`Select ${i.product.colour} ${i.size}`} />}
                <span className="shirt-size">{i.size.length > 5 ? '…' : i.size}</span>
                <div className="body">
                  <div className="title">
                    <ProductLabel product={i.product} />
                  </div>
                  <div className="hint">
                    {i.size.length > 5 && <>{i.size} · </>}
                    {i.print_name ? <>Back: <b style={{ fontWeight: 500, color: 'var(--text-muted)' }}>{i.print_name}</b></> : 'No name on back'}
                    {i.batch && <> · {i.batch}</>}
                  </div>
                  {i.handover && (
                    <div className="hint">
                      {formatDateTime(i.handover.handed_at)} by {memberName(i.handover.handed_by)} ·{' '}
                      {i.handover.type === 'self' ? 'to the student' : `collected by ${i.handover.collector_name} (${i.handover.collector_roll})`}
                    </div>
                  )}
                </div>
                <div className="stack-sm" style={{ alignItems: 'flex-end' }}>
                  <StatusBadge status={i.status} />
                  {i.status === 'handed_over' && can(role, 'undoHandover') && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setUndoItem(i)
                      }}
                    >
                      Undo
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          <div className="desk-actions">
            {can(role, 'handover') && student.ready > 0 ? (
              <button className="btn btn-primary btn-lg" style={{ flex: 1 }} disabled={chosenItems.length === 0} onClick={() => setConfirm(true)}>
                <PackageCheck size={18} />
                {chosenItems.length === 0 ? 'Tick a item to hand over' : `Hand over ${plural(chosenItems.length, 'item')}`}
              </button>
            ) : (
              <div className="muted" style={{ flex: 1, alignSelf: 'center' }}>
                {student.ready === 0 && student.pending > 0
                  ? 'Their items have not arrived yet. Nothing to hand over.'
                  : student.ready === 0
                    ? 'They have already taken all their items.'
                    : 'Your role can see handovers but not record them.'}
              </div>
            )}
          </div>
        </div>
      )}

      {confirm && student && (
        <ConfirmHandover
          student={student}
          items={chosenItems}
          onClose={() => setConfirm(false)}
          onDone={async (message) => {
            setConfirm(false)
            setDone(message)
            reset()
            await refresh()
          }}
        />
      )}
      {undoItem && (
        <UndoHandoverModal
          item={undoItem}
          onClose={() => setUndoItem(null)}
          onDone={() => {
            setUndoItem(null)
            void refresh()
          }}
        />
      )}
    </div>
  )
}

function ConfirmHandover({
  student,
  items,
  onClose,
  onDone,
}: {
  student: Student
  items: ItemView[]
  onClose(): void
  onDone(message: string): Promise<void>
}) {
  const { api } = useAuth()
  const toast = useToast()
  const [other, setOther] = useState(false)
  const [name, setName] = useState('')
  const [roll, setRoll] = useState('')
  const [busy, setBusy] = useState(false)
  const who = student.buyer.name || student.buyer.roll_no
  const shirts = plural(items.length, 'item')
  const them = items.length === 1 ? 'it' : 'them'

  const submit = async (type: 'self' | 'collected_by_other') => {
    setBusy(true)
    try {
      await api.recordHandover(
        items.map((i) => i.id),
        type,
        type === 'collected_by_other' ? name : undefined,
        type === 'collected_by_other' ? roll : undefined,
      )
      await onDone(
        type === 'self'
          ? `Done: ${shirts} given to ${who} (${student.buyer.roll_no}).`
          : `Done: ${shirts} for ${who} given to ${name.trim()} (${roll.trim().toUpperCase()}).`,
      )
    } catch (e) {
      toast.err(friendlyError(e))
      setBusy(false)
    }
  }

  return (
    <Modal title={items.length === 1 ? 'Who is taking the item?' : 'Who is taking the items?'} onClose={onClose}>
      <div className="hint">{items.map((i) => `${i.product.colour} ${i.size}`).join(' · ')}</div>
      {!other ? (
        <>
          <button type="button" className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => void submit('self')}>
            <UserRound size={18} /> {who} is taking {them}
          </button>
          <button type="button" className="btn btn-lg btn-block" disabled={busy} onClick={() => setOther(true)}>
            <Users size={18} /> A friend is taking {them}
          </button>
        </>
      ) : (
        <>
          <div className="callout">
            <Users size={15} />
            <div>Write down the friend's name and roll number, so we know who took {who}'s items.</div>
          </div>
          <div className="grid-2" style={{ gap: 10 }}>
            <div className="field">
              <label htmlFor="col-name">Friend's name</label>
              <input id="col-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="col-roll">Friend's roll number</label>
              <input
                id="col-roll"
                className="input mono"
                autoCapitalize="characters"
                value={roll}
                onChange={(e) => setRoll(e.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            disabled={busy || name.trim().length < 2 || roll.trim().length < 2}
            onClick={() => void submit('collected_by_other')}
          >
            <Check size={18} /> Give {shirts} to {name.trim() || 'the friend'}
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setOther(false)}>
            Back
          </button>
        </>
      )}
    </Modal>
  )
}
