/** main_admin is shown as "Super admin". (IT was merged into admin.) */
export type Role = 'main_admin' | 'admin' | 'ops'
export type ItemStatus = 'ordered' | 'sent_to_vendor' | 'received' | 'handed_over'
export type HandoverType = 'self' | 'collected_by_other'

export const STATUSES: ItemStatus[] = ['ordered', 'sent_to_vendor', 'received', 'handed_over']

export const STATUS_LABEL: Record<ItemStatus, string> = {
  ordered: 'Ordered',
  sent_to_vendor: 'With vendor',
  received: 'In MART',
  handed_over: 'Handed over',
}

export const ROLE_LABEL: Record<Role, string> = {
  main_admin: 'Super admin',
  admin: 'Admin',
  ops: 'Ops',
}

export interface Member {
  id: string
  email: string
  display_name: string
  role: Role
  active: boolean
  /** auth user id, set at first sign-in */
  user_id?: string | null
  created_at?: string
}

export interface Campaign {
  id: string
  name: string
  is_active: boolean
  created_at?: string
}

export interface Product {
  id: string
  campaign_id: string
  name: string
  colour: string
  price_inr: number
  sizes: string[]
  form_keywords: string[]
  sort_order: number
}

export interface Buyer {
  id: string
  roll_no: string
  name: string
  email: string | null
  phone: string | null
  batch: string | null
  course: string | null
  section: string | null
}

export interface OrderItem {
  id: string
  campaign_id: string
  buyer_id: string
  product_id: string
  size: string
  print_name: string | null
  batch: string | null
  status: ItemStatus
  status_changed_at: string | null
  source_timestamp: string | null
  source_slot: number | null
  created_at: string
}

export interface Handover {
  id: string
  item_id: string
  type: HandoverType
  collector_name: string | null
  collector_roll: string | null
  handed_by: string
  handed_at: string
  undone_at: string | null
  undo_reason: string | null
}

export interface Note {
  id: string
  buyer_id: string | null
  item_id: string | null
  body: string
  is_flag: boolean
  resolved: boolean
  created_by: string | null
  created_at: string
}

export interface SpareStock {
  id: string
  product_id: string
  size: string
  quantity: number
  note: string | null
}

export interface AuditEntry {
  id: number
  at: string
  actor_id: string | null
  actor_email: string | null
  actor_name: string | null
  actor_role: Role | null
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  table_name: string
  row_id: string | null
  item_id: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  changed: string[] | null
}

/** An item joined with its buyer, product and live handover, as the UI uses it. */
export interface ItemView extends OrderItem {
  buyer: Buyer
  product: Product
  handover: Handover | null
}
