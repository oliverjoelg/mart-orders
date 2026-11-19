import type {
  AuditEntry,
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
    source_slot: number
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

  loadSnapshot(): Promise<Snapshot>
  setItemsStatus(ids: string[], status: Exclude<ItemStatus, 'handed_over'>): Promise<number>
  recordHandover(ids: string[], type: HandoverType, collectorName?: string, collectorRoll?: string): Promise<number>
  undoHandover(itemId: string, reason: string): Promise<void>
  updateItem(id: string, patch: Partial<Pick<OrderItem, 'size' | 'print_name' | 'batch' | 'product_id'>>): Promise<void>
  deleteItem(id: string): Promise<void>
  importOrders(args: ImportArgs): Promise<{ items_created: number }>
  addNote(note: { buyer_id?: string | null; item_id?: string | null; body: string; is_flag: boolean }): Promise<void>
  setNoteResolved(id: string, resolved: boolean): Promise<void>
  setSpare(productId: string, size: string, quantity: number): Promise<void>
  activity(q: ActivityQuery): Promise<AuditEntry[]>
  itemHistory(itemId: string): Promise<AuditEntry[]>
  saveMember(m: { id?: string; email: string; display_name: string; role: Role; active: boolean }): Promise<void>
  /** super admin only */
  deleteMember(id: string): Promise<void>
  saveProduct(p: Partial<Product> & { campaign_id: string }): Promise<void>
  saveCampaign(c: { id?: string; name: string; is_active: boolean }): Promise<void>
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
