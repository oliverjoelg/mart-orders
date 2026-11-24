import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout, NAV } from './components/Layout'
import { ToastProvider } from './components/Toast'
import { Empty, Spinner } from './components/ui'
import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Api } from './lib/api'
import { AuthProvider, useAuth } from './lib/auth'
import { can, type Action } from './lib/permissions'
import { DataProvider, useData } from './lib/store'
import Activity from './pages/Activity'
import Payments from './pages/Payments'
import Exports from './pages/Exports'
import Handover from './pages/Handover'
import Import from './pages/Import'
import Inventory from './pages/Inventory'
import Items from './pages/Items'
import Login from './pages/Login'
import NotApproved from './pages/NotApproved'
import Overview from './pages/Overview'
import PrintList from './pages/PrintList'
import Products from './pages/Products'
import Receive from './pages/Receive'
import Team from './pages/Team'
import Usage from './pages/Usage'

/** Shows a page only if the signed-in role has its tick; otherwise goes to the first page it can see. */
function Allowed({ need, children }: { need: Action; children: ReactNode }) {
  const { member } = useAuth()
  useData() // re-render when roles/ticks load
  const role = member?.role
  if (can(role, need)) return <>{children}</>
  const first = NAV.find((n) => !n.need || can(role, n.need))
  if (first) return <Navigate to={first.to} replace />
  return (
    <div className="page narrow">
      <Empty icon={<Lock size={20} />} title="No pages are switched on for your role">
        Ask the MART super admin to tick some pages for your role on Roles &amp; permissions.
      </Empty>
    </div>
  )
}

const allow = (need: Action, el: ReactNode) => <Allowed need={need}>{el}</Allowed>

function Shell() {
  const { status, member } = useAuth()
  if (status === 'loading') {
    return (
      <div className="center-screen">
        <Spinner />
      </div>
    )
  }
  if (status === 'signed_out' || status === 'error') return <Login />
  if (status === 'not_member') return <NotApproved />
  return (
    <DataProvider key={member?.id}>
      <Layout>
        <Gate>
          <Routes>
            {/* each page needs its tick on Roles & permissions; the first allowed page is home */}
            <Route path="/" element={allow('pageHome', <Overview />)} />
            <Route path="/desk" element={allow('pageDesk', <Handover />)} />
            <Route path="/items" element={allow('pageItems', <Items />)} />
            <Route path="/inventory" element={allow('pageInventory', <Inventory />)} />
            <Route path="/print" element={allow('pagePrint', <PrintList />)} />
            <Route path="/exports" element={allow('pageLists', <Exports />)} />
            <Route path="/import" element={allow('import', <Import />)} />
            <Route path="/activity" element={allow('pageActivity', <Activity />)} />
            <Route path="/payments" element={allow('pagePayments', <Payments />)} />
            <Route path="/products" element={allow('pageProducts', <Products />)} />
            <Route path="/receive" element={allow('setStatus', <Receive />)} />
            <Route path="/team" element={allow('manageMembers', <Team />)} />
            <Route path="/usage" element={allow('super', <Usage />)} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Gate>
      </Layout>
    </DataProvider>
  )
}

/** Shows a loader or the load error before any page renders. */
function Gate({ children }: { children: ReactNode }) {
  const { loading, error, snapshot, refresh } = useData()
  if (loading && !snapshot) {
    return (
      <div className="page">
        <div className="empty">
          <Spinner />
          <p>Loading stock…</p>
        </div>
      </div>
    )
  }
  if (error && !snapshot) {
    return (
      <div className="page narrow">
        <div className="callout err" style={{ marginBottom: 12 }}>
          Could not load data: {error}
        </div>
        <button className="btn" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    )
  }
  return <>{children}</>
}

export default function App({ api }: { api: Api }) {
  return (
    <ToastProvider>
      <AuthProvider api={api}>
        <HashRouter>
          <Shell />
        </HashRouter>
      </AuthProvider>
    </ToastProvider>
  )
}
