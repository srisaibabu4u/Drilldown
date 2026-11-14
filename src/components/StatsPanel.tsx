import { useState } from 'react'
import type { Stats } from '../data/stats'
import { viewForAc, VIEWS, type AcDef, type Region, type ViewId } from '../geo'
import { fmtArea, fmtDensity, fmtInt, fmtPct, fmtShort } from '../format'
import { acMeta, acName, boothsInUnit, boothsOfAc, searchBooths, siteOf, summarize, type Booth } from '../booths'
import ElectorStats from './ElectorStats'
import { t } from '../i18n'
import type { MeasureScale } from '../measures'

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
  colorScale?: MeasureScale | null
  onOpenVoters: (b: Booth) => void
  /** Lead view: no "overview" link, lists limited to stations they may see. */
  locked?: boolean
  canSeeBooth?: (b: Booth) => boolean
  /** Booth lead home: their own stations to choose from (no ward-level details). */
  myStations?: Booth[]
}

export default function StatsPanel(props: Props) {
  if (props.booth)
    return (
      <BoothDetail
        booth={props.booth}
        onBack={props.onClearBooth}
        onPick={props.onPickBooth}
        onOpenVoters={props.onOpenVoters}
      />
    )
  if (props.myStations) return <MyStations stations={props.myStations} onPick={props.onPickBooth} />
  return <AreaPanel {...props} />
}

function MyStations({ stations, onPick }: { stations: Booth[]; onPick: (b: Booth) => void }) {
  const ac = stations[0]?.ac
  const unit = stations[0]?.unitName
  return (
    <aside className="panel" aria-live="polite">
      <div className="panel-head">
        <div className="kicker">
          {t('My polling stations')}{unit ? ` · ${t(unit)}` : ''}
        </div>
        <h2>
          {t(stations.length === 1 ? '{n} polling station' : '{n} polling stations', { n: stations.length })}
        </h2>
        <div className="sub">{t('Choose one to see its voters and record help requests.')}</div>
        {ac !== undefined && acMeta(ac).synthetic && <SampleBoothBadge />}
      </div>
      <section className="card my-stations">
        <ol className="booth-list">
          {stations.map((b) => (
            <li key={b.id}>
              <button onClick={() => onPick(b)}>
                <span className="booth-no">{b.no}</span>
                <span className="booth-text">{b.name}</span>
                {b.voters !== undefined && <span className="rank-val">{fmtShort(b.voters)}</span>}
              </button>
            </li>
          ))}
          {stations.length === 0 && <li className="muted small">{t('No polling stations are assigned to you yet. Ask your ward / mandal lead.')}</li>}
        </ol>
      </section>
      {ac !== undefined && stations.length > 0 && (
        <ElectorStats ac={ac} list={stations} title={t('Voters in your polling stations')} onPick={onPick} />
      )}
    </aside>
  )
}

function AreaPanel({
  view,
  selected,
  onClearSelection,
  onPick,
  onPickBooth,
  showBooths,
  onToggleBooths,
  colorScale,
  locked,
  canSeeBooth,
}: Props) {
  const v = VIEWS[view]
  const visible = (list: Booth[]) => (canSeeBooth ? list.filter(canSeeBooth) : list)
  const areaBooths = v.ac ? visible(selected?.unitId ? boothsInUnit(selected.unitId) : boothsOfAc(v.ac.no)) : []
  const wholeUnit = selected?.unitId ? boothsInUnit(selected.unitId).length : 0
  const onlyMine = locked && selected?.unitId && areaBooths.length < wholeUnit
  const stats: Stats | undefined = selected ? selected.stats : v.total
  const area = selected ? selected.areaKm2 : v.areaKm2
  const title = selected ? t(selected.name) : t(v.title)
  const kicker = selected
    ? `${selected.wardNo ? `${t('Ward')} ${selected.wardNo} · ` : ''}${t(`${v.childLabel.replace(/s$/, '')} in {area}`, { area: t(v.title) })}`
    : t(v.levelLabel)

  return (
    <aside className="panel" aria-live="polite">
      <div className="panel-head">
        <div className="kicker">{kicker}</div>
        <h2>{title}</h2>
        {!selected && <div className="sub">{subtitle(v.subtitle)}</div>}
        {selected && !locked && (
          <button className="link-btn" onClick={onClearSelection}>
            ← {t('{area} overview', { area: t(v.title) })}
          </button>
        )}
        {stats && <SourceBadge source={stats.source} />}
      </div>

      {v.ac && boothsOfAc(v.ac.no).length > 0 && (
        <>
          <ElectorStats
            ac={v.ac.no}
            list={areaBooths}
            title={
              onlyMine
                ? t('Voters in your {n} polling stations', { n: areaBooths.length })
                : selected
                  ? t(`Voters in this ${v.ac.unitLabel.toLowerCase()}`)
                  : `${t('Voters')} · AC ${v.ac.no} ${t(v.ac.name)}`
            }
            onPick={onPickBooth}
          />
          <BoothsCard
            ac={v.ac}
            unitId={selected?.unitId}
            canSee={canSeeBooth}
            onPick={onPickBooth}
            show={showBooths}
            onToggle={onToggleBooths}
            colorScale={colorScale}
          />
          <div className="section-title">
            <h3>{t('Residents')}</h3>
          </div>
        </>
      )}

      {stats ? (
        <>
          <Kpis stats={stats} area={area} />
          {stats.ageGroups && <AgeChart stats={stats} />}
        </>
      ) : (
        <p className="muted">{t('No statistics available for this area yet.')}</p>
      )}

      {v.ac && boothsOfAc(v.ac.no).length === 0 && (
        <BoothsCard ac={v.ac} unitId={selected?.unitId} onPick={onPickBooth} show={showBooths} onToggle={onToggleBooths} />
      )}

      {!selected && <Ranking view={view} onPick={onPick} />}
    </aside>
  )
}

