import { AlertTriangle, CheckCircle2, FileSpreadsheet, Info, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { PageHead, Segmented, Stat } from '../components/ui'
import { friendlyError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { plural, inr } from '../lib/format'
import { describeColumnMap } from '../lib/import/headers'
import { canInclude, ISSUE_LABEL, parseFormCsv, type ImportPreview, type IssueCode, type ParsedItem } from '../lib/import/parseForm'
import { useData } from '../lib/store'

type View = 'all' | 'issues' | 'excluded'

const ISSUE_CLASS: Record<IssueCode, string> = {
  unknown_product: 'badge badge-red',
  missing_roll: 'badge badge-red',
  missing_size: 'badge badge-red',
  custom_size: 'badge badge-amber',
  size_not_offered: 'badge badge-amber',
  duplicate: 'badge badge-amber',
  already_imported: 'badge',
}

export default function Import() {
  const { products, productsById, campaign, snapshot, buyersById, refresh } = useData()
  const { api } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [include, setInclude] = useState<Record<string, boolean>>({})
  const [view, setView] = useState<View>('all')
  const [busy, setBusy] = useState(false)

  const existing = useMemo(
    () =>
      (snapshot?.items ?? [])
        .filter((i) => i.campaign_id === campaign?.id)
        .map((i) => ({
          roll_no: buyersById.get(i.buyer_id)?.roll_no ?? '',
          product_id: i.product_id,
          size: i.size,
          print_name: i.print_name,
          source_timestamp: i.source_timestamp,
          source_slot: i.source_slot,
        })),
    [snapshot, campaign, buyersById],
  )

  const load = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.err('Choose a .csv file. In Google Sheets: File → Download → Comma-separated values.')
      return
    }
    const text = await file.text()
    const p = parseFormCsv(text, products, existing)
    setFileName(file.name)
    setPreview(p)
    setInclude(Object.fromEntries(p.items.map((i) => [i.key, i.include])))
    setView(p.items.some((i) => i.issues.length) ? 'issues' : 'all')
  }

  const chosen = preview?.items.filter((i) => include[i.key]) ?? []
  const mismatches = preview?.responses.filter((r) => r.declared_total !== null && r.declared_total !== r.shirts) ?? []

  const shown = (preview?.items ?? []).filter((i) =>
    view === 'all' ? true : view === 'issues' ? i.issues.length > 0 : !include[i.key],
  )

  const save = async () => {
    if (!preview || !campaign) return
    setBusy(true)
    try {
      const rolls = new Set(chosen.map((i) => i.roll_no))
      const res = await api.importOrders({
        campaignId: campaign.id,
        fileName,
        responses: new Set(chosen.map((i) => i.row)).size,
        duplicatesSkipped: preview.items.filter((i) => i.issues.includes('duplicate') && !include[i.key]).length,
        buyers: preview.buyers.filter((b) => rolls.has(b.roll_no)),
        items: chosen.map((i) => ({
          roll_no: i.roll_no,
          product_id: i.product_id!,
          size: i.size,
          print_name: i.print_name,
          batch: i.batch,
          source_timestamp: i.source_timestamp,
          source_slot: i.slot,
        })),
      })
      toast.ok(`Imported ${plural(res.items_created, 'shirt')}`)
      await refresh()
      navigate('/items')
    } catch (e) {
      toast.err(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <PageHead
        title="Import Google Form responses"
        sub={campaign ? `Into ${campaign.name}. Each response becomes one row per shirt.` : 'Create a sales round on the Products page first.'}
        actions={
          preview && (
            <>
              <button className="btn" onClick={() => { setPreview(null); setFileName('') }}>
                Start over
              </button>
              <button className="btn btn-primary" disabled={!chosen.length || busy || !!preview.fatal.length} onClick={() => void save()}>
                <Upload size={15} /> Import {plural(chosen.length, 'shirt')}
              </button>
            </>
          )
        }
      />

      {!preview && (
        <div className="stack">
          <label
            className={`dropzone${over ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              const f = e.dataTransfer.files[0]
              if (f) void load(f)
            }}
          >
            <span className="empty" style={{ padding: 0 }}>
              <span className="icon"><FileSpreadsheet size={20} /></span>
            </span>
            <b style={{ fontWeight: 600 }}>Drop the responses CSV here, or click to choose</b>
            <span className="hint">Google Sheets → File → Download → Comma-separated values (.csv). The file is read in your browser; only the shirts you approve are saved.</span>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
          </label>
          <div className="callout">
            <Info size={15} />
            <div>
              Re-importing the same sheet later is safe: responses already in MART Orders are skipped, and a roll number ordering
              the same shirt again is held back as a possible duplicate for you to review.
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="stack">
          {preview.fatal.map((f) => (
            <div key={f} className="callout err"><AlertTriangle size={15} />{f}</div>
          ))}

          <div className="stats">
            <Stat label="Responses" value={preview.stats.responses} sub={`${plural(preview.stats.blankRows, 'blank row')} skipped`} />
            <Stat label="Shirts found" value={preview.stats.shirts} sub={`form “Total” says ${preview.stats.declaredTotal}`} />
            <Stat label="To import" value={chosen.length} accent sub={`${plural(new Set(chosen.map((i) => i.roll_no)).size, 'student')}`} />
            <Stat label="Possible duplicates" value={preview.stats.duplicates} sub="held back unless you tick them" />
            <Stat label="Already imported" value={preview.stats.alreadyImported} sub="skipped" />
            <Stat label="Can't import" value={preview.stats.blocked} sub="unknown colour / no roll no." />
          </div>

          {mismatches.length > 0 && (
            <div className="card">
              <div className="card-head">
                <h3>Shirt count differs from the form's “Total” in {plural(mismatches.length, 'response')}</h3>
              </div>
              <div className="card-body stack-sm">
                <span className="hint">Usually a typo in the total. “Amount paid” helps tell which number is right.</span>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Roll no.</th>
                        <th className="right">Form total</th>
                        <th className="right">Shirts found</th>
                        <th className="right">Amount paid</th>
                        <th className="right">Price of shirts found</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mismatches.map((r) => (
                        <tr key={r.row}>
                          <td className="mono">{r.row}</td>
                          <td className="mono">{r.roll_no}</td>
                          <td className="right num">{r.declared_total}</td>
                          <td className="right num">{r.shirts}</td>
                          <td className="right num">{r.amount_paid !== null ? inr(r.amount_paid) : '—'}</td>
                          <td className="right num">
                            {inr(r.expected_amount)}{' '}
                            {r.amount_paid === r.expected_amount && <CheckCircle2 size={13} style={{ color: 'var(--accent)', verticalAlign: -2 }} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <details className="disclosure card card-pad">
            <summary><Info size={14} /> How the columns were read</summary>
            <ul className="hint" style={{ margin: '10px 0 0', paddingLeft: 18 }}>
              {describeColumnMap(preview.headers, preview.columns).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>

          <div className="row between">
            <Segmented
              label="Show"
              value={view}
              onChange={setView}
              options={[
                { value: 'all', label: `All (${preview.items.length})` },
                { value: 'issues', label: `Needs a look (${preview.items.filter((i) => i.issues.length).length})` },
                { value: 'excluded', label: `Not importing (${preview.items.length - chosen.length})` },
              ]}
            />
          </div>

          <div className="table-wrap" style={{ maxHeight: '60vh' }}>
            <table className="table">
              <thead>
                <tr>
                  <th className="check-col" />
                  <th>Row</th>
                  <th>Roll no.</th>
                  <th>Name</th>
                  <th>Product</th>
                  <th>Size</th>
                  <th>Back print</th>
                  <th>Batch</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 600).map((i) => (
                  <PreviewRow
                    key={i.key}
                    item={i}
                    on={!!include[i.key]}
                    productName={i.product_id ? productsById.get(i.product_id)?.name : undefined}
                    onToggle={() => setInclude({ ...include, [i.key]: !include[i.key] })}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {shown.length > 600 && <span className="hint">Showing the first 600 rows of {shown.length}.</span>}
        </div>
      )}
    </div>
  )
}

function PreviewRow({
  item,
  on,
  productName,
  onToggle,
}: {
  item: ParsedItem
  on: boolean
  productName?: string
  onToggle(): void
}) {
  const ok = canInclude(item)
  return (
    <tr className={on ? '' : 'subtle'}>
      <td className="check-col">
        <input type="checkbox" checked={on} disabled={!ok} onChange={onToggle} aria-label={`Import row ${item.row} shirt ${item.slot}`} />
      </td>
      <td className="mono nowrap">
        {item.row}
        <span className="subtle">·{item.slot}</span>
      </td>
      <td className="mono nowrap">{item.roll_no || '—'}</td>
      <td className="nowrap">{item.buyer_name}</td>
      <td className="nowrap">{productName ?? <span title={item.colour_raw}>{item.colour_raw || '—'}</span>}</td>
      <td className="mono">{item.size || '—'}</td>
      <td>{item.print_name ?? <span className="subtle">—</span>}</td>
      <td className="nowrap">{item.batch ?? '—'}</td>
      <td>
        <div className="row" style={{ gap: 4 }}>
          {item.issues.map((c) => (
            <span key={c} className={ISSUE_CLASS[c]} title={item.duplicateOf}>
              {ISSUE_LABEL[c]}
            </span>
          ))}
          {item.duplicateOf && <span className="hint">{item.duplicateOf}</span>}
        </div>
      </td>
    </tr>
  )
}
