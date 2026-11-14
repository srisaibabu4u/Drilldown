import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../i18n'
import { acMeta, acName, buildingName, type Booth } from '../booths'
import { AGE_BANDS, GENDER_LABEL, votersOf, type Gender, type Voter } from '../voters'
import { fmtInt } from '../format'
import { canActOnBooth, type Session } from '../session'
import VoterHelp from './VoterHelp'

const PAGE = 50

/** Full voter list for one polling station, shown over the map. */
export default function VoterList({
  booth,
  onClose,
  focusSerial,
  user,
}: {
  booth: Booth
  onClose: () => void
  /** Open the list at this voter (e.g. from Find voter). */
  focusSerial?: number
  /** Signed-in user: leads covering this station can record scheme-help requests. */
  user?: Session
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
          v.id.toLowerCase().includes(s) ||
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
    <div className="voter-sheet" role="dialog" aria-modal="false" aria-label={t('Voter list for polling station {no}', { no: booth.no })}>
      <div className="vs-head">
        <div>
          <div className="kicker">
            {t('Voter list')} · AC {booth.ac} {t(acName(booth.ac))} · PS {booth.no}
          </div>
          <h2>{buildingName(booth)}</h2>
          <div className="vs-chips">
            <span>
              <b>{fmtInt(all.length)}</b> {t('voters')}
            </span>
            <span>
              {t('Men')} <b>{fmtInt(counts.M)}</b>
            </span>
            <span>
              {t('Women')} <b>{fmtInt(counts.F)}</b>
            </span>
            {counts.TG > 0 && (
              <span>
                {t('Third gender')} <b>{counts.TG}</b>
              </span>
            )}
            {acMeta(booth.ac).synthetic && (
              <span className="badge badge-sample">⚠ {t('Sample data · made-up people')}</span>
            )}
          </div>
        </div>
        <button ref={closeRef} className="ghost vs-close" onClick={onClose} aria-label={t('Close voter list')}>
          ✕
        </button>
      </div>

      <div className="vs-controls">
        <input
          className="search"
          type="search"
          placeholder={t('Search voter name or voter ID')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(0)
          }}
          aria-label={t('Search voters')}
        />
        <select
          className="legend-select"
          value={gender}
          onChange={(e) => {
            setGender(e.target.value as '' | Gender)
            setPage(0)
          }}
          aria-label={t('Filter by gender')}
        >
          <option value="">{t('All genders')}</option>
          <option value="M">{t('Men')}</option>
          <option value="F">{t('Women')}</option>
          <option value="TG">{t('Third gender')}</option>
        </select>
        <select
          className="legend-select"
          value={band}
          onChange={(e) => {
            setBand(e.target.value === '' ? '' : Number(e.target.value))
            setPage(0)
          }}
          aria-label={t('Filter by age')}
        >
          <option value="">{t('All ages')}</option>
          {AGE_BANDS.map((b, i) => (
            <option key={b} value={i}>
              {t('Age')} {b}
            </option>
          ))}
        </select>
      </div>

      <div className="vs-body">
        <div className="vs-table-wrap">
          <table className="vs-table">
            <thead>
              <tr>
                <th>{t('Sl.')}</th>
                <th>{t('Name')}</th>
                <th className="hide-sm">{t('Relative')}</th>
                <th>{t('Age')}</th>
                <th>{t('Gender')}</th>
                <th className="hide-sm">{t('House no.')}</th>
                <th className="hide-sm">{t('Voter ID')}</th>
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
                    {t('No voters match these filters.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {open && (
          <aside className="voter-card" aria-label={open.name}>
            <button className="pin-close" aria-label={t('Close details')} onClick={() => setOpen(null)}>
              ×
            </button>
            <div className="kicker">{t('Voter')} · {t('Sl.')} {open.serial}</div>
            <h3>{open.name}</h3>
            <dl>
              <dt>{t('Relation')}</dt>
              <dd>
                {open.relation} {open.relative}
              </dd>
              <dt>{t('Age')}</dt>
              <dd>
                {open.age} ({AGE_BANDS[open.ageBand]})
              </dd>
              <dt>{t('Gender')}</dt>
              <dd>{t(GENDER_LABEL[open.gender])}</dd>
              <dt>{t('House no.')}</dt>
              <dd>{open.house}</dd>
              <dt>{t('Voter ID')}</dt>
              <dd className="mono">{open.id}</dd>
              <dt>{t('Polling station')}</dt>
              <dd>
                PS {booth.no}, {buildingName(booth)}
              </dd>
            </dl>
            {household.length > 1 && (
              <>
                <h4>{t('Same household')} ({household.length})</h4>
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
            {user && canActOnBooth(user, booth) && <VoterHelp booth={booth} voter={open} />}
          </aside>
        )}
      </div>

      <div className="vs-foot">
        <span className="muted">
          {filtered.length === 0
            ? t('0 voters')
            : t('{a}–{b} of {n}', { a: fmtInt(cur * PAGE + 1), b: fmtInt(cur * PAGE + rows.length), n: fmtInt(filtered.length) })}
          {filtered.length !== all.length && ` ${t('(filtered from {n})', { n: fmtInt(all.length) })}`}
        </span>
        <div className="vs-pager">
          <button className="ghost" disabled={cur === 0} onClick={() => setPage(cur - 1)}>
            ← {t('Prev')}
          </button>
          <span className="muted">
            {t('Page')} {cur + 1} / {pages}
          </span>
          <button className="ghost" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>
            {t('Next')} →
          </button>
        </div>
      </div>
    </div>
  )
}