function SourceBadge({ source }: { source: Stats['source'] }) {
  return source === 'sample' ? (
    <div className="badge badge-sample" title={t('Illustrative numbers – replace with official ward data')}>
      ⚠ {t('Sample data · illustrative only')}
    </div>
  ) : (
    <div className="badge">{t('Census of India 2011')}</div>
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
        <div className="kpi" key={k.label} title={k.hint && t(k.hint)}>
          <div className="kpi-label">{t(k.label)}</div>
          <div className="kpi-value">{k.value}</div>
          {k.hint && k.label !== 'Sex ratio' && k.label !== 'Workforce' && <div className="kpi-hint">{k.hint}</div>}
          {k.label === 'Sex ratio' && <div className="kpi-hint">{t('F per 1,000 M')}</div>}
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
      <h3>{t('Age profile')}</h3>
      <div className="bars" role="list">
        {groups.map((g, i) => (
          <div
            className={`bar-row ${hover === i ? 'is-hover' : ''}`}
            key={g.label}
            role="listitem"
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
            title={`${g.label}: ${fmtPct(g.share)} · ≈${fmtInt(g.share * stats.population)} ${t('people')}`}
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

function Ranking({ view, onPick }: { view: ViewId; onPick: (r: Region) => void }) {
  const v = VIEWS[view]
  const ranked = v.regions
    .filter((r) => r.stats)
    .sort((a, b) => {
      if (view !== 'ghmc' && !!b.drillTo !== !!a.drillTo) return b.drillTo ? 1 : -1
      return b.stats!.population - a.stats!.population
    })
    .slice(0, v.ac ? 20 : 10)
  const max = Math.max(...ranked.map((r) => r.stats!.population))
  return (
    <section className="card">
      <h3>
        {t(v.childLabel)} {v.ac ? t('by population') : `— ${t('explore')}`}
      </h3>
      <ol className="rank">
        {ranked.map((r) => (
          <li key={r.id}>
            <button onClick={() => onPick(r)} className={r.drillTo ? 'is-drillable' : ''}>
              <span className="rank-name">
                {r.wardNo ? <span className="muted">{r.wardNo} · </span> : null}
                {t(r.name)}
                {r.drillTo && (
                  <span className="chip" title={t('Click to zoom in')}>
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

function BoothDetail({
  booth,
  onBack,
  onPick,
  onOpenVoters,
}: {
  booth: Booth
  onBack: () => void
  onPick: (b: Booth) => void
  onOpenVoters: (b: Booth) => void
}) {
  const siblings = siteOf.get(booth.id)?.booths.filter((b) => b.id !== booth.id) ?? []
  const meta = acMeta(booth.ac)
  const unitLabel = VIEWS[viewForAc(booth.ac)].ac!.unitLabel
  return (
    <aside className="panel" aria-live="polite">
      <div className="panel-head">
        <div className="kicker">
          {t('Polling station')} · AC {booth.ac} {t(acName(booth.ac))}
        </div>
        <h2>PS {booth.no}</h2>
        <div className="sub booth-name">{booth.name}</div>
        <button className="link-btn" onClick={onBack}>
          ← {t('Back')}
        </button>
        {meta.synthetic && <SampleBoothBadge />}
        {booth.electors && (
          <button className="primary voters-btn" onClick={() => onOpenVoters(booth)}>
            {t('View voter list')} ({fmtInt(booth.voters ?? 0)}) →
          </button>
        )}
      </div>
      <section className="card">
        <h3>{t('Address')}</h3>
        <p className="booth-addr">{booth.address || '—'}</p>
        {!meta.synthetic && (
          <a
            className="link-btn"
            href={`https://www.google.com/maps/search/?api=1&query=${booth.lat},${booth.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            {t('Open in Google Maps')} ↗
          </a>
        )}
      </section>
      {booth.electors ? (
        <ElectorStats ac={booth.ac} list={[booth]} title={t('Voters at this station')} />
      ) : (
        booth.voters !== undefined && (
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-label">{t('Electors')}</div>
              <div className="kpi-value">{fmtInt(booth.voters)}</div>
            </div>
          </div>
        )
      )}
      <section className="card">
        <h3>{t(unitLabel)}</h3>
        <p className="small">
          {booth.unitName
            ? `${booth.wardNo !== undefined ? `${t('Ward')} ${booth.wardNo} · ` : ''}${t(booth.unitName)}`
            : t(`Outside the mapped ${unitLabel.toLowerCase()}s`)}
        </p>
      </section>
      {siblings.length > 0 && (
        <section className="card">
          <h3>{t('Other stations in this building')}</h3>
          <ol className="booth-list">
            {siblings.map((b) => (
              <li key={b.id}>
                <button onClick={() => onPick(b)}>
                  <span className="booth-no">{b.no}</span>
                  <span className="booth-text">{b.name}</span>
                  {b.voters !== undefined && <span className="rank-val">{fmtShort(b.voters)}</span>}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="card">
        <h3>{t('Location accuracy')}</h3>
        <p className="muted small">
          {meta.synthetic && t('Made-up position for demonstration. This is not a real polling station.')}
          {!meta.synthetic && booth.precision === 'manual' && t('Coordinates entered by hand.')}
          {booth.precision === 'geocoded' && t('Placed by matching the building name and address on OpenStreetMap.')}
          {booth.precision === 'approx' &&
            t('Approximate: only the locality could be matched, so the pin may be a few hundred metres off.')}
        </p>
        {meta.source && (
          <p className="muted small">
            {t('Source:')} {t(meta.source)}
            {meta.updated && ` · ${t('imported')} ${meta.updated}`}
          </p>
        )}
      </section>
    </aside>
  )
}

function BoothsCard({
  ac,
  unitId,
  onPick,
  show,
  onToggle,
  colorScale,
  canSee,
}: {
  ac: AcDef
  unitId?: string
  onPick: (b: Booth) => void
  show: boolean
  onToggle: (v: boolean) => void
  colorScale?: MeasureScale | null
  canSee?: (b: Booth) => boolean
}) {
  const [q, setQ] = useState('')
  const all = boothsOfAc(ac.no)
  if (all.length === 0) {
    return (
      <section className="card">
        <h3>{t('Polling stations')}</h3>
        <p className="muted small">{t('Polling station locations for AC {no} {name} will appear here once the data is loaded.', { no: ac.no, name: t(ac.name) })}</p>
      </section>
    )
  }
  const scope = (unitId ? boothsInUnit(unitId) : all).filter((b) => !canSee || canSee(b))
  const list = searchBooths(scope, q)
  const electors = scope.reduce((a, b) => a + (b.voters ?? 0), 0)
  return (
    <section className="card">
      <div className="card-row">
        <h3>{t('Polling stations')} {unitId ? t(`in this ${ac.unitLabel.toLowerCase()}`) : `· AC ${ac.no}`}</h3>
        <label className="switch">
          <input type="checkbox" checked={show} onChange={(e) => onToggle(e.target.checked)} />
          <span>{t('Show on map')}</span>
        </label>
      </div>
      {acMeta(ac.no).synthetic && <SampleBoothBadge />}
      <div className="booth-summary">
        <b>{fmtInt(scope.length)}</b> {t('stations')}
        {electors > 0 && (
          <>
            {' '}
            · <b>{fmtInt(electors)}</b> {t('electors')}
          </>
        )}
      </div>
      <input
        className="search"
        type="search"
        placeholder={t('Search by number, school, street…')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label={t('Search polling stations')}
      />
      <ol className="booth-list">
        {list.slice(0, 200).map((b) => (
          <li key={b.id}>
            <button onClick={() => onPick(b)}>
              <span className="booth-no">{b.no}</span>
              <span className="booth-text">
                {b.name}
                {b.precision === 'approx' && <span className="muted"> · {t('approx.')}</span>}
              </span>
              {colorScale ? (
                <MeasureCell scale={colorScale} booth={b} />
              ) : (
                b.voters !== undefined && <span className="rank-val">{fmtShort(b.voters)}</span>
              )}
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="muted small">{t('No matches.')}</li>}
      </ol>
    </section>
  )
}

function SampleBoothBadge() {
  return (
    <div className="badge badge-sample" title={t('Synthetic stations for demo – replace with the official CEO Telangana list')}>
      ⚠ {t('Sample data · not real polling stations')}
    </div>
  )
}

function MeasureCell({ scale, booth }: { scale: MeasureScale; booth: Booth }) {
  const sum = summarize([booth])
  const v = sum ? scale.measure.value(sum) : undefined
  const c = scale.classOf(v)
  if (v === undefined || c === undefined) return <span className="rank-val">—</span>
  return (
    <span className="rank-val measure-cell" title={`${t(scale.measure.label)}: ${scale.measure.format(v)}`}>
      <span className="class-swatch" style={{ background: `var(--div-${['low', 'mid', 'high'][c]})` }} />
      {scale.measure.format(v)}
    </span>
  )
}

/** View subtitles like "33 districts" / "GHMC · 11 wards mapped": translate the words, keep the numbers. */
function subtitle(s: string) {
  const m = s.match(/^(.*?)(\d+)(.*)$/)
  if (!m) return t(s)
  return t(`${m[1]}{n}${m[3]}`, { n: m[2] })
}
