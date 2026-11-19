import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { initials } from '../lib/format'
import { isSuperRole, roleName } from '../lib/permissions'
import { STATUS_LABEL, type ItemStatus, type Product, type Role } from '../lib/types'

const STATUS_CLASS: Record<ItemStatus, string> = {
  ordered: 'badge',
  sent_to_vendor: 'badge badge-amber',
  received: 'badge badge-green',
  handed_over: 'badge badge-blue',
}

export const STATUS_COLOR: Record<ItemStatus, string> = {
  ordered: 'var(--text-subtle)',
  sent_to_vendor: 'var(--amber)',
  received: 'var(--accent)',
  handed_over: 'var(--blue)',
}

export function StatusBadge({ status }: { status: ItemStatus }) {
  return (
    <span className={STATUS_CLASS[status]}>
      <span className="dot" />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function RoleBadge({ role }: { role: Role }) {
  const cls = isSuperRole(role) ? 'badge badge-green' : role === 'admin' ? 'badge badge-blue' : 'badge'
  return <span className={`${cls} badge-square`}>{roleName(role)}</span>
}

const SWATCH: Record<string, string> = {
  navy: 'var(--navy)',
  blue: 'var(--navy)',
  pink: 'var(--pink)',
  black: 'var(--black)',
  white: 'var(--white)',
}

export function swatchColour(colour: string): string {
  const key = Object.keys(SWATCH).find((k) => colour.toLowerCase().includes(k))
  return key ? SWATCH[key] : 'var(--surface-3)'
}

export function ProductLabel({ product, short = false }: { product: Product; short?: boolean }) {
  return (
    <span className="product-cell">
      <span className="swatch" style={{ background: swatchColour(product.colour) }} />
      {short ? product.colour : product.name}
    </span>
  )
}

export function Avatar({ name }: { name: string }) {
  return <span className="avatar">{initials(name)}</span>
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Loading" />
}

export function PageHead({
  title,
  sub,
  actions,
  hideTitleOnMobile,
}: {
  title: string
  sub?: ReactNode
  actions?: ReactNode
  hideTitleOnMobile?: boolean
}) {
  return (
    <div className={`page-head${hideTitleOnMobile ? ' hide-mobile-title' : ''}`}>
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function Stat({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  accent?: boolean
}) {
  return (
    <div className={`stat${accent ? ' accent' : ''}`}>
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: NoInfer<T>; label: ReactNode }[]
  onChange: (v: NoInfer<T>) => void
  label: string
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label}
    </label>
  )
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose(): void
  children: ReactNode
  footer?: ReactNode
}) {
  useEscape(onClose)
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Drawer({
  title,
  onClose,
  children,
  footer,
}: {
  title: ReactNode
  onClose(): void
  children: ReactNode
  footer?: ReactNode
}) {
  useEscape(onClose)
  return (
    <div className="overlay drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </aside>
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="empty">
      <Spinner />
      <p>{label}</p>
    </div>
  )
}
