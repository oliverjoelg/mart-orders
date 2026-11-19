import type { Role } from './types'

/**
 * What the UI shows to each role. The database enforces the same rules
 * (supabase/migrations/*_security.sql); this only hides buttons that would fail.
 */
const RULES = {
  import: ['main_admin', 'admin', 'it'],
  setStatus: ['main_admin', 'admin', 'ops'],
  handover: ['main_admin', 'admin', 'ops'],
  undoHandover: ['main_admin', 'admin'],
  editItem: ['main_admin', 'admin'],
  delete: ['main_admin', 'admin'],
  editProducts: ['main_admin', 'admin'],
  spare: ['main_admin', 'admin', 'ops'],
  notes: ['main_admin', 'admin', 'ops', 'it'],
  resolveNotes: ['main_admin', 'admin', 'ops'],
  manageMembers: ['main_admin', 'it'],
  assignAdminRoles: ['main_admin'],
} as const satisfies Record<string, readonly Role[]>

export type Action = keyof typeof RULES

export function can(role: Role | null | undefined, action: Action): boolean {
  return !!role && (RULES[action] as readonly Role[]).includes(role)
}

/** Roles this user may give to others on the Team page. */
export function assignableRoles(role: Role | null | undefined): Role[] {
  if (role === 'main_admin') return ['main_admin', 'admin', 'ops', 'it']
  if (role === 'it') return ['ops', 'it']
  return []
}
