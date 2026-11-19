import { Lock } from 'lucide-react'
import { useAuth } from '../lib/auth'

export default function NotApproved() {
  const { user, signOut } = useAuth()
  return (
    <div className="login">
      <div className="card login-card">
        <div className="empty" style={{ padding: 0 }}>
          <div className="icon">
            <Lock size={20} />
          </div>
          <h3>Not on the MART team list</h3>
          <p>
            You're signed in as <span className="mono">{user?.email}</span>, but this account isn't an active MART
            team member. Ask the MART super admin or an admin to add you.
          </p>
        </div>
        <button className="btn btn-block" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  )
}
