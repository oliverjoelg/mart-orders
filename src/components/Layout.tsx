import {
  Boxes,
  Gauge,
  Lock,
  Ellipsis,
  History,
  LayoutDashboard,
  LogOut,
  PackageCheck,
  PackageOpen,
  Palette,
  Printer,
  Send,
  Shirt,
  Tag,
  Upload,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { can, type Action } from '../lib/permissions'
import { useData } from '../lib/store'
import { PAGE_HINTS, type HintPath } from '../lib/hints'
import { allRoles } from '../lib/permissions'
import { memberLabel, type Role } from '../lib/types'
import { applyTheme, decorOn, savedTheme, setDecorOn, type ThemeDef } from '../lib/themes'
import ThemeDecor from './ThemeDecor'
import ThemePicker from './ThemePicker'
import { Avatar, Modal, RoleBadge } from './ui'

interface NavItem {
  to: HintPath
  label: string
  short?: string
  icon: LucideIcon
  group: string
  need?: Action
}

export const NAV: NavItem[] = [
  { to: '/desk', label: 'Handover desk', short: 'Hand over', icon: PackageCheck, group: 'Desk', need: 'pageDesk' },
  { to: '/receive', label: 'Receive stock', short: 'Receive', icon: PackageOpen, group: 'Desk', need: 'setStatus' },
  { to: '/', label: 'Overview', short: 'Home', icon: LayoutDashboard, group: 'Stock', need: 'pageHome' },
  { to: '/items', label: 'Items', short: 'Items', icon: Shirt, group: 'Stock', need: 'pageItems' },
  { to: '/inventory', label: 'Inventory', short: 'Stock', icon: Boxes, group: 'Stock', need: 'pageInventory' },
  { to: '/print', label: 'Vendor print list', icon: Printer, group: 'Stock', need: 'pagePrint' },
  { to: '/exports', label: 'Student lists', short: 'Lists', icon: Send, group: 'Students', need: 'pageLists' },
  { to: '/import', label: 'Add orders', icon: Upload, group: 'Data', need: 'import' },
  { to: '/payments', label: 'Payments', icon: Wallet, group: 'Students', need: 'pagePayments' },
  { to: '/activity', label: 'Activity', icon: History, group: 'Data', need: 'pageActivity' },
  { to: '/products', label: 'Products', icon: Tag, group: 'Settings', need: 'pageProducts' },
  { to: '/team', label: 'Roles & permissions', short: 'Team', icon: Users, group: 'Admin', need: 'manageMembers' },
  { to: '/usage', label: 'Usage', icon: Gauge, group: 'Admin', need: 'super' },
]

/** phone bottom bar: the first four tabs this role can use */
// Phone bottom bar = the everyday jobs. Everything else is under More.
const BOTTOM_CANDIDATES = ['/', '/desk', '/receive', '/exports', '/items', '/inventory', '/print', '/activity']

/** The theme picked on this device (fun themes live in lib/themes.ts). */
function useTheme() {
  const [theme, setTheme] = useState<ThemeDef>(() => savedTheme())
  const [decor, setDecor] = useState<boolean>(() => decorOn())
  useEffect(() => applyTheme(theme), [theme])
  return {
    theme,
    decor,
    pick: setTheme,
    setDecor: (on: boolean) => {
      setDecorOn(on)
      setDecor(on)
    },
  }
}

function BrandMark({ size = 16 }: { size?: number }) {
  return (
    <span className="brand-mark">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <path d="M7 24V8l9 9 9-9v16" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

/** Which sales round (e.g. "Batch Tees 2026", "Hoodies 2026") every page is showing. */
function CampaignSelect() {
  const { campaigns, campaign, setCampaignId } = useData()
  return (
    <div className="field" style={{ gap: 4 }}>
      <label htmlFor="round-select" className="label" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', paddingLeft: 2 }}>
        Sales round
      </label>
      {campaigns.length === 0 ? (
        <Link to="/products" className="btn btn-sm">Create a sales round</Link>
      ) : (
        <select id="round-select" className="select" title="Which sales round every page is showing" value={campaign?.id ?? ''} onChange={(e) => setCampaignId(e.target.value)}>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.is_active ? '' : ' (closed)'}
            </option>
          ))}
        </select>
      )}
      <Link to="/products" className="hint" style={{ paddingLeft: 2 }}>
        Rounds & products →
      </Link>
    </div>
  )
}

