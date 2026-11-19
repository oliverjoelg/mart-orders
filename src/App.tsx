import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ToastProvider } from './components/Toast'
import { Spinner } from './components/ui'
import type { Api } from './lib/api'
import { AuthProvider, useAuth } from './lib/auth'
import { can } from './lib/permissions'
import { DataProvider, useData } from './lib/store'
import Activity from './pages/Activity'
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
            <Route path="/" element={<Overview />} />
            <Route path="/desk" element={<Handover />} />
            <Route path="/items" element={<Items />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/print" element={<PrintList />} />
            <Route path="/exports" element={<Exports />} />
            <Route path="/import" element={can(member?.role, 'import') ? <Import /> : <Navigate to="/" replace />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/products" element={<Products />} />
            <Route path="/receive" element={<Receive />} />
            <Route path="/team" element={can(member?.role, 'manageMembers') ? <Team /> : <Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Gate>
      </Layout>
    </DataProvider>
  )
}

/** Shows a loader or the load error before any page renders. */
function Gate({ children }: { children: React.ReactNode }) {
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
