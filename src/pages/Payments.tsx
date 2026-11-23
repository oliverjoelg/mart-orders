import { Check, Download, ExternalLink, IndianRupee, Pencil, Plus, Search, Undo2, Wallet, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../components/Toast'
import { Empty, Loading, Modal, PageHead, Stat } from '../components/ui'
import { friendlyError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatDateTime, inr, plural } from '../lib/format'
import { PAGE_HINTS } from '../lib/hints'
import { downloadXlsx } from '../lib/import/readFile'
import { can, isSuperRole } from '../lib/permissions'
import { useData } from '../lib/store'
import type { Buyer, Payment, PaymentStatus } from '../lib/types'

/**
 * Payments: what each student says they paid (from the order form) and a manual check by the
 * people whose QR codes were used. A separate verification step: it never touches stock.
 */

type Check = '' | 'mismatch' | 'twice' | 'other_round' | 'no_txn' | 'problem' | 'none'

const STATUS_LABEL: Record<PaymentStatus, string> = { unchecked: 'To check', received: 'Received', problem: 'Problem' }
const STATUS_ORDER: Record<PaymentStatus, number> = { unchecked: 0, problem: 1, received: 2 }
const PAGE = 150

/** Form screenshots live on Google Drive; anything else is shown with its site name so nobody is fooled by a fake link. */
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname
  } catch {
    return 'unknown site'
  }
}
const isGoogleHost = (u: string) => /(^|\.)(drive|docs)\.google\.com$/.test(hostOf(u))

const txnKey = (t: string | null) => (t ?? '').replace(/\s+/g, '').toUpperCase()

