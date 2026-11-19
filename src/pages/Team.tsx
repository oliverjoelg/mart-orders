import { Lock, Pencil, Plus, Trash2, UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useToast } from '../components/Toast'
import { Avatar, Modal, PageHead, RoleBadge, Segmented, Switch } from '../components/ui'
import { friendlyError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { allRoles, assignableRoles, can, isSuperRole, roleName } from '../lib/permissions'
import { useData } from '../lib/store'
import { memberLabel, type Member, type Role } from '../lib/types'

type Tab = 'people' | 'permissions'

export default function Team() {
  const { member } = useAuth()
  const isSuper = isSuperRole(member?.role)
  const [tab, setTab] = useState<Tab>('people')

  return (
    <div className="page">
      <PageHead
        title="Roles & permissions"
        sub={
          isSuper
            ? 'Who is on the team, and what each role can do.'
            : 'Only people on this list can sign in, with their @mdi.ac.in Google account.'
        }
      />
      {isSuper && (
        <div style={{ marginBottom: 16 }}>
          <Segmented
            label="Show"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'people', label: 'People' },
              { value: 'permissions', label: 'Permissions' },
            ]}
          />
        </div>
      )}
      {tab === 'people' || !isSuper ? <People /> : <Permissions />}
    </div>
  )
}

// ---------------------------------------------------------------------------- people

