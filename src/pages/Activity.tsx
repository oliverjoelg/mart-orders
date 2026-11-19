import { History } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { ItemDrawer, useDescribeCtx } from '../components/ItemDrawer'
import { Empty, Loading, PageHead, RoleBadge } from '../components/ui'
import { friendlyError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { describeEntry } from '../lib/describe'
import { formatDateTime, timeAgo } from '../lib/format'
import type { AuditEntry } from '../lib/types'

const TABLES: { value: string; label: string }[] = [
  { value: '', label: 'Everything' },
  { value: 'order_items', label: 'Items & status' },
  { value: 'handovers', label: 'Handovers' },
  { value: 'notes', label: 'Notes & flags' },
  { value: 'imports', label: 'Imports' },
  { value: 'members', label: 'Team' },
  { value: 'products', label: 'Products' },
  { value: 'spare_stock', label: 'Spare stock' },
]
const PAGE = 50

export default function Activity() {
  const { api } = useAuth()
  const ctx = useDescribeCtx()
  const [table, setTable] = useState('')
  const [rows, setRows] = useState<AuditEntry[] | null>(null)
  const [more, setMore] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const close = useCallback(() => setOpenId(null), [])

  useEffect(() => {
    let live = true
    setRows(null)
    api
      .activity({ limit: PAGE, table: table || undefined })
      .then((r) => {
        if (!live) return
        setRows(r)
        setMore(r.length === PAGE)
      })
      .catch((e) => live && setError(friendlyError(e)))
    return () => {
      live = false
    }
  }, [api, table])

  const loadMore = async () => {
    const last = rows?.[rows.length - 1]
    if (!last) return
    const r = await api.activity({ limit: PAGE, table: table || undefined, beforeId: last.id })
    setRows([...(rows ?? []), ...r])
    setMore(r.length === PAGE)
  }

  return (
    <div className="page">
      <PageHead
        title="Activity"
        sub="Every change, written by the database itself: who, when, and what it was before."
        actions={
          <select className="select" value={table} onChange={(e) => setTable(e.target.value)} aria-label="Filter">
            {TABLES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        }
      />
      {error && <div className="callout err">{error}</div>}
      {!rows && !error && <Loading />}
      {rows && (
        <div className="card">
          {rows.length === 0 && <Empty icon={<History size={20} />} title="No activity yet" />}
          {rows.map((e) => {
            const d = describeEntry(e, ctx)
            const clickable = !!e.item_id && e.action !== 'DELETE'
            return (
              <div
                key={e.id}
                className="feed-item"
                style={{ cursor: clickable ? 'pointer' : 'default' }}
                onClick={() => clickable && setOpenId(e.item_id)}
              >
                <span className="avatar" style={{ width: 28, height: 28, fontSize: 10.5 }}>
                  {(e.actor_name ?? 'S').slice(0, 1).toUpperCase()}
                </span>
                <div className="body">
                  <div>
                    <b style={{ fontWeight: 500 }}>{e.actor_name ?? 'System'}</b>{' '}
                    <span className="muted">{d.text}</span>
                  </div>
                  <div className="row hint" style={{ gap: 6 }}>
                    {e.actor_role && <RoleBadge role={e.actor_role} />}
                    <span title={formatDateTime(e.at)}>{formatDateTime(e.at)}</span>
                  </div>
                </div>
                <span className="when hide-mobile">{timeAgo(e.at)}</span>
              </div>
            )
          })}
          {more && rows.length > 0 && (
            <div className="card-body" style={{ textAlign: 'center' }}>
              <button className="btn" onClick={() => void loadMore()}>Load older</button>
            </div>
          )}
        </div>
      )}
      {openId && <ItemDrawer itemId={openId} onClose={close} />}
    </div>
  )
}
