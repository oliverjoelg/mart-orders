import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Info, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { PageHead, Segmented, Stat } from '../components/ui'
import { friendlyError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { plural, inr } from '../lib/format'
import { describeColumnMap } from '../lib/import/headers'
import { canInclude, ISSUE_LABEL, parseFormRows, type ImportPreview, type IssueCode, type ParsedItem } from '../lib/import/parseForm'
import { buildColumnMap } from '../lib/import/headers'
import { ACCEPTED_FILES, downloadXlsx, isSpreadsheetName, readSpreadsheet, type Sheet } from '../lib/import/readFile'
import { buildSampleRows, sampleInstructions } from '../lib/import/sample'
import { useData } from '../lib/store'
import ManualOrder from './ManualOrder'

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
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [sheetName, setSheetName] = useState('')
  const [include, setInclude] = useState<Record<string, boolean>>({})
  const [view, setView] = useState<View>('all')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'csv' | 'manual'>('csv')

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

  const usePreview = (sheet: Sheet, all: Sheet[], name: string) => {
    const p = parseFormRows(sheet.rows[0] ?? [], sheet.rows.slice(1), products, existing)
    setFileName(all.length > 1 ? `${name} (${sheet.name})` : name)
    setSheets(all)
    setSheetName(sheet.name)
    setPreview(p)
    setInclude(Object.fromEntries(p.items.map((i) => [i.key, i.include])))
    setView(p.items.some((i) => i.issues.length) ? 'issues' : 'all')
  }

  const load = async (file: File) => {
    if (!isSpreadsheetName(file.name)) {
      toast.err('Choose a CSV or Excel file (.csv, .xlsx, .xls or .ods).')
      return
    }
    try {
      const all = await readSpreadsheet(file)
      if (all.length === 0) {
        toast.err('That file looks empty.')
        return
      }
      // pick the first tab that has a roll-number column (the orders), else the first tab
      const best = all.find((sh) => buildColumnMap(sh.rows[0] ?? []).roll !== undefined) ?? all[0]
      usePreview(best, all, file.name)
    } catch (e) {
      toast.err(`Couldn't read that file: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const downloadSample = () =>
    void downloadXlsx(`MART order file - sample${campaign ? ` - ${campaign.name}` : ''}.xlsx`, [
      { name: 'Orders', rows: buildSampleRows(products) },
      { name: 'How to fill', rows: sampleInstructions(products) },
    ])

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
      toast.ok(`Imported ${plural(res.items_created, 'item')}`)
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
        title="Add orders"
        sub={
          campaign ? (
            <>
              Into the sales round <b style={{ color: 'var(--text)' }}>{campaign.name}</b>. Switch rounds at the top left.
            </>
          ) : (
            'Create a sales round on the Products page first.'
          )
        }
        actions={
          preview && (
            <>
              <button className="btn" onClick={() => { setPreview(null); setFileName('') }}>
                Start over
              </button>
              <button className="btn btn-primary" disabled={!chosen.length || busy || !!preview.fatal.length} onClick={() => void save()}>
                <Upload size={15} /> Import {plural(chosen.length, 'item')}
              </button>
            </>
          )
        }
      />

      {!preview && (
        <div style={{ marginBottom: 16 }}>
          <Segmented
            label="How"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'csv', label: 'From the Google Form (CSV)' },
              { value: 'manual', label: 'One order by hand' },
            ]}
          />
        </div>
      )}

      {!preview && mode === 'manual' && <ManualOrder />}

      {!preview && mode === 'csv' && (
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
            <b style={{ fontWeight: 600 }}>Drop the order file here, or tap to choose</b>
            <span className="hint">Excel (.xlsx, .xls), OpenOffice (.ods) or CSV. From Google Sheets: File → Download → Microsoft Excel. The file is read on this device; only the items you approve are saved.</span>
            <input ref={fileRef} type="file" accept={ACCEPTED_FILES} className="sr-only" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
          </label>
          <div className="card card-pad row between">
            <div>
              <b style={{ fontWeight: 600 }}>Not sure of the format?</b>
              <div className="hint">
                Download a sample file with the right columns and this round's products filled in. It has a “How to fill” tab.
              </div>
            </div>
            <button className="btn" onClick={downloadSample} disabled={products.length === 0}>
              <Download size={15} /> Download sample file
            </button>
          </div>
          <div className="callout">
            <Info size={15} />
            <div>
              Re-importing the same sheet later is safe: responses already in MART Orders are skipped, and a roll number ordering
              the same item again is held back as a possible duplicate for you to review.
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="stack">
          {sheets.length > 1 && (
            <div className="field" style={{ maxWidth: 360 }}>
              <label htmlFor="sheet-pick">This file has {sheets.length} tabs. Which one has the orders?</label>
              <select
                id="sheet-pick"
                className="select"
                value={sheetName}
                onChange={(e) => usePreview(sheets.find((sh) => sh.name === e.target.value)!, sheets, fileName.replace(/ \(.*\)$/, ''))}
              >
                {sheets.map((sh) => (
                  <option key={sh.name} value={sh.name}>{sh.name} ({Math.max(sh.rows.length - 1, 0)} rows)</option>
                ))}
              </select>
            </div>
          )}
          {preview.fatal.map((f) => (
            <div key={f} className="callout err"><AlertTriangle size={15} />{f}</div>
          ))}

          <div className="stats">
            <Stat label="Responses" value={preview.stats.responses} sub={`${plural(preview.stats.blankRows, 'blank row')} skipped`} />
            <Stat label="Items found" value={preview.stats.shirts} sub={`form “Total” says ${preview.stats.declaredTotal}`} />
            <Stat label="To import" value={chosen.length} accent sub={`${plural(new Set(chosen.map((i) => i.roll_no)).size, 'student')}`} />
            <Stat label="Possible duplicates" value={preview.stats.duplicates} sub="held back unless you tick them" />
            <Stat label="Already imported" value={preview.stats.alreadyImported} sub="skipped" />
            <Stat label="Can't import" value={preview.stats.blocked} sub="unknown colour / no roll no." />
          </div>

          {mismatches.length > 0 && (
            <div className="card">
              <div className="card-head">
                <h3>Item count differs from the form's “Total” in {plural(mismatches.length, 'response')}</h3>
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
                        <th className="right">Items found</th>
                        <th className="right">Amount paid</th>
                        <th className="right">Price of items found</th>
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
        <input type="checkbox" checked={on} disabled={!ok} onChange={onToggle} aria-label={`Import row ${item.row} item ${item.slot}`} />
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
