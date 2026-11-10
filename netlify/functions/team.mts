// GET /api/team → who leads which ward / mandal and booth, within the caller's area,
// plus open help-request counts. Used for the Team view and the coverage map.
//
// Phone numbers are shown only to people above in the tree (admin → everyone,
// ward/mandal lead → their booth leads); a booth lead sees their own lead's number.
import { actorFrom, boothInScope } from '../lib/db.ts'
import { json } from '../lib/session.ts'

interface BoothRow {
  id: string
  ac: number
  ps_no: number
  unit_id: string | null
  unit_name: string | null
  lead_id: number | null
  lead_name: string | null
  lead_phone: string | null
  open: number
}

export default async (req: Request) => {
  const ctx = await actorFrom(req)
  if (ctx instanceof Response) return ctx
  const { sql, actor } = ctx

  const booths = await sql<BoothRow[]>`
    select b.id, b.ac, b.ps_no, b.unit_id, b.unit_name,
           u.id::int as lead_id, u.name as lead_name, u.phone as lead_phone,
           (select count(*)::int from help_requests r
              where r.booth_id = b.id and r.status in ('new', 'documents_pending', 'applied')) as open
    from booths b
    left join lateral (
      select au.* from assignments a join app_users au on au.id = a.user_id and au.active
      where a.booth_id = b.id order by au.id limit 1
    ) u on true
    where ${boothInScope(sql, actor)}
    order by b.ac, b.ps_no`

  const unitIds = [...new Set(booths.map((b) => b.unit_id).filter(Boolean))] as string[]
  const leads = unitIds.length
    ? await sql<{ unit_id: string; id: number; name: string; phone: string | null }[]>`
        select a.unit_id, u.id::int, u.name, u.phone
        from assignments a join app_users u on u.id = a.user_id and u.active
        where a.unit_id in ${sql(unitIds)}`
    : []

  const showPhone = (leadId: number | null, isUnitLead: boolean) =>
    actor.role === 'admin' || (actor.role === 'unit_lead' && !isUnitLead) || leadId === actor.id || (actor.role === 'booth_lead' && isUnitLead)

  const units = unitIds.map((unitId) => {
    const own = booths.filter((b) => b.unit_id === unitId)
    const lead = leads.find((l) => l.unit_id === unitId)
    return {
      unitId,
      unitName: own[0]?.unit_name,
      ac: own[0]?.ac,
      lead: lead ? { id: lead.id, name: lead.name, phone: showPhone(lead.id, true) ? lead.phone : null } : null,
      booths: own.length,
      covered: own.filter((b) => b.lead_id).length,
      open: own.reduce((n, b) => n + b.open, 0),
    }
  })

  return json({
    role: actor.role,
    units,
    booths: booths.map((b) => ({
      id: b.id,
      ac: b.ac,
      psNo: b.ps_no,
      unitId: b.unit_id,
      open: b.open,
      lead: b.lead_id ? { id: b.lead_id, name: b.lead_name, phone: showPhone(b.lead_id, false) ? b.lead_phone : null } : null,
    })),
  })
}

export const config = { path: '/api/team' }
