// Client for the team APIs (help requests, history, team / coverage).
// All scoping happens on the server; these calls just return what the user may see.

export type ReqStatus = 'new' | 'documents_pending' | 'applied' | 'resolved' | 'not_eligible' | 'closed'

export const STATUS_LABEL: Record<ReqStatus, string> = {
  new: 'New',
  documents_pending: 'Documents pending',
  applied: 'Applied',
  resolved: 'Resolved',
  not_eligible: 'Not eligible',
  closed: 'Closed',
}
export const STATUS_ORDER: ReqStatus[] = ['new', 'documents_pending', 'applied', 'resolved', 'not_eligible', 'closed']
export const OPEN_STATUSES: ReqStatus[] = ['new', 'documents_pending', 'applied']

export interface HelpRequest {
  id: number
  booth_id: string
  ac: number
  ps_no: number
  unit_name: string | null
  booth_name: string
  voter_serial: number
  voter_ref: string
  voter_name: string
  scheme_code: string
  scheme_name: string
  need: string
  contact_mobile: string | null
  status: ReqStatus
  created_at: string
  updated_at: string
  created_by: string
  assigned_to: string | null
  assigned_to_id: number | null
}

export interface RequestList {
  rows: HelpRequest[]
  total: number
  counts: Partial<Record<ReqStatus, number>>
  schemes: { code: string; name: string }[]
}

export interface RequestEvent {
  action: 'created' | 'status' | 'note' | 'assigned'
  from_status: ReqStatus | null
  to_status: ReqStatus | null
  note: string | null
  at: string
  by: string
  role: string
}

export interface TeamLead {
  id: number
  name: string
  phone: string | null
}
export interface Team {
  role: string
  units: { unitId: string; unitName: string; ac: number; lead: TeamLead | null; booths: number; covered: number; open: number }[]
  booths: { id: string; ac: number; psNo: number; unitId: string | null; open: number; lead: TeamLead | null }[]
}

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, body.error ?? 'error')
  return body as T
}

export function listRequests(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
  return call<RequestList>(`/api/requests?${q}`)
}

export function createRequest(body: {
  boothId: string
  voterSerial: number
  voterRef: string
  voterName: string
  scheme: string
  need: string
  mobile?: string
  consent: boolean
}) {
  return call<{ ok: true; id: number }>('/api/requests', { method: 'POST', body: JSON.stringify(body) })
}

export function updateRequest(body: { id: number; status?: ReqStatus; note?: string; assignedTo?: number }) {
  return call<{ ok: true }>('/api/requests', { method: 'PATCH', body: JSON.stringify(body) })
}

export const requestEvents = (id: number) => call<{ events: RequestEvent[] }>(`/api/request-events?id=${id}`)

let teamPromise: Promise<Team> | null = null
/** Team / coverage for the user's area (cached for the session; pass true to refresh). */
export function loadTeam(refresh = false) {
  if (!teamPromise || refresh) teamPromise = call<Team>('/api/team').catch((e) => {
    teamPromise = null
    throw e
  })
  return teamPromise
}

export const ERROR_TEXT: Record<string, string> = {
  consent_required: 'Please confirm the person agreed to share these details.',
  bad_mobile: 'Mobile number should be 10 digits starting with 6–9.',
  not_your_area: 'This polling station is outside your area.',
  already_open: 'This person already has an open request for this scheme.',
  missing_fields: 'Please fill in the scheme and what help is needed.',
  not_allowed: 'Your role can’t do that.',
  read_only_for_role: 'Saved requests can only be updated by your ward / mandal lead or an admin.',
  bad_assignee: 'That person doesn’t lead this booth or its ward / mandal.',
  database_not_configured: 'Team features aren’t set up on the server yet.',
}
export const errorText = (e: unknown) =>
  e instanceof ApiError ? (ERROR_TEXT[e.code] ?? `Something went wrong (${e.code}).`) : 'Couldn’t reach the server.'