function DemoBanner() {
  const { api, member } = useAuth()
  if (api.mode !== 'demo') return null
  return (
    <div className="demo-banner">
      <span>Demo mode — made-up data, nothing is saved.</span>
      <label className="row" style={{ gap: 6 }}>
        View as
        <select
          className="select"
          value={member?.role}
          onChange={(e) => api.setDemoRole?.(e.target.value as Role)}
          aria-label="Demo role"
        >
          {allRoles().map((r) => (
            <option key={r.key} value={r.key as Role}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { member, signOut } = useAuth()
  const { campaign } = useData()
  const { theme, decor, pick, setDecor } = useTheme()
  const [more, setMore] = useState(false)
  const [picking, setPicking] = useState(false)
  const location = useLocation()
  const role = member?.role
  const items = NAV.filter((n) => !n.need || can(role, n.need))
  const BOTTOM = BOTTOM_CANDIDATES.filter((to) => items.some((i) => i.to === to)).slice(0, 4)
  const groups = [...new Set(items.map((i) => i.group))]
  const current = NAV.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)))

  useEffect(() => {
    setMore(false)
  }, [location.pathname])
  // every new page starts at the top (phones kept the previous page's scroll position)
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <div>
            MART Orders
            <small>MDI Gurgaon campus store</small>
          </div>
        </div>
        <div className="campaign-switch">
          <CampaignSelect />
        </div>
        <nav className="nav" aria-label="Main">
          {groups.map((g) => (
            <div key={g}>
              <div className="nav-group">{g}</div>
              {items
                .filter((i) => i.group === g)
                .map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'} className="nav-link" title={PAGE_HINTS[i.to]}>
                    <i.icon size={16} strokeWidth={1.8} />
                    {i.label}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          {member && (
            <div className="user-chip">
              <Avatar name={memberLabel(member)} />
              <div className="who">
                <div style={{ fontWeight: 500 }}>{memberLabel(member)}</div>
                <div className="hint">{member.email}</div>
              </div>
            </div>
          )}
          <div className="row between">
            {member && <RoleBadge role={member.role} />}
            <div className="row" style={{ gap: 2 }}>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setPicking(true)} aria-label="Change theme" title={`Theme: ${theme.name}. Click to change`}>
                <Palette size={15} />
              </button>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className="main">
        <DemoBanner />
        <header className="mobile-top">
          <BrandMark size={14} />
          <div className="title">MART Orders</div>
          {campaign && (
            <button type="button" className="round-chip" onClick={() => setMore(true)} aria-label={`Sales round: ${campaign.name}. Tap to change`}>
              {campaign.name}
            </button>
          )}
        </header>
        {campaign?.locked && (
          <div className="demo-banner" style={{ color: 'var(--amber)' }} role="status">
            <Lock size={13} /> “{campaign.name}” is locked: only super admins can see it, and nothing in it can be changed.
            <Link to="/products" style={{ textDecoration: 'underline' }}>Unlock on Products</Link>
          </div>
        )}
        {children}
      </div>

      <nav className="bottom-nav" aria-label="Main">
        {BOTTOM.map((to) => {
          const n = NAV.find((x) => x.to === to)!
          return (
            <NavLink key={to} to={to} end={to === '/'} title={PAGE_HINTS[n.to]}>
              <n.icon size={20} strokeWidth={1.8} />
              {n.short ?? n.label}
            </NavLink>
          )
        })}
        <button type="button" onClick={() => setMore(true)} className={current && BOTTOM.includes(current.to) ? '' : 'active'}>
          <Ellipsis size={20} strokeWidth={1.8} />
          More
        </button>
      </nav>

      <ThemeDecor decor={decor ? theme.decor : null} />
      {picking && (
        <ThemePicker
          current={theme}
          decor={decor}
          onPick={pick}
          onDecor={setDecor}
          onClose={() => setPicking(false)}
        />
      )}

      {more && (
        <Modal title="More" onClose={() => setMore(false)}>
          <div className="stack-sm">
            <CampaignSelect />
            <nav className="nav" style={{ padding: 0 }}>
              {items
                .filter((i) => !BOTTOM.includes(i.to))
                .map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'} className="nav-link nav-link-2line">
                    <i.icon size={18} strokeWidth={1.8} />
                    <span className="nav-text">
                      {i.label}
                      <small>{PAGE_HINTS[i.to]}</small>
                    </span>
                  </NavLink>
                ))}
            </nav>
            {member && (
              <div className="user-chip" style={{ paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <Avatar name={memberLabel(member)} />
                <div className="who">
                  <div style={{ fontWeight: 500 }}>{memberLabel(member)}</div>
                  <div className="hint">{member.email}</div>
                </div>
                <RoleBadge role={member.role} />
              </div>
            )}
            <div className="row">
              <button
                className="btn"
                style={{ flex: 1 }}
                onClick={() => {
                  setMore(false)
                  setPicking(true)
                }}
              >
                <Palette size={15} /> Theme: {theme.emoji} {theme.name}
              </button>
              <button className="btn" style={{ flex: 1 }} onClick={() => void signOut()}>
                <LogOut size={15} /> Sign out
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
