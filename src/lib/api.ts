import type {
  AuditEntry,
  Campaign as CampaignRow,
  Buyer,
  Campaign,
  HandoverType,
  Handover,
  ItemStatus,
  Member,
  Note,
  OrderItem,
  Product,
  Role,
  SpareStock,
} from './types'
import type { ParsedBuyer } from './import/parseForm'
import type { PermissionRow, RolePermissionRow, RoleRow } from './permissions'

export interface Snapshot {
  campaigns: Campaign[]
  products: Product[]
  buyers: Buyer[]
  items: OrderItem[]
  /** live (not undone) handovers */
  handovers: Handover[]
  notes: Note[]
  spare: SpareStock[]
  members: Member[]
  roles: RoleRow[]
  permissions: PermissionRow[]
  rolePermissions: RolePermissionRow[]
  /** the sales round whose items/students/handovers are loaded (one at a time, to keep downloads small) */
  campaignId: string | null
}

export interface AuthUser {
  id: string
  email: string
}

export interface ImportArgs {
  campaignId: string
  fileName: string
  responses: number
  duplicatesSkipped: number
  buyers: ParsedBuyer[]
  items: {
    roll_no: string
    product_id: string
    size: string
    print_name: string | null
    batch: string | null
    source_timestamp: string | null
    /** 1–4 = position on the form; null for manual orders beyond 4 items */
    source_slot: number | null
  }[]
}

export interface ActivityQuery {
  limit: number
  beforeId?: number
  table?: string
}

/** Everything the UI does goes through this, so the demo can swap in an in-memory backend. */
export interface Api {
  mode: 'supabase' | 'demo'
  getUser(): Promise<AuthUser | null>
  onAuthChange(cb: () => void): () => void
  signIn(): Promise<void>
  signOut(): Promise<void>
  /** the signed-in user's active member row, or null if they are not on the team */
  getMyMember(user: AuthUser): Promise<Member | null>

  /** Loads one sales round (or the default one) plus the small shared tables. */
  loadSnapshot(campaignId?: string | null): Promise<Snapshot>
  /** Re-fetches just these items and their live handovers (after a handover, receive, etc.). */
  loadItems(ids: string[]): Promise<{ items: OrderItem[]; handovers: Handover[] }>
  /** A student from any round you can see, by roll number (for adding an order by hand). */
  findBuyer(rollNo: string): Promise<Buyer | null>
  /** Super admin: every table, every round, for the backup file. */
  exportAll(): Promise<Record<string, Record<string, unknown>[]>>
  setItemsStatus(ids: string[], status: Exclude<ItemStatus, 'handed_over'>): Promise<number>
  recordHandover(ids: string[], type: HandoverType, collectorName?: string, collectorRoll?: string): Promise<number>
  undoHandover(itemId: string, reason: string): Promise<void>
  updateItem(id: string, patch: Partial<Pick<OrderItem, 'size' | 'print_name' | 'batch' | 'product_id'>>): Promise<void>
  deleteItem(id: string): Promise<void>
  importOrders(args: ImportArgs): Promise<{ items_created: number }>
  /** Returns the saved note so the screen can show it without reloading. */
  addNote(note: { buyer_id?: string | null; item_id?: string | null; body: string; is_flag: boolean }): Promise<Note>
  setNoteResolved(id: string, resolved: boolean): Promise<Note>
  setSpare(productId: string, size: string, quantity: number): Promise<void>
  activity(q: ActivityQuery): Promise<AuditEntry[]>
  itemHistory(itemId: string): Promise<AuditEntry[]>
  saveMember(m: { id?: string; email: string; display_name: string; nickname: string | null; role: Role; active: boolean }): Promise<void>
  /** super admin only */
  deleteMember(id: string): Promise<void>
  saveProduct(p: Partial<Product> & { campaign_id: string }): Promise<void>
  /** admins; the database refuses if any order uses the product */
  deleteProduct(id: string): Promise<void>
  saveCampaign(c: { id?: string; name: string; is_active: boolean }): Promise<void>
  /** super admin only: hide + freeze (true) or bring back (false) a sales round */
  setCampaignLocked(id: string, locked: boolean): Promise<void>
  /** super admin only */
  saveRole(r: { key?: string; name: string }): Promise<void>
  deleteRole(key: string): Promise<void>
  setPermission(roleKey: string, permission: string, allowed: boolean): Promise<void>
  /** demo only: switch the pretend role */
  setDemoRole?(role: Role): void
}

/** Turns Postgres / PostgREST errors into something a volunteer at the desk can act on. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e)
  if (/row-level security|permission denied|42501/i.test(msg)) return "Your role isn't allowed to do that."
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'No connection to the server. Check the internet and try again.'
  if (/JWT|session/i.test(msg)) return 'Your sign-in expired. Please sign in again.'
  return msg
}

/** The round to load: the one asked for if visible, else unlocked + open + newest first. */
export function pickCampaign(campaigns: CampaignRow[], wanted?: string | null): string | null {
  if (wanted && campaigns.some((c) => c.id === wanted)) return wanted
  const sorted = [...campaigns].sort(
    (a, b) =>
      Number(!!a.locked) - Number(!!b.locked) ||
      Number(b.is_active) - Number(a.is_active) ||
      (b.created_at ?? '').localeCompare(a.created_at ?? ''),
  )
  return sorted[0]?.id ?? null
}
