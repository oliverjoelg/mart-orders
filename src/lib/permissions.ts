import type { Role } from './types'

/**
 * What the UI shows to each role, read from the database's role_permissions table
 * (the super admin edits it on Roles & permissions). The database enforces the action
 * permissions itself; this only hides buttons and pages that a role shouldn't use.
 */

export interface RoleRow {
  key: string
  name: string
  is_super: boolean
  sort_order: number
}
export interface PermissionRow {
  key: string
  label: string
  hint: string | null
  kind: 'action' | 'page'
  sort_order: number
}
export interface RolePermissionRow {
  role_key: string
  permission: string
}

/** App action name -> database permission key */
const ACTIONS = {
  import: 'add_orders',
  setStatus: 'receive_stock',
  handover: 'hand_over',
  undoHandover: 'undo_handover',
  editItem: 'edit_items',
  delete: 'delete_items',
  editProducts: 'manage_products',
  spare: 'spare_stock',
  notes: 'add_notes',
  resolveNotes: 'resolve_flags',
  manageMembers: 'manage_team',
  removeMembers: 'remove_members',
  pageHome: 'page_home',
  pageDesk: 'page_desk',
  pageLists: 'page_lists',
  pageItems: 'page_items',
  pageInventory: 'page_inventory',
  pagePrint: 'page_print_list',
  pageActivity: 'page_activity',
  pageProducts: 'page_products',
  pagePayments: 'page_payments',
  checkPayments: 'check_payments',
} as const

export type Action = keyof typeof ACTIONS | 'super'

let roles = new Map<string, RoleRow>()
let grants = new Map<string, Set<string>>()

/** Called by the data store whenever roles / ticks are (re)loaded. */
export function setPermissionData(roleRows: RoleRow[], rolePerms: RolePermissionRow[]) {
  roles = new Map(roleRows.map((r) => [r.key, r]))
  grants = new Map()
  for (const rp of rolePerms) {
    const set = grants.get(rp.role_key) ?? new Set<string>()
    set.add(rp.permission)
    grants.set(rp.role_key, set)
  }
}

export function isSuperRole(role: Role | null | undefined): boolean {
  return !!role && !!roles.get(role)?.is_super
}

export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false
  if (isSuperRole(role)) return true
  if (action === 'super') return false
  return grants.get(role)?.has(ACTIONS[action]) ?? false
}

export function roleName(key: Role | null | undefined): string {
  if (!key) return '—'
  return roles.get(key)?.name ?? key
}

export function allRoles(): RoleRow[] {
  return [...roles.values()].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
}

/** Roles this user may give to others: super admin -> any; team managers -> any non-super role. */
export function assignableRoles(role: Role | null | undefined): Role[] {
  if (isSuperRole(role)) return allRoles().map((r) => r.key)
  if (can(role, 'manageMembers')) return allRoles().filter((r) => !r.is_super).map((r) => r.key)
  return []
}
