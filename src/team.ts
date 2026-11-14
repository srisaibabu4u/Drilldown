// Client for the team APIs (help requests, history, team / coverage).
// All scoping happens on the server; these calls just return what the user may see.
import { getLang, t } from './i18n'

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

/** Days a request may stay in each open status before it's overdue (same as netlify/lib/sla.ts). */
export const SLA_DAYS: Partial<Record<ReqStatus, number>> = { new: 3, documents_pending: 7, applied: 30 }

/** Whole days since an ISO date. */
export const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000))

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
  /** When it entered its current status. */
  status_since: string
  /** Past the time limit for its status. */
  overdue: boolean
  created_by: string
  assigned_to: string | null
  assigned_to_id: number | null
}

export interface RequestList {
  rows: HelpRequest[]
  total: number
  counts: Partial<Record<ReqStatus | 'overdue', number>>
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
  not_your_area: 'That is outside your area.',
  already_open: 'This person already has an open request for this scheme.',
  missing_fields: 'Please fill in the scheme and what help is needed.',
  not_allowed: 'Your role can’t do that.',
  read_only_for_role: 'Saved requests can only be updated by your ward / mandal lead or an admin.',
  bad_assignee: 'That person doesn’t lead this booth or its ward / mandal.',
  database_not_configured: 'Team features aren’t set up on the server yet.',
  username_taken: 'That username is already in use.',
  bad_person: 'Enter a name and a username of 3–40 letters, numbers, dots or dashes.',
  bad_role: 'Choose a role.',
}
export const errorText = (e: unknown) =>
  e instanceof ApiError
    ? ERROR_TEXT[e.code]
      ? t(ERROR_TEXT[e.code])
      : t('Something went wrong ({code}).', { code: e.code })
    : t('Couldn’t reach the server.')

/** How many open requests in my area are past their time limit (for the header badge). */
export const overdueCount = () => listRequests({ status: 'overdue', limit: 1 }).then((r) => r.total)

// ---------------------------------------------------------------------------
// Assignments & people (admins; ward / mandal leads for booth leads in their area)
// ---------------------------------------------------------------------------

export interface Person {
  id: number
  username: string
  name: string
  role: 'admin' | 'unit_lead' | 'booth_lead'
  phone: string | null
  active: boolean
}
export interface AssignmentRow {
  user_id: number
  unit_id: string | null
  booth_id: string | null
  ps_no: number | null
  ac: number | null
  in_unit: string | null
}

export const loadAssignments = () => call<{ people: Person[]; assignments: AssignmentRow[] }>('/api/assignments')

export const setBoothLead = (boothId: string, userId: number | null) =>
  call<{ ok: true }>('/api/assignments', { method: 'PUT', body: JSON.stringify({ boothId, userId }) })

export const setUnitLead = (unitId: string, userId: number | null) =>
  call<{ ok: true }>('/api/assignments', { method: 'PUT', body: JSON.stringify({ unitId, userId }) })

export const addPerson = (p: { name: string; username: string; role: Person['role']; phone?: string }) =>
  call<{ ok: true; id: number; username: string; tempPassword: string }>('/api/assignments', {
    method: 'POST',
    body: JSON.stringify({ action: 'add_person', ...p }),
  })

export const resetPassword = (userId: number) =>
  call<{ ok: true; tempPassword: string }>('/api/assignments', {
    method: 'POST',
    body: JSON.stringify({ action: 'reset_password', userId }),
  })

export const setActive = (userId: number, active: boolean) =>
  call<{ ok: true }>('/api/assignments', { method: 'POST', body: JSON.stringify({ action: 'set_active', userId, active }) })

/** WhatsApp "click to chat" link with a drafted message (the lead reviews and sends it). */
export function whatsappLink(mobile: string, r: { voter_name: string; scheme_name: string; status: ReqStatus }, leadName: string) {
  const first = r.voter_name.split(' ').slice(-1)[0]
  const next: Record<ReqStatus, string> = {
    new: 'We have noted your request and will guide you on the next steps.',
    documents_pending:
      'Please keep the required documents ready (Aadhaar, ration card and any certificates needed for this scheme). We can help you complete the application.',
    applied: 'Your application has been submitted. We are following up with the department and will update you.',
    resolved: 'Your request has been resolved. Please let us know if you need anything else.',
    not_eligible: 'As per the scheme rules this request is not eligible right now. We can explain the details if you call us.',
    closed: 'This request is now closed. Please reach out if you need help again.',
  }
  const nextTe: Record<ReqStatus, string> = {
    new: 'మీ అభ్యర్థనను నమోదు చేసుకున్నాం. తదుపరి చేయాల్సిన పనుల గురించి మీకు తెలియజేస్తాం.',
    documents_pending:
      'దయచేసి అవసరమైన పత్రాలు (ఆధార్, రేషన్ కార్డు, ఈ పథకానికి కావాల్సిన సర్టిఫికెట్లు) సిద్ధంగా ఉంచండి. దరఖాస్తు పూర్తి చేయడంలో మేము సహాయం చేస్తాం.',
    applied: 'మీ దరఖాస్తు సమర్పించబడింది. శాఖతో ఫాలో అప్ చేస్తున్నాం, మీకు అప్‌డేట్ ఇస్తాం.',
    resolved: 'మీ అభ్యర్థన పరిష్కారమైంది. ఇంకేమైనా అవసరమైతే మాకు తెలియజేయండి.',
    not_eligible: 'పథకం నిబంధనల ప్రకారం ప్రస్తుతం ఈ అభ్యర్థనకు అర్హత లేదు. మీరు ఫోన్ చేస్తే వివరాలు చెబుతాం.',
    closed: 'ఈ అభ్యర్థన ముగిసింది. మళ్ళీ సహాయం కావాలంటే సంప్రదించండి.',
  }
  const text =
    getLang() === 'te'
      ? `నమస్తే ${first} గారు, నేను మీ ప్రాంత బృందం నుండి ${leadName}. మీ ${t(r.scheme_name)} అభ్యర్థన (${t(STATUS_LABEL[r.status])}) గురించి. ${nextTe[r.status]}`
      : `Namaste ${first} garu, this is ${leadName} from your area team, about your ${r.scheme_name} request (${STATUS_LABEL[r.status]}). ${next[r.status]}`
  return `https://wa.me/91${mobile}?text=${encodeURIComponent(text)}`
}