export default function Payments() {
  const { api, member } = useAuth()
  const { campaign, campaigns, items, buyersById, memberName } = useData()
  const toast = useToast()
  const role = member?.role
  const canCheck = can(role, 'checkPayments') && !campaign?.locked
  const isSuper = isSuperRole(role)

  const [payments, setPayments] = useState<Payment[] | null>(null)
  const [elsewhere, setElsewhere] = useState<Map<string, string[]>>(new Map())
  const [q, setQ] = useState('')
  const [payee, setPayee] = useState('')
  const [status, setStatus] = useState<'' | PaymentStatus>('')
  const [check, setCheck] = useState<Check>('')
  const [limit, setLimit] = useState(PAGE)
  const [editing, setEditing] = useState<Payment | 'new' | null>(null)
  const [addFor, setAddFor] = useState<Buyer | null>(null)
  const [problemFor, setProblemFor] = useState<Payment | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!campaign) return
    let live = true
    setPayments(null)
    api
      .loadPayments(campaign.id)
      .then(async (ps) => {
        if (!live) return
        setPayments(ps)
        const ids = [...new Set(ps.map((p) => p.txn_id).filter((t): t is string => !!t))]
        const other = ids.length ? await api.txnElsewhere(ids, campaign.id) : []
        if (!live) return
        const names = new Map(campaigns.map((c) => [c.id, c.name]))
        const m = new Map<string, string[]>()
        for (const o of other) m.set(txnKey(o.txn_id), [...(m.get(txnKey(o.txn_id)) ?? []), names.get(o.campaign_id) ?? 'another round'])
        setElsewhere(m)
      })
      .catch((e) => {
        if (live) {
          toast.err(friendlyError(e))
          setPayments([])
        }
      })
    return () => {
      live = false
    }
  }, [api, campaign, campaigns, toast])

  const put = (p: Payment) => setPayments((prev) => (prev ? [...prev.filter((x) => x.id !== p.id), p] : [p]))

  // ---- tallies -------------------------------------------------------------------------
  const calc = useMemo(() => {
    const ps = payments ?? []
    const cost = new Map<string, number>()
    for (const i of items) cost.set(i.buyer_id, (cost.get(i.buyer_id) ?? 0) + i.product.price_inr)
    const paid = new Map<string, number>()
    for (const p of ps) paid.set(p.buyer_id, (paid.get(p.buyer_id) ?? 0) + (p.amount_paid ?? 0))
    const txnCount = new Map<string, number>()
    for (const p of ps) if (p.txn_id) txnCount.set(txnKey(p.txn_id), (txnCount.get(txnKey(p.txn_id)) ?? 0) + 1)
    const balance = (buyerId: string) => (paid.get(buyerId) ?? 0) - (cost.get(buyerId) ?? 0)
    const issues = (p: Payment): Check[] => {
      const out: Check[] = []
      if (balance(p.buyer_id) !== 0) out.push('mismatch')
      if (p.txn_id && (txnCount.get(txnKey(p.txn_id)) ?? 0) > 1) out.push('twice')
      if (p.txn_id && elsewhere.has(txnKey(p.txn_id))) out.push('other_round')
      if (!p.txn_id) out.push('no_txn')
      if (p.status === 'problem') out.push('problem')
      return out
    }
    const paidBuyers = new Set(ps.map((p) => p.buyer_id))
    const noPayment = [...cost.keys()]
      .filter((id) => !paidBuyers.has(id))
      .map((id) => buyersById.get(id))
      .filter((b): b is Buyer => !!b)
      .sort((a, b) => a.roll_no.localeCompare(b.roll_no))

    const byPayee = new Map<string, { n: number; claimed: number; confirmed: number; nConfirmed: number; toCheck: number; problems: number }>()
    for (const p of ps) {
      const k = p.paid_to?.trim() || 'Not given'
      const t = byPayee.get(k) ?? { n: 0, claimed: 0, confirmed: 0, nConfirmed: 0, toCheck: 0, problems: 0 }
      t.n++
      t.claimed += p.amount_paid ?? 0
      if (p.status === 'received') {
        t.confirmed += p.amount_paid ?? 0
        t.nConfirmed++
      }
      if (p.status === 'unchecked') t.toCheck++
      if (p.status === 'problem') t.problems++
      byPayee.set(k, t)
    }
    const totalCost = [...cost.values()].reduce((a, b) => a + b, 0)
    const sum = (f: (p: Payment) => boolean) => ps.filter(f).reduce((a, p) => a + (p.amount_paid ?? 0), 0)
    const counts: Record<Exclude<Check, ''>, number> = {
      mismatch: ps.filter((p) => issues(p).includes('mismatch')).length,
      twice: ps.filter((p) => issues(p).includes('twice')).length,
      other_round: ps.filter((p) => issues(p).includes('other_round')).length,
      no_txn: ps.filter((p) => !p.txn_id).length,
      problem: ps.filter((p) => p.status === 'problem').length,
      none: noPayment.length,
    }
    return {
      balance, issues, noPayment, counts, totalCost,
      cost,
      byPayee: [...byPayee.entries()].sort((a, b) => b[1].n - a[1].n),
      claimed: sum(() => true),
      confirmed: sum((p) => p.status === 'received'),
      toCheck: ps.filter((p) => p.status === 'unchecked'),
      received: ps.filter((p) => p.status === 'received').length,
    }
  }, [payments, items, buyersById, elsewhere])

  const filtered = useMemo(() => {
    const needle = q.trim().toUpperCase()
    return (payments ?? [])
      .filter((p) => {
        const b = buyersById.get(p.buyer_id)
        if (payee && (p.paid_to?.trim() || 'Not given') !== payee) return false
        if (status && p.status !== status) return false
        if (check && check !== 'none' && !calc.issues(p).includes(check)) return false
        if (needle) {
          const hay = [b?.roll_no, b?.name, p.txn_id, p.paid_to, p.note].join(' ').toUpperCase()
          if (!hay.includes(needle) && !txnKey(p.txn_id).includes(needle.replace(/\s+/g, ''))) return false
        }
        return true
      })
      .sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          (a.source_timestamp ?? a.created_at).localeCompare(b.source_timestamp ?? b.created_at),
      )
  }, [payments, q, payee, status, check, calc, buyersById])

  // ---- actions ---------------------------------------------------------------------------
  const setPaymentStatus = async (p: Payment, next: PaymentStatus, note?: string) => {
    setBusyId(p.id)
    try {
      put(await api.updatePayment(p.id, note === undefined ? { status: next } : { status: next, note }))
      if (next === 'received') toast.ok(`Received from ${buyersById.get(p.buyer_id)?.name || 'student'}`)
    } catch (e) {
      toast.err(friendlyError(e))
    } finally {
      setBusyId(null)
    }
  }

  const exportFile = () => {
    if (!campaign || !payments) return
    const rows = [...payments]
      .sort((a, b) => (buyersById.get(a.buyer_id)?.roll_no ?? '').localeCompare(buyersById.get(b.buyer_id)?.roll_no ?? ''))
      .map((p) => {
        const b = buyersById.get(p.buyer_id)
        const bal = calc.balance(p.buyer_id)
        return [
          b?.roll_no ?? '', b?.name ?? '', p.paid_to ?? '', String(p.amount_paid ?? ''), String(calc.cost.get(p.buyer_id) ?? 0),
          bal === 0 ? '' : String(bal), p.txn_id ?? '', STATUS_LABEL[p.status], p.note ?? '',
          p.checked_by ? memberName(p.checked_by) : '', p.checked_at ? formatDateTime(p.checked_at) : '',
          p.source_timestamp ? formatDateTime(p.source_timestamp) : 'added by hand', p.screenshot_url ?? (p.screenshot_path ? 'uploaded on the order form' : ''),
        ]
      })
    void downloadXlsx(`MART payments - ${campaign.name}.xlsx`, [
      {
        name: 'Payments',
        rows: [
          ['Roll no.', 'Student', 'Paid to', 'Amount paid', 'Items cost', 'Difference (student total)', 'Transaction ID',
            'Status', 'Note', 'Checked by', 'Checked at', 'Form response', 'Screenshot'],
          ...rows,
        ],
      },
      {
        name: 'By who received it',
        rows: [
          ['Paid to', 'Payments', 'Amount students say they paid', 'Confirmed received', 'Payments confirmed', 'Still to check', 'Problems'],
          ...calc.byPayee.map(([k, t]) => [k, String(t.n), String(t.claimed), String(t.confirmed), String(t.nConfirmed), String(t.toCheck), String(t.problems)]),
        ],
      },
      {
        name: 'No payment on record',
        rows: [['Roll no.', 'Student', 'Email', 'Phone', 'Items cost'], ...calc.noPayment.map((b) => [b.roll_no, b.name, b.email ?? '', b.phone ?? '', String(calc.cost.get(b.id) ?? 0)])],
      },
    ])
  }

  if (!campaign) {
    return (
      <div className="page">
        <PageHead title="Payments" sub="Create a sales round on the Products page first." />
      </div>
    )
  }
  if (!payments) return <Loading label="Loading payments…" />

  const anyFilter = !!(q || payee || status || check)
  const shown = filtered.slice(0, limit)
  const payees = calc.byPayee.map(([k]) => k)
  const CHECKS: { key: Exclude<Check, ''>; label: string; hint: string }[] = [
    { key: 'mismatch', label: "Amount doesn't match", hint: "What the student paid in total differs from what their items cost" },
    { key: 'twice', label: 'Same transaction ID twice', hint: 'Two payments in this round give the same transaction ID' },
    { key: 'other_round', label: 'ID used in another round', hint: 'This transaction ID was also given in an earlier round (an old screenshot?)' },
    { key: 'no_txn', label: 'No transaction ID', hint: 'Nothing to look up in the UPI history' },
    { key: 'problem', label: 'Marked as a problem', hint: 'Someone flagged these' },
    { key: 'none', label: 'No payment on record', hint: 'Students with items in this round but no payment details' },
  ]

  return (
    <div className="page">
      <PageHead
        title="Payments"
        sub={`${PAGE_HINTS['/payments']} A separate check: nothing here changes stock or handovers.`}
        actions={
          <>
            <button className="btn" onClick={exportFile} disabled={!payments.length} title="Excel file: every payment, totals by who received it, and students with no payment">
              <Download size={15} /> Download Excel
            </button>
            {canCheck && (
              <button className="btn btn-primary" onClick={() => setEditing('new')} title="Record a payment that isn't in the form, e.g. cash">
                <Plus size={15} /> Add payment
              </button>
            )}
          </>
        }
      />

      {payments.length === 0 && calc.noPayment.length === 0 ? (
        <div className="card">
          <Empty icon={<Wallet size={20} />} title="No payments yet">
            Payment details are saved when orders are added from the Google Form file. For orders added before this page
            existed, upload the same file again on Add orders: only the payment details are saved.
          </Empty>
        </div>
      ) : (
        <>
          <div className="stats">
            <Stat label="Items cost" value={inr(calc.totalCost)} icon={<IndianRupee size={14} />} sub={`${plural(items.length, 'item')} in this round`} />
            <Stat label="Students say they paid" value={inr(calc.claimed)} sub={plural(payments.length, 'payment')} />
            <Stat accent label="Confirmed received" value={inr(calc.confirmed)} sub={`${calc.received} of ${payments.length} checked`} />
            <Stat label="Still to check" value={calc.toCheck.length} sub={inr(calc.toCheck.reduce((a, p) => a + (p.amount_paid ?? 0), 0))} />
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head">
              <h3>By who received it</h3>
              <span className="hint">Tap one to see only their payments</span>
            </div>
            <div className="card-body stack-sm">
              {calc.byPayee.map(([name, t]) => (
                <button
                  key={name}
                  type="button"
                  className={`payee-row${payee === name ? ' active' : ''}`}
                  onClick={() => setPayee(payee === name ? '' : name)}
                  title={`Show only payments made to ${name}`}
                >
                  <div className="row between" style={{ flexWrap: 'wrap', gap: 6 }}>
                    <b>{name}</b>
                    <span className="hint">
                      {inr(t.confirmed)} confirmed of {inr(t.claimed)} · {t.toCheck} to check
                      {t.problems ? ` · ${plural(t.problems, 'problem')}` : ''}
                    </span>
                  </div>
                  <div className="progress" aria-hidden>
                    <span style={{ width: `${(t.nConfirmed / t.n) * 100}%`, background: 'var(--accent)' }} />
                    <span style={{ width: `${(t.problems / t.n) * 100}%`, background: 'var(--red)' }} />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="chips" style={{ margin: '16px 0 10px' }}>
            {CHECKS.filter((c) => calc.counts[c.key] > 0).map((c) => (
              <button
                key={c.key}
                type="button"
                className={`chip${check === c.key ? ' active' : ''}`}
                onClick={() => setCheck(check === c.key ? '' : c.key)}
                title={c.hint}
              >
                {c.label} <b>{calc.counts[c.key]}</b>
              </button>
            ))}
          </div>

          <div className="toolbar">
            <div className="input-wrap grow">
              <Search size={15} className="sm" />
              <input
                className="input input-sm-icon"
                placeholder="Name, roll no. or last digits of the transaction ID"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setLimit(PAGE)
                }}
                aria-label="Search payments"
              />
            </div>
            <select className="select" value={payee} onChange={(e) => setPayee(e.target.value)} aria-label="Paid to">
              <option value="">Paid to anyone</option>
              {payees.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value as '' | PaymentStatus)} aria-label="Status">
              <option value="">Any status</option>
              <option value="unchecked">To check</option>
              <option value="received">Received</option>
              <option value="problem">Problem</option>
            </select>
            {anyFilter && (
              <button className="btn btn-ghost" onClick={() => { setQ(''); setPayee(''); setStatus(''); setCheck('') }}>
                <X size={14} /> Clear
              </button>
            )}
          </div>

          {check === 'none' ? (
            <NoPaymentList buyers={calc.noPayment} cost={calc.cost} canAdd={canCheck} onAdd={(b) => { setAddFor(b); setEditing('new') }} />
          ) : payments.length === 0 ? (
            <div className="card">
              <Empty icon={<Wallet size={20} />} title="No payment details saved yet">
                These orders were added before payments were tracked. On Add orders, upload the same Google Form file again:
                only the payment details are saved, nothing is imported twice.
              </Empty>
            </div>
          ) : filtered.length === 0 ? (
            <div className="card">
              <Empty icon={<Wallet size={20} />} title="No payments match">Try fewer filters.</Empty>
            </div>
          ) : (
            <div className="table-wrap cards-on-mobile">
              <table className="table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Paid to</th>
                    <th className="right">Amount</th>
                    <th>Transaction ID</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const b = buyersById.get(p.buyer_id)
                    return (
                      <tr key={p.id}>
                        <td>
                          <div style={{ fontWeight: 500 }}>{b?.name || b?.roll_no}</div>
                          <div className="hint mono">{b?.roll_no}</div>
                        </td>
                        <td>{p.paid_to ?? <span className="subtle">—</span>}</td>
                        <td className="right num nowrap">
                          <Amount p={p} balance={calc.balance(p.buyer_id)} />
                        </td>
                        <td>
                          <Txn p={p} issues={calc.issues(p)} elsewhere={elsewhere.get(txnKey(p.txn_id))} />
                        </td>
                        <td>
                          <StatusCell p={p} who={p.checked_by ? memberName(p.checked_by) : ''} />
                        </td>
                        <td className="right nowrap">
                          <Actions
                            p={p}
                            canCheck={canCheck}
                            busy={busyId === p.id}
                            onReceived={() => void setPaymentStatus(p, 'received')}
                            onProblem={() => setProblemFor(p)}
                            onUndo={() => void setPaymentStatus(p, 'unchecked')}
                            onEdit={() => setEditing(p)}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="list-cards">
                {shown.map((p) => {
                  const b = buyersById.get(p.buyer_id)
                  return (
                    <div key={p.id} className="list-card" style={{ flexDirection: 'column', gap: 8 }}>
                      <div className="row between" style={{ flexWrap: 'nowrap', width: '100%' }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="title">{b?.name || b?.roll_no}</div>
                          <div className="hint">
                            <span className="mono">{b?.roll_no}</span> · to {p.paid_to ?? '—'}
                          </div>
                        </div>
                        <div className="right" style={{ flexShrink: 0 }}>
                          <Amount p={p} balance={calc.balance(p.buyer_id)} />
                        </div>
                      </div>
                      <div className="row between" style={{ width: '100%', gap: 8 }}>
                        <Txn p={p} issues={calc.issues(p)} elsewhere={elsewhere.get(txnKey(p.txn_id))} />
                        <StatusCell p={p} who={p.checked_by ? memberName(p.checked_by) : ''} />
                      </div>
                      {canCheck && (
                        <div className="row" style={{ width: '100%' }}>
                          <Actions
                            p={p}
                            canCheck={canCheck}
                            busy={busyId === p.id}
                            wide
                            onReceived={() => void setPaymentStatus(p, 'received')}
                            onProblem={() => setProblemFor(p)}
                            onUndo={() => void setPaymentStatus(p, 'unchecked')}
                            onEdit={() => setEditing(p)}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {check !== 'none' && filtered.length > limit && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button className="btn" onClick={() => setLimit(limit + PAGE)}>
                Show more ({filtered.length - limit} left)
              </button>
            </div>
          )}
        </>
      )}

      {problemFor && (
        <ProblemModal
          p={problemFor}
          name={buyersById.get(problemFor.buyer_id)?.name ?? ''}
          onClose={() => setProblemFor(null)}
          onSave={async (note) => {
            await setPaymentStatus(problemFor, 'problem', note)
            setProblemFor(null)
          }}
        />
      )}

      {editing && (
        <PaymentModal
          initial={editing === 'new' ? null : editing}
          forBuyer={addFor}
          campaignId={campaign.id}
          payees={payees.filter((p) => p !== 'Not given')}
          canDelete={isSuper && editing !== 'new'}
          onClose={() => {
            setEditing(null)
            setAddFor(null)
          }}
          onSaved={(p) => {
            put(p)
            setEditing(null)
            setAddFor(null)
          }}
          onDeleted={(id) => {
            setPayments((prev) => prev?.filter((x) => x.id !== id) ?? null)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function Amount({ p, balance }: { p: Payment; balance: number }) {
  return (
    <div>
      <div style={{ fontWeight: 500 }}>{p.amount_paid === null ? <span className="subtle">—</span> : inr(p.amount_paid)}</div>
      {balance !== 0 && (
        <span
          className={`badge ${balance < 0 ? 'badge-amber' : 'badge-blue'}`}
          title="This student's payments in total, compared with what their items in this round cost"
        >
          {balance < 0 ? `${inr(-balance)} short` : `${inr(balance)} extra`}
        </span>
      )}
    </div>
  )
}

function Txn({ p, issues, elsewhere }: { p: Payment; issues: string[]; elsewhere?: string[] }) {
  const t = p.txn_id
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {t ? (
        <span className="mono" title="The last 4 digits are in bold: type them into your UPI app's search">
          {t.length > 4 ? t.slice(0, -4) : ''}
          <b style={{ color: 'var(--text)' }}>{t.slice(-4)}</b>
        </span>
      ) : (
        <span className="subtle">No transaction ID</span>
      )}
      {issues.includes('twice') && <span className="badge badge-red" title="Another payment in this round gives the same transaction ID">Twice</span>}
      {elsewhere && <span className="badge badge-red" title={`Also given in: ${elsewhere.join(', ')}`}>Used before</span>}
      {p.screenshot_path && <ScreenshotLink path={p.screenshot_path} />}
      {p.screenshot_url && (
        <a
          href={p.screenshot_url}
          target="_blank"
          rel="noreferrer noopener"
          className="hint row"
          style={{ gap: 3 }}
          title={`Open the payment screenshot the student uploaded (${hostOf(p.screenshot_url)})`}
        >
          <ExternalLink size={12} /> Screenshot
          {!isGoogleHost(p.screenshot_url) && <span className="badge badge-amber">{hostOf(p.screenshot_url)}: not Google Drive</span>}
        </a>
      )}
    </div>
  )
}

/** Screenshots from the order form live in private Storage: fetch a 10-minute link on tap. */
function ScreenshotLink({ path }: { path: string }) {
  const { api } = useAuth()
  const toast = useToast()
  return (
    <button
      type="button"
      className="hint row link-button"
      style={{ gap: 3, background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
      title="Open the payment screenshot the student uploaded on the order form"
      onClick={async () => {
        const w = window.open('', '_blank')
        try {
          const url = await api.screenshotLink(path)
          if (w) w.location.href = url
          else window.location.href = url
        } catch (e) {
          w?.close()
          toast.err(friendlyError(e))
        }
      }}
    >
      <ExternalLink size={12} /> Screenshot
    </button>
  )
}

function StatusCell({ p, who }: { p: Payment; who: string }) {
  const cls = p.status === 'received' ? 'badge badge-green' : p.status === 'problem' ? 'badge badge-red' : 'badge'
  return (
    <div>
      <span className={cls}>{STATUS_LABEL[p.status]}</span>
      {p.status !== 'unchecked' && who && (
        <div className="hint" title={p.checked_at ? formatDateTime(p.checked_at) : undefined}>by {who}</div>
      )}
      {p.note && <div className="hint" style={{ maxWidth: 220 }}>“{p.note}”</div>}
    </div>
  )
}

function Actions({
  p, canCheck, busy, wide, onReceived, onProblem, onUndo, onEdit,
}: {
  p: Payment
  canCheck: boolean
  busy: boolean
  wide?: boolean
  onReceived(): void
  onProblem(): void
  onUndo(): void
  onEdit(): void
}) {
  if (!canCheck) return null
  const grow = wide ? { flex: 1 } : undefined
  return (
    <div className="row" style={{ gap: 6, justifyContent: 'flex-end', width: wide ? '100%' : undefined }}>
      {p.status === 'unchecked' ? (
        <>
          <button className="btn btn-sm btn-primary" style={grow} disabled={busy} onClick={onReceived} title="You found this payment in your UPI history">
            <Check size={13} /> Received
          </button>
          <button className="btn btn-sm" style={grow} disabled={busy} onClick={onProblem} title="Not found, wrong amount, or something else to sort out">
            Problem
          </button>
        </>
      ) : (
        <button className="btn btn-sm btn-ghost" style={grow} disabled={busy} onClick={onUndo} title="Back to “To check”">
          <Undo2 size={13} /> Undo
        </button>
      )}
      <button className="btn btn-sm btn-ghost btn-icon" disabled={busy} onClick={onEdit} aria-label="Edit payment" title="Fix the amount, who it was paid to or the transaction ID">
        <Pencil size={13} />
      </button>
    </div>
  )
}

function NoPaymentList({ buyers, cost, canAdd, onAdd }: { buyers: Buyer[]; cost: Map<string, number>; canAdd: boolean; onAdd(b: Buyer): void }) {
  if (!buyers.length) return null
  return (
    <div className="card">
      <div className="card-head">
        <h3>{plural(buyers.length, 'student')} with items but no payment on record</h3>
      </div>
      <div className="list-cards" style={{ display: 'block' }}>
        {buyers.map((b) => (
          <div key={b.id} className="list-card">
            <div className="body">
              <div className="title">{b.name || b.roll_no}</div>
              <div className="hint">
                <span className="mono">{b.roll_no}</span> · items cost {inr(cost.get(b.id) ?? 0)}
              </div>
            </div>
            {canAdd && (
              <button className="btn btn-sm" onClick={() => onAdd(b)}>
                <Plus size={13} /> Add payment
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function ProblemModal({ p, name, onClose, onSave }: { p: Payment; name: string; onClose(): void; onSave(note: string): Promise<void> }) {
  const [note, setNote] = useState(p.note ?? '')
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title="Mark as a problem"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-danger"
            disabled={!note.trim() || busy}
            onClick={async () => {
              setBusy(true)
              await onSave(note.trim())
              setBusy(false)
            }}
          >
            Mark as problem
          </button>
        </>
      }
    >
      <p className="hint" style={{ marginTop: 0 }}>
        {name} · {p.amount_paid !== null ? inr(p.amount_paid) : 'no amount'} · {p.txn_id ?? 'no transaction ID'}
      </p>
      <div className="field">
        <label htmlFor="problem-note">What's wrong?</label>
        <input
          id="problem-note"
          className="input"
          autoFocus
          value={note}
          placeholder="e.g. Not in my UPI history / paid ₹699, owes ₹350"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  )
}

function PaymentModal({
  initial, forBuyer, campaignId, payees, canDelete, onClose, onSaved, onDeleted,
}: {
  initial: Payment | null
  forBuyer: Buyer | null
  campaignId: string
  payees: string[]
  canDelete: boolean
  onClose(): void
  onSaved(p: Payment): void
  onDeleted(id: string): void
}) {
  const { api } = useAuth()
  const { buyersById } = useData()
  const toast = useToast()
  const start = initial ? buyersById.get(initial.buyer_id) : forBuyer
  const [roll, setRoll] = useState(start?.roll_no ?? '')
  const [paidTo, setPaidTo] = useState(initial?.paid_to ?? '')
  const [amount, setAmount] = useState(initial?.amount_paid?.toString() ?? '')
  const [txn, setTxn] = useState(initial?.txn_id ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [received, setReceived] = useState(false)
  const [busy, setBusy] = useState(false)
  const buyers = useMemo(() => [...buyersById.values()].sort((a, b) => a.roll_no.localeCompare(b.roll_no)), [buyersById])
  const buyer = buyers.find((b) => b.roll_no === roll.trim().toUpperCase())
  const amountOk = amount.trim() === '' || /^\d+$/.test(amount.trim())

  const save = async () => {
    setBusy(true)
    try {
      const fields = {
        paid_to: paidTo.trim() || null,
        amount_paid: amount.trim() ? Number(amount.trim()) : null,
        txn_id: txn.trim() || null,
        note: note.trim() || null,
      }
      const saved = initial
        ? await api.updatePayment(initial.id, fields)
        : await api.addPayment({ ...fields, campaign_id: campaignId, buyer_id: buyer!.id, status: received ? 'received' : 'unchecked' })
      toast.ok(initial ? 'Payment updated' : 'Payment added')
      onSaved(saved)
    } catch (e) {
      toast.err(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={initial ? 'Edit payment' : 'Add payment'}
      onClose={onClose}
      footer={
        <>
          {canDelete && initial && (
            <button
              className="btn btn-danger"
              style={{ marginRight: 'auto' }}
              disabled={busy}
              onClick={async () => {
                if (!window.confirm('Remove this payment record? This cannot be undone (it stays in Activity).')) return
                setBusy(true)
                try {
                  await api.deletePayment(initial.id)
                  toast.ok('Payment removed')
                  onDeleted(initial.id)
                } catch (e) {
                  toast.err(friendlyError(e))
                } finally {
                  setBusy(false)
                }
              }}
            >
              Remove
            </button>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !amountOk || (!initial && !buyer)} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="pay-roll">Student roll no.</label>
        <input
          id="pay-roll"
          className="input mono"
          list="pay-rolls"
          value={roll}
          disabled={!!initial}
          placeholder="PGP26-001"
          onChange={(e) => setRoll(e.target.value)}
        />
        <datalist id="pay-rolls">
          {buyers.map((b) => (
            <option key={b.id} value={b.roll_no}>{b.name}</option>
          ))}
        </datalist>
        {roll.trim() && !initial && (
          <span className="hint" style={buyer ? undefined : { color: 'var(--red)' }}>
            {buyer ? buyer.name : 'No student with that roll no. in this round'}
          </span>
        )}
      </div>
      <div className="field">
        <label htmlFor="pay-to">Paid to</label>
        <input id="pay-to" className="input" list="pay-payees" value={paidTo} placeholder="Whose QR code, or Cash" onChange={(e) => setPaidTo(e.target.value)} />
        <datalist id="pay-payees">
          {payees.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="pay-amount">Amount (₹)</label>
          <input id="pay-amount" className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {!amountOk && <span className="hint" style={{ color: 'var(--red)' }}>Whole rupees only</span>}
        </div>
        <div className="field" style={{ flex: 2 }}>
          <label htmlFor="pay-txn">Transaction ID</label>
          <input id="pay-txn" className="input mono" value={txn} onChange={(e) => setTxn(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="pay-note">Note (optional)</label>
        <input id="pay-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {!initial && (
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={received} onChange={(e) => setReceived(e.target.checked)} />
          I've already checked that it arrived
        </label>
      )}
    </Modal>
  )
}
