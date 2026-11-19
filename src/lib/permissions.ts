import type { Role } from './types'

/**
 * What the UI shows to each role. The database enforces the same rules
 * (supabase/migrations/*_security.sql); this only hides buttons that would fail.
 */
const RULES = {
  import: ['main_admin', 'admin'],
  setStatus: ['main_admin', 'admin', 'ops'],
  handover: ['main_admin', 'admin', 'ops'],
  undoHandover: ['main_admin', 'admin'],
  editItem: ['main_admin', 'admin'],
  delete: ['main_admin', 'admin'],
  editProducts: ['main_admin', 'admin'],
  spare: ['main_admin', 'admin', 'ops'],
  notes: ['main_admin', 'admin', 'ops'],
  resolveNotes: ['main_admin', 'admin', 'ops'],
  // Team & roles tab: super admin and admins only (hidden from everyone else)
  manageMembers: ['main_admin', 'admin'],
} as const satisfies Record<string, readonly Role[]>

export type Action = keyof typeof RULES

export function can(role: Role | null | undefined, action: Action): boolean {
  return !!role && (RULES[action] as readonly Role[]).includes(role)
}

/** Roles this user may give to others. Admins can't create or edit super admins. */
export function assignableRoles(role: Role | null | undefined): Role[] {
  if (role === 'main_admin') return ['main_admin', 'admin', 'ops']
  if (role === 'admin') return ['admin', 'ops']
  return []
}
