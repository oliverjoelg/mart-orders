import { Copy, Download, Mail, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useToast } from '../components/Toast'
import { Empty, PageHead, Segmented, Switch } from '../components/ui'
import { copyText, downloadCsv, fileStamp } from '../lib/csv'
import { buildExport, emailList, EXPORT_LABEL, exportRows, rollList, type ExportFilters, type ExportKind } from '../lib/exports'
import { plural } from '../lib/format'
import { compareSizes } from '../lib/import/normalize'
import { useData } from '../lib/store'

const KINDS: ExportKind[] = ['call_list', 'not_arrived', 'collected']

export default function Exports() {
  const { items, products, memberName, campaign } = useData()
  const toast = useToast()
  const [kind, setKind] = useState<ExportKind>('call_list')
  const [f, setF] = useState<ExportFilters>({ includePartly: false })

  const sizes = useMemo(() => [...new Set(items.map((i) => i.size))].sort(compareSizes), [items])
  const batches = useMemo(() => [...new Set(items.map((i) => i.batch ?? i.buyer.batch).filter(Boolean) as string[])].sort(), [items])
  const sections = useMemo(() => [...new Set(items.map((i) => i.buyer.section).filter(Boolean) as string[])].sort(), [items])
  const lines = useMemo(() => buildExport(items, kind, f, (id) => memberName(id)), [items, kind, f, memberName])
  const shirts = lines.reduce((n, l) => n + l.count, 0)
  const noEmail = lines.filter((l) => !l.email).length

  const copy = async (text: string, what: string) => {
    await copyText(text)
    toast.ok(`Copied ${what}`)
  }

  return (
    <div className="page">
      <PageHead title="Exports" sub="One line per student. Copy roll numbers or emails for the “come collect” mail." hideTitleOnMobile />

      <div className="stack">
        <Segmented
          label="Which students"
          value={kind}
          onChange={setKind}
          options={KINDS.map((k) => ({ value: k, label: EXPORT_LABEL[k] }))}
        />

        <div className="card card-pad stack">
          <div className="row between">
            <div>
              <div className="stat-value">{plural(lines.length, 'student')}</div>
              <div className="hint">
                {plural(shirts, 'shirt')}
                {noEmail > 0 && ` · ${noEmail} without an email`}
                {campaign && ` · ${campaign.name}`}
              </div>
            </div>
            {kind === 'call_list' && (
              <Switch
                checked={!!f.includePartly}
                onChange={(v) => setF({ ...f, includePartly: v })}
                label="Include partly arrived"
              />
            )}
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={!lines.length} onClick={() => void copy(rollList(lines), plural(lines.length, 'roll number'))}>
              <Copy size={15} /> Copy roll numbers
            </button>
            <button
              className="btn"
              disabled={!lines.length || noEmail === lines.length}
              onClick={() => void copy(emailList(lines), `${plural(lines.length - noEmail, 'email')} (paste into Bcc)`)}
            >
              <Mail size={15} /> Copy emails
            </button>
            <button
              className="btn"
              disabled={!lines.length}
              onClick={() => downloadCsv(`mart-${kind.replace('_', '-')}-${fileStamp()}.csv`, exportRows(lines, kind))}
            >
              <Download size={15} /> CSV
            </button>
          </div>
          {kind === 'call_list' && (
            <span className="hint">
              {f.includePartly
                ? 'Students with at least one shirt in MART, even if others are still with the vendor.'
                : 'Students whose shirts are all in MART (nothing still with the vendor), so they only come once.'}
            </span>
          )}
        </div>

        <div className="toolbar" style={{ marginBottom: 0 }}>
          <select className="select" value={f.productId ?? ''} onChange={(e) => setF({ ...f, productId: e.target.value || undefined })} aria-label="Product">
            <option value="">All products</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select className="select" value={f.size ?? ''} onChange={(e) => setF({ ...f, size: e.target.value || undefined })} aria-label="Size">
            <option value="">All sizes</option>
            {sizes.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select className="select" value={f.batch ?? ''} onChange={(e) => setF({ ...f, batch: e.target.value || undefined })} aria-label="Batch">
            <option value="">All batches</option>
            {batches.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select className="select" value={f.section ?? ''} onChange={(e) => setF({ ...f, section: e.target.value || undefined })} aria-label="Section">
            <option value="">All sections</option>
            {sections.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {lines.length === 0 ? (
          <div className="card">
            <Empty icon={<Send size={20} />} title="Nobody in this list">
              {kind === 'call_list' ? 'No shirts are waiting in MART for these filters.' : 'Try other filters.'}
            </Empty>
          </div>
        ) : (
          <div className="table-wrap cards-on-mobile">
            <table className="table">
              <thead>
                <tr>
                  <th>Roll no.</th>
                  <th>Name</th>
                  <th>Shirts</th>
                  <th>Email</th>
                  <th>Section</th>
                  {kind === 'call_list' && <th className="right">Still with vendor</th>}
                  {kind === 'collected' && <th>Collected by</th>}
                  {kind === 'collected' && <th>Handed over by</th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.roll_no}>
                    <td className="mono nowrap">{l.roll_no}</td>
                    <td className="nowrap">{l.name}</td>
                    <td>{l.shirts}</td>
                    <td className="muted">{l.email ?? <span className="badge badge-amber">no email</span>}</td>
                    <td className="nowrap">{l.section ?? '—'}</td>
                    {kind === 'call_list' && <td className="right num">{l.pending || <span className="subtle">0</span>}</td>}
                    {kind === 'collected' && <td>{l.collectedBy}</td>}
                    {kind === 'collected' && <td className="muted">{l.handedBy}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="list-cards">
              {lines.map((l) => (
                <div key={l.roll_no} className="list-card">
                  <div className="body">
                    <div className="row between">
                      <span className="title">{l.name || l.roll_no}</span>
                      <span className="mono hint">{l.roll_no}</span>
                    </div>
                    <div className="hint">{l.shirts}</div>
                    {kind === 'collected' && <div className="hint">Collected by {l.collectedBy}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
