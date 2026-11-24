import { Database, ExternalLink, HardDrive, RefreshCw, TrendingUp } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Loading, PageHead } from '../components/ui'
import { friendlyError, type UsageStats } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatDateTime, plural } from '../lib/format'
import { PAGE_HINTS } from '../lib/hints'

/**
 * Super admins: how much of the free Supabase plan is used. Database and file sizes come from
 * the database itself; download traffic (egress) is only in the Supabase dashboard.
 * Free plan limits: 500 MB database, 1 GB files, 5 GB egress a month (https://supabase.com/pricing).
 */
const DB_LIMIT = 500 * 1024 * 1024
const FILES_LIMIT = 1024 * 1024 * 1024

const TABLE_LABEL: Record<string, string> = {
  order_items: 'Items',
  audit_log: 'Change log (Activity)',
  buyers: 'Students',
  payments: 'Payments',
  handovers: 'Handovers',
  members: 'Team',
  notes: 'Notes & flags',
  products: 'Products',
  campaigns: 'Sales rounds',
  imports: 'Order uploads',
  spare_stock: 'Spare stock',
  roles: 'Roles',
  role_permissions: 'Role ticks',
  permissions: 'Permissions',
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${Number((n / 1024 / 1024 / 1024).toFixed(2))} GB`
}

/** Rough years until the database is full, from how fast our own tables grew since the first round. */
export function yearsLeft(u: Pick<UsageStats, 'db_bytes' | 'public_bytes' | 'first_round_at' | 'measured_at'>, limit = DB_LIMIT): number | null {
  if (!u.first_round_at) return null
  const days = Math.max(7, (Date.parse(u.measured_at) - Date.parse(u.first_round_at)) / 86400_000)
  const perYear = (u.public_bytes / days) * 365
  if (perYear <= 0) return null
  return Math.max(0, (limit - u.db_bytes) / perYear)
}

function dashboardUrl(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!url) return null
  try {
    const ref = new URL(url).hostname.split('.')[0]
    return `https://supabase.com/dashboard/project/${ref}/settings/billing/usage`
  } catch {
    return null
  }
}

function Meter({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min(100, (used / limit) * 100)
  const colour = pct >= 90 ? 'var(--red)' : pct >= 75 ? 'var(--amber)' : 'var(--accent)'
  return (
    <div className="stack-sm">
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <span style={{ fontSize: 22, fontWeight: 600 }}>{formatBytes(used)}</span>
        <span className="hint">
          of {formatBytes(limit)} · {used === 0 ? '0' : pct < 1 ? '<1' : pct.toFixed(0)}% used
        </span>
      </div>
      <div className="progress" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label={`${pct.toFixed(0)}% used`}>
        <span style={{ width: `${Math.max(pct, 0.5)}%`, background: colour }} />
      </div>
    </div>
  )
}

export default function Usage() {
  const { api } = useAuth()
  const [u, setU] = useState<UsageStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setU(await api.usageStats())
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const dash = dashboardUrl()
  const years = u ? yearsLeft(u) : null

  return (
    <div className="page narrow">
      <PageHead
        title="Usage"
        sub={`${PAGE_HINTS['/usage']} Free plan limits from supabase.com/pricing.`}
        actions={
          <button className="btn" onClick={() => void load()} disabled={busy} title="Measure again">
            <RefreshCw size={15} /> Refresh
          </button>
        }
      />
      {error && <div className="callout" style={{ color: 'var(--red)', marginBottom: 12 }}>{error}</div>}
      {!u && !error ? (
        <Loading label="Measuring…" />
      ) : u ? (
        <div className="stack">
          <div className="card card-pad stack-sm">
            <div className="row" style={{ gap: 8 }}>
              <Database size={16} /> <b>Database</b>
            </div>
            <Meter used={u.db_bytes} limit={DB_LIMIT} />
            <span className="hint">
              Everything in the app: orders, students, payments, the change log. About {formatBytes(u.db_bytes - u.public_bytes)} of it is
              Supabase's own system tables.
            </span>
          </div>

          <div className="card card-pad stack-sm">
            <div className="row" style={{ gap: 8 }}>
              <TrendingUp size={16} /> <b>How long until it's full</b>
            </div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>
              {years === null ? 'Not enough history yet' : years > 50 ? 'More than 50 years' : `About ${years < 1 ? 'less than a year' : `${Math.round(years)} years`}`}
            </div>
            <span className="hint">
              A rough guess at the current pace: {plural(u.orders, 'item')} ordered since {u.first_round_at ? formatDateTime(u.first_round_at) : '—'}. Each
              new round adds to it; the backup on Products keeps a copy if old rounds ever need clearing.
            </span>
          </div>

          <div className="card card-pad stack-sm">
            <div className="row" style={{ gap: 8 }}>
              <HardDrive size={16} /> <b>Uploaded files</b>
            </div>
            <Meter used={u.storage_bytes} limit={FILES_LIMIT} />
            <span className="hint">{u.storage_files ? plural(u.storage_files, 'file') : 'No files uploaded yet'} (e.g. payment screenshots from the order form).</span>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Biggest parts of the database</h3>
            </div>
            <div className="list-cards" style={{ display: 'block' }}>
              {u.tables.map((t) => (
                <div key={t.name} className="list-card">
                  <div className="body">
                    <div className="title">{TABLE_LABEL[t.name] ?? t.name}</div>
                    <div className="hint">about {plural(t.rows, 'row')}</div>
                  </div>
                  <span className="mono">{formatBytes(t.bytes)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card card-pad stack-sm">
            <b>Download traffic (egress)</b>
            <span className="hint">
              The free plan allows 5 GB a month of data sent to phones and laptops. The app can't read this itself; Supabase shows it on its usage page.
            </span>
            {dash && (
              <a className="btn" href={dash} target="_blank" rel="noreferrer noopener" style={{ alignSelf: 'flex-start' }}>
                <ExternalLink size={15} /> Open Supabase usage
              </a>
            )}
          </div>

          <span className="hint">Measured {formatDateTime(u.measured_at)}.</span>
        </div>
      ) : null}
    </div>
  )
}
