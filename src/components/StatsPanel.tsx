import { useState } from 'react'
import type { Stats } from '../data/stats'
import { VIEWS, type Region, type ViewId } from '../geo'
import { fmtArea, fmtDensity, fmtInt, fmtPct, fmtShort } from '../format'
import { boothMeta, booths, boothsInWard, searchBooths, type Booth } from '../booths'

interface Props {
  view: ViewId
  selected?: Region
  onClearSelection: () => void
  onPick: (r: Region) => void
  booth?: Booth
  onPickBooth: (b: Booth) => void
  onClearBooth: () => void
  showBooths: boolean
  onToggleBooths: (v: boolean) => void
}

const LANG_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-other)']

export default function StatsPanel(props: Props) {
  if (props.booth) return <BoothDetail booth={props.booth} onBack={props.onClearBooth} />
  return <AreaPanel {...props} />
}

function AreaPanel({
  view,
  selected,
  onClearSelection,
  onPick,
  onPickBooth,
  showBooths,
  onToggleBooths,
}: Props) {
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

      {view === 'kukatpally' && (
        <BoothsCard
          wardNo={selected?.wardNo}
          onPick={onPickBooth}
          show={showBooths}
          onToggle={onToggleBooths}
        />
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

function BoothDetail({ booth, onBack }: { booth: Booth; onBack: () => void }) {
  return (
    <aside className="panel" aria-live="polite">
      <div className="panel-head">
        <div className="kicker">Polling station · AC {boothMeta.ac} {boothMeta.acName}</div>
        <h2>PS {booth.no}</h2>
        <div className="sub booth-name">{booth.name}</div>
        <button className="link-btn" onClick={onBack}>
          ← Back
        </button>
      </div>
      <section className="card">
        <h3>Address</h3>
        <p className="booth-addr">{booth.address || '—'}</p>
        <a
          className="link-btn"
          href={`https://www.google.com/maps/search/?api=1&query=${booth.lat},${booth.lng}`}
          target="_blank"
          rel="noreferrer"
        >
          Open in Google Maps ↗
        </a>
      </section>
      <div className="kpis">
        {booth.voters !== undefined && (
          <div className="kpi">
            <div className="kpi-label">Electors</div>
            <div className="kpi-value">{fmtInt(booth.voters)}</div>
          </div>
        )}
        <div className="kpi">
          <div className="kpi-label">Ward</div>
          <div className="kpi-value">{booth.wardNo ?? '—'}</div>
          {booth.wardNo === undefined && <div className="kpi-hint">outside mapped wards</div>}
        </div>
      </div>
      <section className="card">
        <h3>Location accuracy</h3>
        <p className="muted small">
          {booth.precision === 'manual' && 'Coordinates entered by hand.'}
          {booth.precision === 'geocoded' && 'Placed by matching the building name and address on OpenStreetMap.'}
          {booth.precision === 'approx' &&
            'Approximate: only the locality could be matched, so the pin may be a few hundred metres off.'}
        </p>
        {boothMeta.source && (
          <p className="muted small">
            Source: {boothMeta.source}
            {boothMeta.updated && ` · imported ${boothMeta.updated}`}
          </p>
        )}
      </section>
    </aside>
  )
}

function BoothsCard({
  wardNo,
  onPick,
  show,
  onToggle,
}: {
  wardNo?: number
  onPick: (b: Booth) => void
  show: boolean
  onToggle: (v: boolean) => void
}) {
  const [q, setQ] = useState('')
  if (booths.length === 0) {
    return (
      <section className="card">
        <h3>Polling stations</h3>
        <p className="muted small">Polling station locations for AC {boothMeta.ac} {boothMeta.acName} will appear here once the data is loaded.</p>
      </section>
    )
  }
  const scope = wardNo !== undefined ? boothsInWard(wardNo) : booths
  const list = searchBooths(scope, q)
  const electors = scope.reduce((a, b) => a + (b.voters ?? 0), 0)
  return (
    <section className="card">
      <div className="card-row">
        <h3>Polling stations {wardNo !== undefined ? 'in this ward' : `· AC ${boothMeta.ac}`}</h3>
        <label className="switch">
          <input type="checkbox" checked={show} onChange={(e) => onToggle(e.target.checked)} />
          <span>Show on map</span>
        </label>
      </div>
      <div className="booth-summary">
        <b>{fmtInt(scope.length)}</b> stations
        {electors > 0 && (
          <>
            {' '}
            · <b>{fmtInt(electors)}</b> electors
          </>
        )}
      </div>
      <input
        className="search"
        type="search"
        placeholder="Search by number, school, street…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search polling stations"
      />
      <ol className="booth-list">
        {list.slice(0, 200).map((b) => (
          <li key={b.no}>
            <button onClick={() => onPick(b)}>
              <span className="booth-no">{b.no}</span>
              <span className="booth-text">
                {b.name}
                {b.precision === 'approx' && <span className="muted"> · approx.</span>}
              </span>
              {b.voters !== undefined && <span className="rank-val">{fmtShort(b.voters)}</span>}
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="muted small">No matches.</li>}
      </ol>
    </section>
  )
}
