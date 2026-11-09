import { useState } from 'react'
import { acMeta, AGE_BANDS, boothsOfAc, SOCIAL_GROUPS, summarize, type Booth } from '../booths'
import { fmtInt, fmtPct, fmtShort } from '../format'

const GENDER = [
  { key: 'male', label: 'Men', color: 'var(--series-1)' },
  { key: 'female', label: 'Women', color: 'var(--series-2)' },
  { key: 'thirdGender', label: 'Third gender', color: 'var(--series-3)' },
] as const

// Categorical slots 1-4 in fixed order (see palette notes in the README).
const SOCIAL_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)']

/**
 * Electoral-roll dashboard for one station or a group of stations (ward / area):
 * electors, turnout, gender split, age bands, and the lowest-turnout stations.
 */
export default function ElectorStats({
  list,
  ac,
  title,
  onPick,
}: {
  list: Booth[]
  ac: number
  title: string
  onPick?: (b: Booth) => void
}) {
  const s = summarize(list)
  const [hoverAge, setHoverAge] = useState<number | null>(null)
  if (!s) return null
  const single = list.length === 1
  const maxAge = Math.max(...s.ages)
  const firstTime = s.ages[0]
  const seniors = s.ages[AGE_BANDS.length - 1]
  // Compare with the whole constituency when showing a part of it (ward / station).
  const acBooths = boothsOfAc(ac)
  const acSocial = list.length < acBooths.length ? summarize(acBooths) : null
  const maxShare = s.social ? Math.max(...s.social.map((n) => (n / s.electors) * 100)) : 1

  const kpis: { label: string; value: string; hint?: string }[] = [
    { label: 'Electors', value: single ? fmtInt(s.electors) : fmtShort(s.electors), hint: single ? undefined : fmtInt(s.electors) },
  ]
  if (s.turnout !== undefined)
    kpis.push({ label: 'Turnout (last AE)', value: `${s.turnout.toFixed(1)}%`, hint: `≈${fmtInt(s.votesPolled)} votes` })
  kpis.push({ label: 'First-time voters', value: fmtInt(firstTime), hint: `aged 18–19 · ${fmtPct(firstTime / s.electors)}` })
  kpis.push({
    label: 'Gender ratio',
    value: String(Math.round((s.female / s.male) * 1000)),
    hint: 'women per 1,000 men',
  })
  if (s.households) kpis.push({ label: 'Households', value: fmtShort(s.households), hint: `${(s.electors / s.households).toFixed(1)} electors each` })
  kpis.push({ label: 'Electors 80+', value: fmtInt(seniors), hint: 'eligible for home voting' })

  const lowest = single
    ? []
    : [...list]
        .filter((b) => b.electors?.turnout !== undefined)
        .sort((a, b) => a.electors!.turnout! - b.electors!.turnout!)
        .slice(0, 5)

  return (
    <>
      <div className="section-title">
        <h3>{title}</h3>
        {acMeta(ac).synthetic && <span className="badge badge-sample">Sample data</span>}
      </div>
      <div className="kpis">
        {kpis.map((k) => (
          <div className="kpi" key={k.label}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value">{k.value}</div>
            {k.hint && <div className="kpi-hint">{k.hint}</div>}
          </div>
        ))}
      </div>

      <section className="card">
        <h3>Electors by gender</h3>
        <div
          className="stack"
          role="img"
          aria-label={GENDER.map((g) => `${g.label} ${fmtInt(s[g.key])}`).join(', ')}
        >
          {GENDER.filter((g) => s[g.key] > 0).map((g) => (
            <span
              key={g.key}
              className="stack-seg"
              style={{ flexGrow: s[g.key], background: g.color }}
              title={`${g.label}: ${fmtInt(s[g.key])} (${fmtPct(s[g.key] / s.electors)})`}
            />
          ))}
        </div>
        <ul className="legend">
          {GENDER.map((g) => (
            <li key={g.key}>
              <span className="swatch" style={{ background: g.color }} />
              {g.label} <b>{fmtInt(s[g.key])}</b>
              {g.key !== 'thirdGender' && <span className="muted"> · {fmtPct(s[g.key] / s.electors, 0)}</span>}
            </li>
          ))}
        </ul>
      </section>

      {s.social && (
        <section className="card caste-card">
          <div className="card-row">
            <h3>Caste share (social category)</h3>
            {acSocial && <span className="muted small">vs AC {ac} average</span>}
          </div>
          <ul className="caste-rows">
            {SOCIAL_GROUPS.map((g, i) => {
              const share = (s.social![i] / s.electors) * 100
              const avg = acSocial ? (acSocial.social![i] / acSocial.electors) * 100 : undefined
              const diff = avg === undefined ? undefined : share - avg
              return (
                <li key={g.key} title={`${g.name}: ${fmtInt(s.social![i])} electors (${share.toFixed(1)}%)`}>
                  <span className="caste-label">
                    <b>{g.label}</b>
                    <span className="muted">{g.name}</span>
                  </span>
                  <span className="caste-bar">
                    <span style={{ width: `${(share / maxShare) * 100}%`, background: SOCIAL_COLORS[i] }} />
                  </span>
                  <span className="caste-pct">{share.toFixed(1)}%</span>
                  <span className="caste-count muted">{single ? fmtInt(s.social![i]) : fmtShort(s.social![i])}</span>
                  {diff !== undefined && (
                    <span className="caste-diff muted" aria-label={`${Math.abs(diff).toFixed(1)} points ${diff >= 0 ? 'above' : 'below'} average`}>
                      {Math.abs(diff) < 0.05 ? '±0.0' : `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(1)}`}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="muted small note">
            Shares of electors. Differences are in percentage points. Electoral rolls don’t record caste; real
            figures would come from a survey and are never shown per person.
          </p>
        </section>
      )}

      <section className="card">
        <h3>Electors by age</h3>
        <div className="bars" role="list">
          {s.ages.map((n, i) => (
            <div
              className={`bar-row ${hoverAge === i ? 'is-hover' : ''}`}
              key={AGE_BANDS[i]}
              role="listitem"
              onPointerEnter={() => setHoverAge(i)}
              onPointerLeave={() => setHoverAge(null)}
              title={`${AGE_BANDS[i]}: ${fmtInt(n)} electors (${fmtPct(n / s.electors)})`}
            >
              <span className="bar-label">{AGE_BANDS[i]}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(n / maxAge) * 100}%` }} />
              </span>
              <span className="bar-value">{hoverAge === i ? fmtInt(n) : fmtPct(n / s.electors, 0)}</span>
            </div>
          ))}
        </div>
      </section>

      {lowest.length > 0 && (
        <section className="card">
          <h3>Lowest turnout stations</h3>
          <ol className="booth-list">
            {lowest.map((b) => (
              <li key={b.no}>
                <button onClick={() => onPick?.(b)}>
                  <span className="booth-no">{b.no}</span>
                  <span className="booth-text">{b.name}</span>
                  <span className="rank-val">{b.electors!.turnout!.toFixed(1)}%</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  )
}
