// What the signed-in person may see: admins (and the plain AUTH_USERS login) see
// everything; a ward / mandal lead sees their ward(s) / mandal(s); a booth lead
// sees their own polling stations. Used to lock the map, searches and panels.
//
// Note: help requests and team data are also limited on the server. The synthetic
// voter / booth data ships with the site, so for it this is a display rule — real
// voter rolls must be served per role from the server before going live.
import { booths, type Booth } from './booths'
import { viewForAc, VIEWS, type Region, type ViewId } from './geo'
import type { Session } from './session'

export interface Scope {
  /** true = no restriction (admin). */
  all: boolean
  /** Constituency view a restricted user is kept on. */
  home?: ViewId
  /** Ward / mandal ids the user covers (or that contain their booths). */
  units: Set<string>
  /** Booth ids the user may see; null = all. */
  boothIds: Set<string> | null
  /** The ward / mandal the map opens on for a restricted user. */
  homeRegion?: Region
  canSeeBooth: (b: Pick<Booth, 'id'>) => boolean
  /** Duplicates review: admins and ward / mandal leads. */
  canReviewDuplicates: boolean
}

export function scopeOf(user: Session): Scope {
  if (!user.team || user.role === 'admin' || !user.role) {
    return { all: true, units: new Set(), boothIds: null, canSeeBooth: () => true, canReviewDuplicates: true }
  }
  let mine: Booth[]
  let units: Set<string>
  if (user.role === 'unit_lead') {
    units = new Set((user.units ?? []).map((u) => u.id))
    mine = booths.filter((b) => b.unitId && units.has(b.unitId))
  } else {
    const ids = new Set(user.booths ?? [])
    mine = booths.filter((b) => ids.has(b.id))
    units = new Set(mine.map((b) => b.unitId).filter((u): u is string => !!u))
  }
  const boothIds = new Set(mine.map((b) => b.id))
  const home = mine.length ? viewForAc(mine[0].ac) : undefined
  const homeRegion = home ? VIEWS[home].regions.find((r) => r.unitId && units.has(r.unitId)) : undefined
  return {
    all: false,
    home,
    units,
    boothIds,
    homeRegion,
    canSeeBooth: (b) => boothIds.has(b.id),
    canReviewDuplicates: user.role === 'unit_lead',
  }
}
