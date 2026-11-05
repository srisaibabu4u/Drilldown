import { useState } from 'react'
import type { Stats } from '../data/stats'
import { VIEWS, type Region, type ViewId } from '../geo'
import { fmtArea, fmtDensity, fmtInt, fmtPct, fmtShort } from '../format'

interface Props {
  view: ViewId
  selected?: Region
  onClearSelection: () => void
  onPick: (r: Region) => void
}

const LANG_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-other)']

export default function StatsPanel({ view, selected, onClearSelection, onPick }: Props) {
  const v = VIEWS[view]
  const stats: Stats | undefined = selected ? selected.stats : v.total
  const area = selected ? selected.areaKm2 : v.areaKm2
  const title = selected ? selected.name : v.title
  const kicker = selected
    ? `${selected.wardNo ? `Ward ${selected.wardNo} · ` : ''}${v.childLabel.replace(/s$/, '')} in ${v.title}`
    : v.levelLabel

  return (
    <aside className="panel" aria-live="polite">
      <div className="panel-head">
        <div className="kicker">{kicker}</div>
        <h2>{title}</h2>
        {!selected && <div className="sub">{v.subtitle}</div>}
        {selected && (
          <button className="link-btn" onClick={onClearSelection}>
            ← {v.title} overview
          </button>
        )}
        {stats && <SourceBadge source={stats.source} />}
      </div>

      {stats ? (
        <>
          <Kpis stats={stats} area={area} />
          {stats.ageGroups && <AgeChart stats={stats} />}
          {stats.languages && <LanguageBar stats={stats} />}
        </>
      ) : (
        <p className="muted">No statistics available for this area yet.</p>
      )}

      {!selected && <Ranking view={view} onPick={onPick} />}
    </aside>
  )
}

function SourceBadge({ source }: { source: Stats['source'] }) {
  return source === 'sample' ? (
    <div className="badge badge-sample" title="Illustrative numbers – replace with official ward data">
      ⚠ Sample data · illustrative only
    </div>
  ) : (
    <div className="badge">Census of India 2011</div>
  )
}

function Kpis({ stats, area }: { stats: Stats; area: number }) {
  const items: { label: string; value: string; hint?: string }[] = [
    { label: 'Population', value: fmtShort(stats.population), hint: fmtInt(stats.population) },
    { label: 'Density', value: fmtDensity(stats.population / area) },
    { label: 'Area', value: fmtArea(area) },
  ]
  if (stats.households) {
    items.push({ label: 'Households', value: fmtShort(stats.households), hint: fmtInt(stats.households) })
    items.push({ label: 'Avg household', value: (stats.population / stats.households).toFixed(2) })
  }
  if (stats.sexRatio) items.push({ label: 'Sex ratio', value: String(stats.sexRatio), hint: 'females per 1,000 males' })
  if (stats.literacy) items.push({ label: 'Literacy', value: `${stats.literacy.toFixed(1)}%` })
  if (stats.workers) items.push({ label: 'Workforce', value: `${stats.workers.toFixed(1)}%`, hint: 'share of population working' })
  return (
    <div className="kpis">
      {items.map((k) => (
        <div className="kpi" key={k.label} title={k.hint}>
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value">{k.value}</div>
          {k.hint && k.label !== 'Sex ratio' && k.label !== 'Workforce' && <div className="kpi-hint">{k.hint}</div>}
          {k.label === 'Sex ratio' && <div className="kpi-hint">F per 1,000 M</div>}
        </div>
      ))}
    </div>
  )
}

function AgeChart({ stats }: { stats: Stats }) {
  const groups = stats.ageGroups!
  const max = Math.max(...groups.map((g) => g.share))
  const [hover, setHover] = useState<number | null>(null)
  return (
    <section className="card">
      <h3>Age profile</h3>
      <div className="bars" role="list">
        {groups.map((g, i) => (
          <div
            className={`bar-row ${hover === i ? 'is-hover' : ''}`}
            key={g.label}
            role="listitem"
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            title={`${g.label}: ${fmtPct(g.share)} · ≈${fmtInt(g.share * stats.population)} people`}
          >
            <span className="bar-label">{g.label}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${(g.share / max) * 100}%` }} />
            </span>
            <span className="bar-value">
              {hover === i ? fmtShort(g.share * stats.population) : fmtPct(g.share, 0)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function LanguageBar({ stats }: { stats: Stats }) {
  const langs = stats.languages!
  return (
    <section className="card">
      <h3>Mother tongue</h3>
      <div className="stack" role="img" aria-label={langs.map((l) => `${l.label} ${fmtPct(l.share, 0)}`).join(', ')}>
        {langs.map((l, i) => (
          <span
            key={l.label}
            className="stack-seg"
            style={{ flexGrow: l.share, background: LANG_COLORS[i] }}
            title={`${l.label}: ${fmtPct(l.share)}`}
          />
        ))}
      </div>
      <ul className="legend">
        {langs.map((l, i) => (
          <li key={l.label}>
            <span className="swatch" style={{ background: LANG_COLORS[i] }} />
            {l.label} <b>{fmtPct(l.share, 0)}</b>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Ranking({ view, onPick }: { view: ViewId; onPick: (r: Region) => void }) {
  const v = VIEWS[view]
  const ranked = v.regions
    .filter((r) => r.stats)
    .sort((a, b) => {
      if (view !== 'ghmc' && !!b.drillTo !== !!a.drillTo) return b.drillTo ? 1 : -1
      return b.stats!.population - a.stats!.population
    })
    .slice(0, view === 'kukatpally' ? 20 : 10)
  const max = Math.max(...ranked.map((r) => r.stats!.population))
  return (
    <section className="card">
      <h3>
        {v.childLabel} {view === 'kukatpally' ? 'by population' : '— explore'}
      </h3>
      <ol className="rank">
        {ranked.map((r) => (
          <li key={r.id}>
            <button onClick={() => onPick(r)} className={r.drillTo ? 'is-drillable' : ''}>
              <span className="rank-name">
                {r.wardNo ? <span className="muted">{r.wardNo} · </span> : null}
                {r.name}
                {r.drillTo && (
                  <span className="chip" title="Click to zoom in">
                    ↘
                  </span>
                )}
              </span>
              <span className="rank-bar">
                <span style={{ width: `${(r.stats!.population / max) * 100}%` }} />
              </span>
              <span className="rank-val">{fmtShort(r.stats!.population)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