function People() {
  const { snapshot, refresh } = useData()
  const { api, member } = useAuth()
  const toast = useToast()
  const [editing, setEditing] = useState<Partial<Member> | null>(null)
  const role = member?.role
  const roles = assignableRoles(role)
  const members = [...(snapshot?.members ?? [])].sort(
    (a, b) => Number(b.active) - Number(a.active) || memberLabel(a).localeCompare(memberLabel(b)),
  )
  const canEdit = (m: Member) => can(role, 'manageMembers') && (isSuperRole(role) || roles.includes(m.role))
  const canRemove = (m: Member) => m.id !== member?.id && (isSuperRole(role) || (can(role, 'removeMembers') && !isSuperRole(m.role)))

  return (
    <div className="stack">
      {can(role, 'manageMembers') && (
        <div>
          <button className="btn btn-primary" onClick={() => setEditing({ role: roles.includes('ops') ? 'ops' : roles[roles.length - 1], active: true })}>
            <UserPlus size={15} /> Add member
          </button>
        </div>
      )}

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
                <td className="right">{canEdit(m) && <button className="btn btn-sm" onClick={() => setEditing(m)}>Edit</button>}</td>
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
            editing.id && canRemove(editing as Member)
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
  onRemove?(): Promise<void>
}) {
  const [m, setM] = useState({
    id: initial.id,
    email: initial.email ?? '',
    display_name: initial.display_name ?? '',
    nickname: initial.nickname ?? '',
    role: (initial.role ?? roles[roles.length - 1] ?? 'ops') as Role,
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
      </div>
      <div className="field">
        <label htmlFor="m-email">MDI email</label>
        <input id="m-email" className="input mono" value={m.email} disabled={!!m.id} placeholder="name@mdi.ac.in" onChange={(e) => setM({ ...m, email: e.target.value })} />
        {m.email && !emailOk && <span className="hint" style={{ color: 'var(--red)' }}>Must be an @mdi.ac.in address</span>}
      </div>
      <div className="field">
        <label htmlFor="m-role">Role</label>
        <select id="m-role" className="select" value={m.role} onChange={(e) => setM({ ...m, role: e.target.value })}>
          {options.map((r) => (
            <option key={r} value={r} disabled={!roles.includes(r)}>{roleName(r)}</option>
          ))}
        </select>
        <span className="hint">What each role can do is set on the Permissions tab.</span>
      </div>
      <Switch checked={m.active} onChange={(v) => setM({ ...m, active: v })} label="Can sign in" />
    </Modal>
  )
}

// ---------------------------------------------------------------------------- permissions (super admin)

function Permissions() {
  const { snapshot, refresh } = useData()
  const { api } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [roleModal, setRoleModal] = useState<{ key?: string; name: string } | null>(null)
  const roles = allRoles()
  const perms = snapshot?.permissions ?? []
  const granted = useMemo(
    () => new Set((snapshot?.rolePermissions ?? []).map((rp) => `${rp.role_key}|${rp.permission}`)),
    [snapshot],
  )
  const memberCount = (key: string) => (snapshot?.members ?? []).filter((m) => m.role === key).length

  const toggle = async (roleKey: string, perm: string, allowed: boolean) => {
    setBusy(`${roleKey}|${perm}`)
    try {
      await api.setPermission(roleKey, perm, allowed)
      await refresh()
    } catch (e) {
      toast.err(friendlyError(e))
    } finally {
      setBusy(null)
    }
  }

  const section = (kind: 'action' | 'page', title: string, note: string) => (
    <>
      <tr>
        <td colSpan={roles.length + 1} style={{ background: 'var(--surface-2)' }}>
          <b style={{ fontWeight: 600 }}>{title}</b>
          <div className="hint">{note}</div>
        </td>
      </tr>
      {perms
        .filter((p) => p.kind === kind)
        .map((p) => (
          <tr key={p.key}>
            <td className="perm-name">
              <div style={{ fontWeight: 500 }}>{p.label}</div>
              {p.hint && <div className="hint">{p.hint}</div>}
            </td>
            {roles.map((r) => (
              <td key={r.key} className="cell">
                {r.is_super ? (
                  <input type="checkbox" checked readOnly disabled aria-label={`${r.name} always has ${p.label}`} />
                ) : (
                  <input
                    type="checkbox"
                    checked={granted.has(`${r.key}|${p.key}`)}
                    disabled={busy === `${r.key}|${p.key}`}
                    onChange={(e) => void toggle(r.key, p.key, e.target.checked)}
                    aria-label={`${r.name}: ${p.label}`}
                  />
                )}
              </td>
            ))}
          </tr>
        ))}
    </>
  )

  return (
    <div className="stack">
      <div className="row between">
        <span className="muted">Tick what each role may do. Changes save straight away.</span>
        <button className="btn" onClick={() => setRoleModal({ name: '' })}>
          <Plus size={15} /> New role
        </button>
      </div>

      <div className="table-wrap perm-table">
        <table className="table grid-table">
          <thead>
            <tr>
              <th className="perm-name">Permission</th>
              {roles.map((r) => (
                <th key={r.key} className="cell" style={{ minWidth: 110 }}>
                  <div className="row" style={{ justifyContent: 'center', gap: 4, flexWrap: 'nowrap' }}>
                    {r.is_super && <Lock size={12} />}
                    {r.name}
                  </div>
                  <div className="hint" style={{ fontWeight: 400 }}>{memberCount(r.key)} {memberCount(r.key) === 1 ? 'person' : 'people'}</div>
                  {!r.is_super && (
                    <div className="row" style={{ justifyContent: 'center', gap: 2 }}>
                      <button className="btn btn-ghost btn-icon btn-sm" title={`Rename ${r.name}`} onClick={() => setRoleModal({ key: r.key, name: r.name })}>
                        <Pencil size={12} />
                      </button>
                      <button
                        className="btn btn-ghost btn-icon btn-sm"
                        title={memberCount(r.key) ? 'Move everyone off this role first' : `Delete ${r.name}`}
                        disabled={memberCount(r.key) > 0}
                        onClick={async () => {
                          if (!window.confirm(`Delete the role “${r.name}”?`)) return
                          try {
                            await api.deleteRole(r.key)
                            toast.ok('Role deleted')
                            await refresh()
                          } catch (e) {
                            toast.err(friendlyError(e))
                          }
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section('action', 'What they can do', 'Enforced by the database: even a modified app cannot get around these.')}
            {section('page', 'Pages they can see', 'Hides the page in the app. Team members can still read stock data through other pages.')}
          </tbody>
        </table>
      </div>
      <span className="hint">
        <Lock size={11} style={{ verticalAlign: -1 }} /> Super admin always has everything, so you can never lock yourself out.
      </span>

      {roleModal && (
        <Modal
          title={roleModal.key ? 'Rename role' : 'New role'}
          onClose={() => setRoleModal(null)}
          footer={
            <>
              <button className="btn" onClick={() => setRoleModal(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={roleModal.name.trim().length < 2}
                onClick={async () => {
                  try {
                    await api.saveRole(roleModal)
                    toast.ok(roleModal.key ? 'Role renamed' : `Role “${roleModal.name.trim()}” created. Now tick what it can do.`)
                    setRoleModal(null)
                    await refresh()
                  } catch (e) {
                    toast.err(friendlyError(e))
                  }
                }}
              >
                Save
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="role-name">Role name</label>
            <input id="role-name" className="input" autoFocus placeholder="e.g. Volunteer" value={roleModal.name} onChange={(e) => setRoleModal({ ...roleModal, name: e.target.value })} />
            {!roleModal.key && <span className="hint">A new role starts with nothing ticked.</span>}
          </div>
        </Modal>
      )}
    </div>
  )
}
