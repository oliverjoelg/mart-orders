import {
  Boxes,
  Ellipsis,
  History,
  LayoutDashboard,
  LogOut,
  Moon,
  PackageCheck,
  PackageOpen,
  Printer,
  Send,
  Shirt,
  Sun,
  Tag,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { can, type Action } from '../lib/permissions'
import { useData } from '../lib/store'
import { ROLE_LABEL, type Role } from '../lib/types'
import { Avatar, Modal, RoleBadge } from './ui'

interface NavItem {
  to: string
  label: string
  short?: string
  icon: LucideIcon
  group: string
  need?: Action
}

export const NAV: NavItem[] = [
  { to: '/desk', label: 'Handover desk', short: 'Desk', icon: PackageCheck, group: 'Desk' },
  { to: '/receive', label: 'Receive stock', short: 'Receive', icon: PackageOpen, group: 'Desk', need: 'setStatus' },
  { to: '/', label: 'Overview', icon: LayoutDashboard, group: 'Stock' },
  { to: '/items', label: 'Shirts', short: 'Shirts', icon: Shirt, group: 'Stock' },
  { to: '/inventory', label: 'Inventory', short: 'Stock', icon: Boxes, group: 'Stock' },
  { to: '/print', label: 'Vendor print list', icon: Printer, group: 'Stock' },
  { to: '/exports', label: 'Exports', short: 'Export', icon: Send, group: 'Students' },
  { to: '/import', label: 'Import CSV', icon: Upload, group: 'Data', need: 'import' },
  { to: '/activity', label: 'Activity', icon: History, group: 'Data' },
  { to: '/products', label: 'Products', icon: Tag, group: 'Settings' },
  { to: '/team', label: 'Team & roles', icon: Users, group: 'Admin', need: 'manageMembers' },
]

/** phone bottom bar: the first four tabs this role can use */
const BOTTOM_CANDIDATES = ['/desk', '/receive', '/items', '/exports', '/inventory']

type Theme = 'dark' | 'light'

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('mart-theme') as Theme | null) ?? 'dark'
    } catch {
      return 'dark'
    }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0f0f0f' : '#fbfbfb')
    try {
      localStorage.setItem('mart-theme', theme)
    } catch {
      /* private mode */
    }
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
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

function CampaignSelect() {
  const { campaigns, campaign, setCampaignId } = useData()
  if (campaigns.length <= 1) {
    return campaign ? <div className="hint" style={{ padding: '0 6px' }}>{campaign.name}</div> : null
  }
  return (
    <select
      className="select"
      aria-label="Sales round"
      value={campaign?.id ?? ''}
      onChange={(e) => setCampaignId(e.target.value)}
    >
      {campaigns.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
          {c.is_active ? '' : ' (closed)'}
        </option>
      ))}
    </select>
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
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { member, signOut } = useAuth()
  const [theme, toggleTheme] = useTheme()
  const [more, setMore] = useState(false)
  const location = useLocation()
  const role = member?.role
  const items = NAV.filter((n) => !n.need || can(role, n.need))
  const BOTTOM = BOTTOM_CANDIDATES.filter((to) => items.some((i) => i.to === to)).slice(0, 4)
  const groups = [...new Set(items.map((i) => i.group))]
  const current = NAV.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)))

  useEffect(() => setMore(false), [location.pathname])

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
                  <NavLink key={i.to} to={i.to} end={i.to === '/'} className="nav-link">
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
              <Avatar name={member.display_name} />
              <div className="who">
                <div style={{ fontWeight: 500 }}>{member.display_name}</div>
                <div className="hint">{member.email}</div>
              </div>
            </div>
          )}
          <div className="row between">
            {member && <RoleBadge role={member.role} />}
            <div className="row" style={{ gap: 2 }}>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={toggleTheme} aria-label="Switch theme" title="Switch theme">
                {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
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
          <div className="title">{current?.label ?? 'MART Orders'}</div>
          {member && <RoleBadge role={member.role} />}
        </header>
        {children}
      </div>

      <nav className="bottom-nav" aria-label="Main">
        {BOTTOM.map((to) => {
          const n = NAV.find((x) => x.to === to)!
          return (
            <NavLink key={to} to={to} end={to === '/'}>
              <n.icon size={20} strokeWidth={1.8} />
              {n.short ?? n.label}
            </NavLink>
          )
        })}
        <button type="button" onClick={() => setMore(true)} className={BOTTOM.includes(current?.to ?? '/desk') ? '' : 'active'}>
          <Ellipsis size={20} strokeWidth={1.8} />
          More
        </button>
      </nav>

      {more && (
        <Modal title="More" onClose={() => setMore(false)}>
          <div className="stack-sm">
            <CampaignSelect />
            <nav className="nav" style={{ padding: 0 }}>
              {items
                .filter((i) => !BOTTOM.includes(i.to))
                .map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'} className="nav-link" style={{ height: 44 }}>
                    <i.icon size={18} strokeWidth={1.8} />
                    {i.label}
                  </NavLink>
                ))}
            </nav>
            {member && (
              <div className="user-chip" style={{ paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <Avatar name={member.display_name} />
                <div className="who">
                  <div style={{ fontWeight: 500 }}>{member.display_name}</div>
                  <div className="hint">{member.email}</div>
                </div>
              </div>
            )}
            <div className="row">
              <button className="btn" style={{ flex: 1 }} onClick={toggleTheme}>
                {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                {theme === 'dark' ? 'Light theme' : 'Dark theme'}
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
