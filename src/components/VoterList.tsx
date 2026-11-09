import { useEffect, useMemo, useRef, useState } from 'react'
import { acMeta, acName, buildingName, type Booth } from '../booths'
import { AGE_BANDS, GENDER_LABEL, votersOf, type Gender, type Voter } from '../voters'
import { fmtInt } from '../format'

const PAGE = 50

/** Full voter list for one polling station, shown over the map. */
export default function VoterList({
  booth,
  onClose,
  focusSerial,
}: {
  booth: Booth
  onClose: () => void
  /** Open the list at this voter (e.g. from Find voter). */
  focusSerial?: number
}) {
  const all = useMemo(() => votersOf(booth), [booth])
  const [q, setQ] = useState('')
  const [gender, setGender] = useState<'' | Gender>('')
  const [band, setBand] = useState<number | ''>('')
  const [page, setPage] = useState(() => (focusSerial ? Math.floor((focusSerial - 1) / PAGE) : 0))
  const [open, setOpen] = useState<Voter | null>(() => (focusSerial ? (all[focusSerial - 1] ?? null) : null))
  const closeRef = useRef<HTMLButtonElement>(null)

  // Bring the focused voter's row into view.
  useEffect(() => {
    if (focusSerial) document.querySelector('.vs-table tr.is-open')?.scrollIntoView({ block: 'center' })
  }, [focusSerial])

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (open ? setOpen(null) : onClose())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return all.filter(
      (v) =>
        (!gender || v.gender === gender) &&
        (band === '' || v.ageBand === band) &&
        (!s ||
          v.name.toLowerCase().includes(s) ||
          v.relative.toLowerCase().includes(s) ||
          v.id.toLowerCase().includes(s) ||
          v.house.toLowerCase().includes(s) ||
          String(v.serial) === s),
    )
  }, [all, q, gender, band])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const cur = Math.min(page, pages - 1)
  const rows = filtered.slice(cur * PAGE, cur * PAGE + PAGE)
  const counts = { M: 0, F: 0, TG: 0 }
  for (const v of all) counts[v.gender]++
  const household = open ? all.filter((v) => v.household === open.household) : []

  return (
    <div className="voter-sheet" role="dialog" aria-modal="false" aria-label={`Voter list for polling station ${booth.no}`}>
      <div className="vs-head">
        <div>
          <div className="kicker">
            Voter list · AC {booth.ac} {acName(booth.ac)} · PS {booth.no}
          </div>
          <h2>{buildingName(booth)}</h2>
          <div className="vs-chips">
            <span>
              <b>{fmtInt(all.length)}</b> voters
            </span>
            <span>
              Men <b>{fmtInt(counts.M)}</b>
            </span>
            <span>
              Women <b>{fmtInt(counts.F)}</b>
            </span>
            {counts.TG > 0 && (
              <span>
                Third gender <b>{counts.TG}</b>
              </span>
            )}
            {acMeta(booth.ac).synthetic && (
              <span className="badge badge-sample">⚠ Sample data · made-up people</span>
            )}
          </div>
        </div>
        <button ref={closeRef} className="ghost vs-close" onClick={onClose} aria-label="Close voter list">
          ✕
        </button>
      </div>

      <div className="vs-controls">
        <input
          className="search"
          type="search"
          placeholder="Search name, relative, voter ID, house no."
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(0)
          }}
          aria-label="Search voters"
        />
        <select
          className="legend-select"
          value={gender}
          onChange={(e) => {
            setGender(e.target.value as '' | Gender)
            setPage(0)
          }}
          aria-label="Filter by gender"
        >
          <option value="">All genders</option>
          <option value="M">Men</option>
          <option value="F">Women</option>
          <option value="TG">Third gender</option>
        </select>
        <select
          className="legend-select"
          value={band}
          onChange={(e) => {
            setBand(e.target.value === '' ? '' : Number(e.target.value))
            setPage(0)
          }}
          aria-label="Filter by age"
        >
          <option value="">All ages</option>
          {AGE_BANDS.map((b, i) => (
            <option key={b} value={i}>
              Age {b}
            </option>
          ))}
        </select>
      </div>

      <div className="vs-body">
        <div className="vs-table-wrap">
          <table className="vs-table">
            <thead>
              <tr>
                <th>Sl.</th>
                <th>Name</th>
                <th className="hide-sm">Relative</th>
                <th>Age</th>
                <th>Gender</th>
                <th className="hide-sm">House no.</th>
                <th className="hide-sm">Voter ID</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr
                  key={v.id}
                  className={open?.id === v.id ? 'is-open' : ''}
                  onClick={() => setOpen(v)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setOpen(v)
                    }
                  }}
                >
                  <td className="num">{v.serial}</td>
                  <td>{v.name}</td>
                  <td className="hide-sm muted">
                    {v.relation} {v.relative}
                  </td>
                  <td className="num">{v.age}</td>
                  <td>{v.gender === 'TG' ? 'TG' : v.gender}</td>
                  <td className="hide-sm">{v.house}</td>
                  <td className="hide-sm mono">{v.id}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No voters match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {open && (
          <aside className="voter-card" aria-label={`Details for ${open.name}`}>
            <button className="pin-close" aria-label="Close details" onClick={() => setOpen(null)}>
              ×
            </button>
            <div className="kicker">Voter · Sl. {open.serial}</div>
            <h3>{open.name}</h3>
            <dl>
              <dt>Relation</dt>
              <dd>
                {open.relation} {open.relative}
              </dd>
              <dt>Age</dt>
              <dd>
                {open.age} ({AGE_BANDS[open.ageBand]})
              </dd>
              <dt>Gender</dt>
              <dd>{GENDER_LABEL[open.gender]}</dd>
              <dt>House no.</dt>
              <dd>{open.house}</dd>
              <dt>Voter ID</dt>
              <dd className="mono">{open.id}</dd>
              <dt>Polling station</dt>
              <dd>
                PS {booth.no}, {buildingName(booth)}
              </dd>
            </dl>
            {household.length > 1 && (
              <>
                <h4>Same household ({household.length})</h4>
                <ul className="household">
                  {household.map((h) => (
                    <li key={h.id}>
                      <button className={h.id === open.id ? 'is-current' : ''} onClick={() => setOpen(h)}>
                        {h.name} <span className="muted">· {h.age} · {h.gender}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        )}
      </div>

      <div className="vs-foot">
        <span className="muted">
          {filtered.length === 0
            ? '0 voters'
            : `${fmtInt(cur * PAGE + 1)}–${fmtInt(cur * PAGE + rows.length)} of ${fmtInt(filtered.length)}`}
          {filtered.length !== all.length && ` (filtered from ${fmtInt(all.length)})`}
        </span>
        <div className="vs-pager">
          <button className="ghost" disabled={cur === 0} onClick={() => setPage(cur - 1)}>
            ← Prev
          </button>
          <span className="muted">
            Page {cur + 1} / {pages}
          </span>
          <button className="ghost" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>
            Next →
          </button>
        </div>
      </div>
    </div>
  )
}
