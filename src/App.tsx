import { useEffect, useMemo, useState } from 'react'
import MapView from './components/MapView'
import StatsPanel from './components/StatsPanel'
import { VIEW_ORDER, VIEWS, type Region, type ViewId } from './geo'
import { densityScale, fmtInt, RAMP } from './format'
import type { Session } from './auth'
import { boothMeta, booths, siteOf, sites, type Booth } from './booths'

function readHash(): ViewId {
  const h = window.location.hash.replace('#', '') as ViewId
  return VIEW_ORDER.includes(h) ? h : 'india'
}

export default function App({ user, onLogout }: { user: Session; onLogout: () => void }) {
  const [view, setView] = useState<ViewId>(readHash)
  const [selected, setSelected] = useState<Region | undefined>()
  const [booth, setBooth] = useState<Booth | undefined>()
  const [showBooths, setShowBooths] = useState(true)
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null)

  useEffect(() => {
    const onHash = () => {
      setView(readHash())
      setSelected(undefined)
      setBooth(undefined)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme
  }, [theme])

  const go = (v: ViewId) => {
    setSelected(undefined)
    setBooth(undefined)
    if (v !== view) window.location.hash = v
  }

  const onPick = (r: Region) => (r.drillTo ? go(r.drillTo) : setSelected(r))

  const level = VIEW_ORDER.indexOf(view)
  const crumbs = VIEW_ORDER.slice(0, level + 1)

  const scale = useMemo(() => densityScale(VIEWS[view].regions), [view])

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ◉
          </span>
          <div>
            <h1>Kukatpally Drilldown</h1>
            <p>India → Telangana → Hyderabad → Kukatpally · who lives where</p>
          </div>
        </div>
        <div className="top-actions">
          <span className="user-chip" title={`Signed in as ${user.username}`}>
            {user.name}
          </span>
          <button className="ghost" onClick={onLogout}>
            Log out
          </button>
          {view !== 'kukatpally' && (
            <button className="primary" onClick={() => go('kukatpally')}>
              Fly to Kukatpally ✈
            </button>
          )}
          <button
            className="ghost icon-btn"
            aria-label="Toggle colour theme"
            title="Toggle light / dark"
            onClick={() => {
              const dark =
                theme === 'dark' ||
                (theme === null && window.matchMedia('(prefers-color-scheme: dark)').matches)
              setTheme(dark ? 'light' : 'dark')
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </header>

      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={c} className="crumb-wrap">
            {i > 0 && <span className="sep">›</span>}
            <button
              className={`crumb ${c === view ? 'is-current' : ''}`}
              aria-current={c === view ? 'page' : undefined}
              onClick={() => go(c)}
            >
              {VIEWS[c].title}
            </button>
          </span>
        ))}
        {selected && (
          <span className="crumb-wrap">
            <span className="sep">›</span>
            <span className="crumb is-current">{selected.name}</span>
          </span>
        )}
        {booth && (
          <span className="crumb-wrap">
            <span className="sep">›</span>
            <span className="crumb is-current">PS {booth.no}</span>
          </span>
        )}
      </nav>

      <main className="main">
        <section className="map-area">
          <MapView
            view={view}
            selectedId={selected?.id}
            onSelect={(r) => {
              setBooth(undefined)
              setSelected(r)
            }}
            onDrill={(v) => go(v)}
            sites={showBooths ? sites : booth ? [siteOf.get(booth.no)!] : []}
            selectedBoothNo={booth?.no}
            onBoothClick={setBooth}
          />

          {VIEWS[view].parent && (
            <button className="back ghost" onClick={() => go(VIEWS[view].parent!)}>
              ← {VIEWS[VIEWS[view].parent!].title}
            </button>
          )}

          <div className="map-legend">
            <div className="legend-title">Population density (people / km²)</div>
            <div className="legend-ramp">
              {RAMP.map((c) => (
                <span key={c} style={{ background: c }} />
              ))}
            </div>
            <div className="legend-ticks">
              <span>{fmtInt(scale.thresholds[0])}</span>
              <span>{fmtInt(scale.thresholds[Math.floor(scale.thresholds.length / 2)])}</span>
              <span>{fmtInt(scale.thresholds[scale.thresholds.length - 1])}+</span>
            </div>
            <div className="legend-hint">
              <span className="hl-swatch" /> Glowing outline = click to zoom in
            </div>
            {view === 'kukatpally' && showBooths && booths.length > 0 && (
              <div className="legend-hint">
                <span className="pin-swatch" /> Polling station{boothMeta.synthetic ? ' (sample)' : ''}
                {!boothMeta.synthetic && (
                  <>
                    <span className="pin-swatch is-approx" /> approx.
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        <StatsPanel
          view={view}
          selected={selected}
          onClearSelection={() => setSelected(undefined)}
          onPick={onPick}
          booth={booth}
          onPickBooth={setBooth}
          onClearBooth={() => setBooth(undefined)}
          showBooths={showBooths}
          onToggleBooths={setShowBooths}
        />
      </main>

      <footer className="foot">
        Boundaries: Census-based district maps (udit-001/india-maps-data), GHMC wards from OpenStreetMap via
        DataMeet. State & district figures: Census of India 2011. Ward-level figures{boothMeta.synthetic ? ' and polling stations' : ''} are illustrative samples.
      </footer>
    </div>
  )
}
