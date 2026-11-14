import { useEffect, useMemo, useRef, useState } from 'react'
import { acMeta, acName, boothById, booths, buildingName, searchBooths, type Booth } from '../booths'
import { AC_VIEWS, VIEWS } from '../geo'
import { fmtInt } from '../format'
import { votersOf, type Gender, type Voter } from '../voters'
import { onStatus, searchVoters, warmUp, type IndexStatus, type SearchQuery } from '../voterSearch'
import DuplicateReview from './DuplicateReview'

export type VoterTab = 'find' | 'dups'

interface Row {
  booth: Booth
  voter: Voter
  score: number
}

/** "Find voter": fuzzy name search across every voter list, showing each match's polling station. */
export default function VoterFinder({
  tab,
  onTab,
  onClose,
  onPick,
  onFindStation,
  boothIds,
  acNo,
  canReviewDuplicates = true,
}: {
  tab: VoterTab
  onTab: (t: VoterTab) => void
  onClose: () => void
  onPick: (booth: Booth, serial: number) => void
  /** "kukatpally 180" also offers to open that polling station. */
  onFindStation?: (booth: Booth) => void
  /** Limit to these stations (a lead's area); null / undefined = all. */
  boothIds?: Set<string> | null
  /** Constituency on screen: search only there (no "both constituencies" choice). */
  acNo?: number
  canReviewDuplicates?: boolean
}) {
  const [status, setStatus] = useState<IndexStatus>({ state: 'idle', progress: 0 })
  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [gender, setGender] = useState<'' | Gender>('')
  const [acPick, setAc] = useState('')
  const ac = acNo ? String(acNo) : acPick
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [ms, setMs] = useState(0)
  const nameRef = useRef<HTMLInputElement>(null)
  const latest = useRef(0)

  useEffect(() => {
    warmUp()
    nameRef.current?.focus()
    return onStatus(setStatus)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Search as you type (debounced); ignore answers to older queries.
  useEffect(() => {
    const q = name.trim()
    if (q.length < 2) {
      setRows([])
      setTotal(null)
      return
    }
    const query: SearchQuery = {
      name: q,
      age: Number(age) >= 18 ? Number(age) : undefined,
      gender: gender || undefined,
      ac: ac ? Number(ac) : undefined,
      booths: boothIds ? [...boothIds] : undefined,
      limit: 100,
    }
    const t = setTimeout(async () => {
      const id = ++latest.current
      const res = await searchVoters(query)
      if (id !== latest.current) return
      setRows(
        res.hits.flatMap((h) => {
          const booth = boothById.get(h.boothId)
          const voter = booth && votersOf(booth)[h.serial - 1]
          return booth && voter ? [{ booth, voter, score: h.score }] : []
        }),
      )
      setTotal(res.total)
      setMs(res.ms)
    }, 220)
    return () => clearTimeout(t)
  }, [name, age, gender, ac, boothIds])

  // Station shortcut: a query with a number ("kukatpally 180", "ps 12") may mean a polling station.
  const stationHits = useMemo(() => {
    const q = name.trim()
    if (!onFindStation || !/\d/.test(q)) return []
    const pool = boothIds ? booths.filter((b) => boothIds.has(b.id)) : booths
    return searchBooths(pool, q)
      .filter((b) => q.includes(String(b.no)))
      .slice(0, 3)
  }, [name, boothIds, onFindStation])

  const anySample = booths.some((b) => acMeta(b.ac).synthetic)
  // Voters in reach (this constituency / the user's area), shown instead of the grand total.
  const inReach = useMemo(() => {
    if (!boothIds) return null
    let n = 0
    for (const b of booths) if (boothIds.has(b.id) && b.electors) n += b.electors.male + b.electors.female + b.electors.thirdGender
    return n
  }, [boothIds])

  return (
    <div className="voter-sheet finder" role="dialog" aria-modal="false" aria-label={tab === 'find' ? 'Find a voter' : 'Duplicate voters'}>
      <div className="vs-head">
        <div>
          <div className="kicker">Voters · {acNo ? `AC ${acNo} ${acName(acNo)} only` : 'Kukatpally & Gadwal'}</div>
          <h2>{tab === 'find' ? 'Which polling station is this voter at?' : 'Possible duplicate voters'}</h2>
          <div className="vs-chips">
            {status.state === 'ready' ? (
              <span>
                Searching <b>{fmtInt(inReach ?? status.voters ?? 0)}</b> voters
              </span>
            ) : (
              <span className="index-progress">
                Preparing voter index… <b>{Math.round(status.progress * 100)}%</b>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${status.progress * 100}%` }} />
                </span>
              </span>
            )}
            {anySample && <span className="badge badge-sample">⚠ Sample data · made-up people</span>}
          </div>
        </div>
        <button className="ghost vs-close" onClick={onClose} aria-label="Close voter tools">
          ✕
        </button>
      </div>

      <div className="vs-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'find'} className={tab === 'find' ? 'is-on' : ''} onClick={() => onTab('find')}>
          Find voter
        </button>
        {canReviewDuplicates && (
          <button role="tab" aria-selected={tab === 'dups'} className={tab === 'dups' ? 'is-on' : ''} onClick={() => onTab('dups')}>
            Duplicates
          </button>
        )}
      </div>

      {tab === 'dups' && canReviewDuplicates ? (
        <DuplicateReview onPick={onPick} boothIds={boothIds} />
      ) : (
        <>

      <div className="vs-controls finder-controls">
        <input
          ref={nameRef}
          className="search"
          type="search"
          placeholder="Voter name, e.g. Santhosh Rote or R. Santosh — or a voter ID (SMP…)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Voter name or voter ID"
        />
        <input
          className="search"
          type="number"
          inputMode="numeric"
          min={18}
          max={110}
          placeholder="Age ±2"
          value={age}
          onChange={(e) => setAge(e.target.value)}
          aria-label="Approximate age"
        />
        <select className="legend-select" value={gender} onChange={(e) => setGender(e.target.value as '' | Gender)} aria-label="Gender">
          <option value="">Any gender</option>
          <option value="M">Men</option>
          <option value="F">Women</option>
          <option value="TG">Third gender</option>
        </select>
        <select
          className="legend-select"
          value={ac}
          onChange={(e) => setAc(e.target.value)}
          disabled={!!acNo}
          title={acNo ? 'Go back to India or Telangana to search both constituencies' : undefined}
          aria-label="Constituency"
        >
          {!acNo && <option value="">Both constituencies</option>}
          {AC_VIEWS.map((v) => (
            <option key={v} value={VIEWS[v].ac!.no}>
              AC {VIEWS[v].ac!.no} {VIEWS[v].ac!.name}
            </option>
          ))}
        </select>
      </div>

      <div className="vs-body">
        <div className="vs-table-wrap">
          {stationHits.length > 0 && (
            <div className="station-hits">
              <span className="muted small">Looking for a polling station?</span>
              {stationHits.map((b) => (
                <button key={b.id} className="ghost" onClick={() => onFindStation?.(b)}>
                  Go to {acName(b.ac)} PS {b.no} · {buildingName(b)} →
                </button>
              ))}
            </div>
          )}
          {total !== null && rows.length > 0 && rows[0].score < 0.95 && (
            <div className="finder-note">
              No voter named exactly <b>“{name.trim()}”</b>{ac || boothIds ? ' here' : ''}. Showing the closest spellings — check before acting on them.
            </div>
          )}
          {total === null ? (
            <div className="finder-help muted">
              <p>Type at least 2 letters of a name. Spelling variants are matched, so <b>Santhosh</b>, <b>Santosh</b> and <b>Santhos</b> all find each other, and an initial like <b>R.</b> can stand for a full name like <b>Rote</b>.</p>
              <p>Searches the voter’s own name only. Add an approximate age, gender or constituency to narrow it down, or paste a voter ID.</p>
            </div>
          ) : (
            <table className="vs-table">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Name</th>
                  <th className="hide-sm">Relative</th>
                  <th>Age</th>
                  <th className="hide-sm">Gender</th>
                  <th>Polling station</th>
                  <th className="hide-sm">Voter ID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ booth, voter, score }) => (
                  <tr
                    key={`${booth.id}-${voter.serial}`}
                    onClick={() => onPick(booth, voter.serial)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onPick(booth, voter.serial)
                      }
                    }}
                    title="Show on the map and open this station's voter list"
                  >
                    <td>
                      <span className={`match ${score >= 0.95 ? 'is-exact' : score >= 0.8 ? 'is-close' : ''}`}>
                        {Math.round(score * 100)}%
                      </span>
                    </td>
                    <td>{voter.name}</td>
                    <td className="hide-sm muted">
                      {voter.relation} {voter.relative}
                    </td>
                    <td className="num">{voter.age}</td>
                    <td className="hide-sm">{voter.gender}</td>
                    <td className="station-cell">
                      <b>
                        {acName(booth.ac)} · PS {booth.no}
                      </b>
                      <span className="muted">{buildingName(booth)}</span>
                    </td>
                    <td className="hide-sm mono">{voter.id}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      No voter named <b>“{name.trim()}”</b>{age || gender || acPick ? ' with these filters' : acNo ? ` in ${acName(acNo)}` : ''}. Check the spelling, try just the first name, or remove a filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="vs-foot">
        <span className="muted">
          {total === null
            ? 'Matches show the voter’s polling station; click one to see it on the map.'
            : total > rows.length
              ? `Best ${fmtInt(rows.length)} of ${fmtInt(total)} matches (${ms} ms). Add a filter to narrow down.`
              : `${fmtInt(total)} match${total === 1 ? '' : 'es'} (${ms} ms)`}
        </span>
      </div>
        </>
      )}
    </div>
  )
}
