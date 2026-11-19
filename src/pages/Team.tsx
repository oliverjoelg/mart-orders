import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '../components/Toast'
import { Avatar, Modal, PageHead, RoleBadge, Switch } from '../components/ui'
import { friendlyError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { assignableRoles, can } from '../lib/permissions'
import { useData } from '../lib/store'
import { memberLabel, ROLE_LABEL, type Member, type Role } from '../lib/types'

const ROLE_HELP: Record<Role, string> = {
  main_admin: 'Everything. Adds and removes anyone, including other super admins',
  admin: 'Imports, edit items and products, undo handovers, delete items; adds admins and ops (cannot remove members or touch a super admin)',
  ops: 'Receive stock, hand over, exports, notes. Cannot delete anything',
}

export default function Team() {
  const { snapshot, refresh } = useData()
  const { api, member } = useAuth()
  const toast = useToast()
  const [editing, setEditing] = useState<Partial<Member> | null>(null)
  const role = member?.role
  const roles = assignableRoles(role)
  const members = [...(snapshot?.members ?? [])].sort(
    (a, b) => Number(b.active) - Number(a.active) || memberLabel(a).localeCompare(memberLabel(b)),
  )
  const canEdit = (m: Member) => can(role, 'manageMembers') && (role === 'main_admin' || roles.includes(m.role))

  return (
    <div className="page">
      <PageHead
        title="Team & roles"
        sub="Only people on this list can sign in, with their @mdi.ac.in Google account. Only admins see this page."
        actions={
          can(role, 'manageMembers') && (
            <button className="btn btn-primary" onClick={() => setEditing({ role: 'ops', active: true })}>
              <UserPlus size={15} /> Add member
            </button>
          )
        }
      />

      <div className="stack">
        <div className="table-wrap cards-on-mobile">
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className={m.active ? '' : 'subtle'}>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <Avatar name={memberLabel(m)} />
                      <span style={{ fontWeight: 500 }}>{memberLabel(m)}</span>
                      {m.nickname && m.user_id && <span className="hint">({m.display_name})</span>}
                      {m.id === member?.id && <span className="badge">You</span>}
                      {!m.user_id && <span className="badge badge-amber">Not signed in yet</span>}
                    </div>
                  </td>
                  <td className="mono muted">{m.email}</td>
                  <td><RoleBadge role={m.role} /></td>
                  <td>{m.active ? <span className="badge badge-green">Active</span> : <span className="badge">Off</span>}</td>
                  <td className="right">
                    {canEdit(m) && (
                      <button className="btn btn-sm" onClick={() => setEditing(m)}>Edit</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="list-cards">
            {members.map((m) => (
              <div key={m.id} className="list-card" onClick={() => canEdit(m) && setEditing(m)}>
                <Avatar name={memberLabel(m)} />
                <div className="body">
                  <div className="row between">
                    <span className="title">{memberLabel(m)}</span>
                    <RoleBadge role={m.role} />
                  </div>
                  <div className="hint mono">{m.email}{m.active ? '' : ' · off'}{m.user_id ? '' : ' · not signed in yet'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card card-pad stack-sm">
          <span className="label">What each role can do</span>
          {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
            <div key={r} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <span style={{ minWidth: 92 }}><RoleBadge role={r} /></span>
              <span className="muted">{ROLE_HELP[r]}</span>
            </div>
          ))}
          <span className="hint">These rules are enforced by the database, not only hidden in the app.</span>
        </div>
      </div>

      {editing && (
        <MemberModal
          initial={editing}
          roles={roles}
          onClose={() => setEditing(null)}
          onSave={async (m) => {
            try {
              await api.saveMember(m)
              toast.ok(m.id ? 'Member updated' : `${m.nickname || m.email} can now sign in`)
              setEditing(null)
              await refresh()
            } catch (e) {
              toast.err(friendlyError(e))
            }
          }}
          onRemove={
            role === 'main_admin' && editing.id && editing.id !== member?.id
              ? async () => {
                  try {
                    await api.deleteMember(editing.id!)
                    toast.ok('Removed from the team')
                    setEditing(null)
                    await refresh()
                  } catch (e) {
                    toast.err(friendlyError(e))
                  }
                }
              : undefined
          }
        />
      )}
    </div>
  )
}

function MemberModal({
  initial,
  roles,
  onClose,
  onSave,
  onRemove,
}: {
  initial: Partial<Member>
  roles: Role[]
  onClose(): void
  onSave(m: { id?: string; email: string; display_name: string; nickname: string | null; role: Role; active: boolean }): Promise<void>
  /** only passed for the super admin, on existing members */
  onRemove?(): Promise<void>
}) {
  const [m, setM] = useState({
    id: initial.id,
    email: initial.email ?? '',
    display_name: initial.display_name ?? '',
    nickname: initial.nickname ?? '',
    role: (initial.role ?? 'ops') as Role,
    active: initial.active ?? true,
  })
  const [busy, setBusy] = useState(false)
  const signedIn = !!initial.user_id
  const emailOk = /^[^@\s]+@mdi\.ac\.in$/i.test(m.email.trim())
  const options = roles.includes(m.role) ? roles : [m.role, ...roles]

  return (
    <Modal
      title={m.id ? 'Edit member' : 'Add member'}
      onClose={onClose}
      footer={
        <>
          {onRemove && (
            <button
              className="btn btn-danger"
              style={{ marginRight: 'auto' }}
              disabled={busy}
              onClick={async () => {
                if (!window.confirm(`Remove ${m.nickname || m.display_name} from the team? They will no longer be able to sign in.`)) return
                setBusy(true)
                await onRemove()
                setBusy(false)
              }}
            >
              Remove
            </button>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!emailOk || busy}
            onClick={async () => {
              setBusy(true)
              // Names come from Google at sign-in; until then show the part before the @.
              await onSave({ ...m, nickname: m.nickname.trim() || null, display_name: m.display_name.trim() || m.email.trim().split('@')[0] })
              setBusy(false)
            }}
          >
            Save
          </button>
        </>
      }
    >
      {m.id && (
        <div className="field">
          <span className="label">Name from Google</span>
          <span>{signedIn ? m.display_name : <span className="muted">Not signed in yet</span>}</span>
        </div>
      )}
      <div className="field">
        <label htmlFor="m-nick">Nickname (optional)</label>
        <input id="m-nick" className="input" value={m.nickname} placeholder="Leave empty to use their Google name" onChange={(e) => setM({ ...m, nickname: e.target.value })} />
        <span className="hint">Shown in the app and the activity log instead of their Google name.</span>
      </div>
      <div className="field">
        <label htmlFor="m-email">MDI email</label>
        <input
          id="m-email"
          className="input mono"
          value={m.email}
          disabled={!!m.id}
          placeholder="name@mdi.ac.in"
          onChange={(e) => setM({ ...m, email: e.target.value })}
        />
        {m.email && !emailOk && <span className="hint" style={{ color: 'var(--red)' }}>Must be an @mdi.ac.in address</span>}
      </div>
      <div className="field">
        <label htmlFor="m-role">Role</label>
        <select id="m-role" className="select" value={m.role} onChange={(e) => setM({ ...m, role: e.target.value as Role })}>
          {options.map((r) => (
            <option key={r} value={r} disabled={!roles.includes(r)}>{ROLE_LABEL[r]}</option>
          ))}
        </select>
        <span className="hint">{ROLE_HELP[m.role]}</span>
      </div>
      <Switch checked={m.active} onChange={(v) => setM({ ...m, active: v })} label="Can sign in" />
    </Modal>
  )
}
