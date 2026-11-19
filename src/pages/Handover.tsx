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

  // default selection: every shirt that is in MART
  useEffect(() => {
    setChosen(new Set(student?.items.filter((i) => i.status === 'received').map((i) => i.id) ?? []))
  }, [buyerId]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = (id: string) => {
    setBuyerId(id)
    window.scrollTo({ top: 0 })
  }
  const next = () => {
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
  const chosenItems = sorted.filter((i) => chosen.has(i.id) && i.status === 'received')

  return (
    <div className="page narrow">
      <PageHead
        title="Handover desk"
        sub={`${plural(waiting, 'student')} with shirts waiting in MART`}
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
              onClick={next}
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
                    {s.pending > 0 && <span className="badge badge-amber">{s.pending} pending</span>}
                    {s.done > 0 && <span className="badge badge-blue">{s.done} collected</span>}
                  </div>
                  <ChevronRight size={16} className="subtle" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!student && !q.trim() && (
        <div className="card">
          <Empty icon={<PackageCheck size={20} />} title="Find a student to hand over">
            Type a roll number (e.g. the last 3 digits) or a name. Press Enter to open the first match.
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
                    <Check size={13} /> Done
                  </button>
                )}
              </div>
            ))}
          </div>

          {sorted.map((i) => {
            const selectable = i.status === 'received' && can(role, 'handover')
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
                Hand over {chosenItems.length > 0 ? plural(chosenItems.length, 'shirt') : ''}
              </button>
            ) : (
              <div className="muted" style={{ flex: 1, alignSelf: 'center' }}>
                {student.ready === 0 && student.pending > 0
                  ? 'Nothing in MART yet for this student.'
                  : student.ready === 0
                    ? 'Everything has been collected.'
                    : 'Your role can view handovers but not record them.'}
              </div>
            )}
            <button className="btn btn-lg" onClick={next}>
              Next
            </button>
          </div>
        </div>
      )}

      {confirm && student && (
        <ConfirmHandover
          student={student}
          items={chosenItems}
          onClose={() => setConfirm(false)}
          onDone={async () => {
            setConfirm(false)
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
  onDone(): Promise<void>
}) {
  const { api } = useAuth()
  const toast = useToast()
  const [type, setType] = useState<'self' | 'collected_by_other'>('self')
  const [name, setName] = useState('')
  const [roll, setRoll] = useState('')
  const [busy, setBusy] = useState(false)
  const valid = type === 'self' || (name.trim().length > 1 && roll.trim().length > 1)

  const submit = async () => {
    setBusy(true)
    try {
      const n = await api.recordHandover(
        items.map((i) => i.id),
        type,
        type === 'collected_by_other' ? name : undefined,
        type === 'collected_by_other' ? roll : undefined,
      )
      toast.ok(`${plural(n, 'shirt')} handed over${type === 'self' ? '' : ` to ${name.trim()}`}`)
      await onDone()
    } catch (e) {
      toast.err(friendlyError(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Hand over ${plural(items.length, 'shirt')}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void submit()}>
            <Check size={15} /> Confirm handover
          </button>
        </>
      }
    >
      <div className="hint">{items.map((i) => `${i.product.colour} ${i.size}`).join(' · ')}</div>
      <button type="button" className={`choice${type === 'self' ? ' on' : ''}`} onClick={() => setType('self')}>
        <UserRound size={18} />
        <div>
          <div className="title">To {student.buyer.name || 'the student'}</div>
          <div className="hint">{student.buyer.roll_no} collected it themselves</div>
        </div>
      </button>
      <button
        type="button"
        className={`choice${type === 'collected_by_other' ? ' on' : ''}`}
        onClick={() => setType('collected_by_other')}
      >
        <Users size={18} />
        <div>
          <div className="title">Collected by someone else</div>
          <div className="hint">A friend picks it up — note their name and roll number</div>
        </div>
      </button>
      {type === 'collected_by_other' && (
        <div className="grid-2" style={{ gap: 10 }}>
          <div className="field">
            <label htmlFor="col-name">Their name</label>
            <input id="col-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="col-roll">Their roll number</label>
            <input
              id="col-roll"
              className="input mono"
              autoCapitalize="characters"
              value={roll}
              onChange={(e) => setRoll(e.target.value)}
            />
          </div>
        </div>
      )}
    </Modal>
  )
}
