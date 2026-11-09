import { useEffect, useMemo, useRef, useState } from 'react'
import MapView from './components/MapView'
import StatsPanel from './components/StatsPanel'
import MapSearch from './components/MapSearch'
import VoterList from './components/VoterList'
import VoterFinder from './components/VoterFinder'
import { availableMeasures, CLASS_LABELS, MEASURES, scaleFor } from './measures'
import { AC_VIEWS, pathGen, VIEW_IDS, viewForAc, viewPath, VIEWS, type Region, type ViewId } from './geo'
import { densityScale, fmtInt, RAMP } from './format'
import type { Session } from './session'
import { acMeta, boothMeta, boothsOfAc, siteOf, sitesOfAc, type Booth } from './booths'

function readHash(): ViewId {
  const h = window.location.hash.replace('#', '') as ViewId
  return VIEW_IDS.includes(h) ? h : 'india'
}

export default function App({ user, onLogout }: { user: Session; onLogout: () => void }) {
  const [view, setView] = useState<ViewId>(readHash)
  const [selected, setSelected] = useState<Region | undefined>()
  const [booth, setBooth] = useState<Booth | undefined>()
  const [showBooths, setShowBooths] = useState(true)
  // Station whose voter list is open (drill-down below a station).
  const [voterBooth, setVoterBooth] = useState<Booth | undefined>()
  const [voterSerial, setVoterSerial] = useState<number | undefined>()
  const [finderOpen, setFinderOpen] = useState(false)
  // Zoom the camera onto the selected station (set by the map search).
  const [zoomToBooth, setZoomToBooth] = useState(false)
  const viewRef = useRef(view)
  // Measure to colour polling stations by ('none' = wards keep the density colours).
  const [colorBy, setColorBy] = useState<string>(() => {
    try {
      return localStorage.getItem('kd-color-by') ?? 'turnout'
    } catch {
      return 'turnout'
    }
  })
  const chooseColorBy = (id: string) => {
    setColorBy(id)
    try {
      localStorage.setItem('kd-color-by', id)
    } catch {
      /* per-viewer convenience only */
    }
  }
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null)

  useEffect(() => {
    const onHash = () => {
      const v = readHash()
      if (v === viewRef.current) return // we navigated ourselves; state is already set
      viewRef.current = v
      setView(v)
      setSelected(undefined)
      setBooth(undefined)
      setVoterBooth(undefined)
      setZoomToBooth(false)
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
    setVoterBooth(undefined)
    setZoomToBooth(false)
    if (v !== view) {
      viewRef.current = v
      setView(v)
      window.location.hash = v
    }
  }

  const findBooth = (b: Booth) => {
    const target = viewForAc(b.ac)
    if (view !== target) go(target)
    setSelected(undefined)
    setBooth(b)
    setZoomToBooth(true)
  }

  // From Find voter: fly to the station and open its list at that voter.
  const showVoter = (b: Booth, serial: number) => {
    setFinderOpen(false)
    findBooth(b)
    setVoterSerial(serial)
    setVoterBooth(b)
  }

  const clearBooth = () => {
    setBooth(undefined)
    setVoterBooth(undefined)
    setZoomToBooth(false)
  }

  const ac = VIEWS[view].ac
  const focusSite = booth && zoomToBooth ? siteOf.get(booth.id) : undefined
  // Clicking a ward / mandal in a constituency zooms the map to fill the screen with it.
  const focusWard = ac && !focusSite ? selected : undefined
  const zoomedOut = () => {
    clearBooth()
    setSelected(undefined)
  }

  const onPick = (r: Region) => (r.drillTo ? go(r.drillTo) : setSelected(r))

  const crumbs = viewPath(view)
  const acBooths = ac ? boothsOfAc(ac.no) : []
  const measures = useMemo(() => (ac ? availableMeasures(ac.no) : []), [ac])

  const scale = useMemo(() => densityScale(VIEWS[view].regions), [view])
  const colorScale = useMemo(() => {
    const m = MEASURES.find((x) => x.id === colorBy)
    return ac && showBooths && m ? scaleFor(m, ac.no) : null
  }, [ac, showBooths, colorBy])

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ◉
          </span>
          <div>
            <h1>Kukatpally Drilldown</h1>
            <p>India → Telangana → Kukatpally &amp; Gadwal · who lives where, who votes where</p>
          </div>
        </div>
        <div className="top-actions">
          <button className="ghost find-voter-btn" onClick={() => setFinderOpen(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M3 20c0-3.5 3-6 7-6M16 16l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
              <circle cx="15" cy="15" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
            Find voter
          </button>
          <span className="user-chip" title={`Signed in as ${user.username}`}>
            {user.name}
          </span>
          <button className="ghost" onClick={onLogout}>
            Log out
          </button>
          {AC_VIEWS.filter((v) => v !== view).map((v) => (
            <button key={v} className="primary" onClick={() => go(v)}>
              {VIEWS[v].title} ✈
            </button>
          ))}
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
            {voterBooth ? (
              <button className="crumb" onClick={() => setVoterBooth(undefined)}>
                PS {booth.no}
              </button>
            ) : (
              <span className="crumb is-current">PS {booth.no}</span>
            )}
          </span>
        )}
        {voterBooth && (
          <span className="crumb-wrap">
            <span className="sep">›</span>
            <span className="crumb is-current">Voters</span>
          </span>
        )}
      </nav>

      <main className="main">
        <section className="map-area">
          <MapView
            view={view}
            selectedId={selected?.id}
            onSelect={(r) => {
              clearBooth()
              setSelected(r)
            }}
            onDrill={(v) => go(v)}
            sites={ac && showBooths ? sitesOfAc(ac.no) : booth ? [siteOf.get(booth.id)!] : []}
            selectedBoothId={booth?.id}
            onBoothClick={setBooth}
            onBoothClose={clearBooth}
            onOpenVoters={(b) => {
              setBooth(b)
              setVoterSerial(undefined)
              setVoterBooth(b)
            }}
            focus={focusSite ? { x: focusSite.x, y: focusSite.y } : undefined}
            focusBounds={focusWard ? pathGen.bounds(focusWard.feature) : undefined}
            focusUnitId={focusWard?.unitId}
            colorScale={colorScale}
          />

          <div className="map-top">
            {(zoomToBooth && booth) || focusWard ? (
              <button className="back ghost" onClick={zoomedOut}>
                ← All of {VIEWS[view].title}
              </button>
            ) : (
              VIEWS[view].parent && (
                <button className="back ghost" onClick={() => go(VIEWS[view].parent!)}>
                  ← {VIEWS[VIEWS[view].parent!].title}
                </button>
              )
            )}
            <MapSearch onFind={findBooth} />
          </div>

          {voterBooth && (
            <VoterList
              key={`${voterBooth.id}-${voterSerial ?? ''}`}
              booth={voterBooth}
              focusSerial={voterSerial}
              onClose={() => {
                setVoterBooth(undefined)
                setVoterSerial(undefined)
              }}
            />
          )}
          {finderOpen && <VoterFinder onClose={() => setFinderOpen(false)} onPick={showVoter} />}

          <div className="map-legend">
            {ac && showBooths && measures.length > 0 && (
              <label>
                <span className="legend-title">Colour stations by</span>
                <select className="legend-select" value={colorBy} onChange={(e) => chooseColorBy(e.target.value)}>
                  <option value="none">Nothing (show ward density)</option>
                  {measures.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {colorScale ? (
              <>
                <ul className="legend-classes">
                  {CLASS_LABELS.map((label, i) => (
                    <li key={label}>
                      <span className="class-swatch" style={{ background: `var(--div-${['low', 'mid', 'high'][i]})` }} />
                      {label}
                      <b>
                        {i === 0 && `< ${colorScale.measure.format(colorScale.low)}`}
                        {i === 1 &&
                          `${colorScale.measure.format(colorScale.low)}–${colorScale.measure.format(colorScale.high)}`}
                        {i === 2 && `> ${colorScale.measure.format(colorScale.high)}`}
                      </b>
                    </li>
                  ))}
                </ul>
                <div className="legend-hint">
                  {ac?.name} average {colorScale.measure.format(colorScale.average)}
                  {ac && acMeta(ac.no).synthetic ? ' · sample data' : ''}
                </div>
                {!focusWard && !focusSite && ac && (
                  <div className="legend-hint">Click a {ac.unitLabel.toLowerCase()} to zoom in</div>
                )}
              </>
            ) : (
              <>
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
                {!ac && (
                  <div className="legend-hint">
                    <span className="hl-swatch" /> Glowing outline = click to zoom in
                  </div>
                )}
                {ac && showBooths && acBooths.length > 0 && (
                  <div className="legend-hint">
                    <span className="pin-swatch" /> Polling station{acMeta(ac.no).synthetic ? ' (sample)' : ''}
                    {!focusWard && !focusSite && ` · click a ${ac.unitLabel.toLowerCase()} to zoom in`}
                  </div>
                )}
              </>
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
          onClearBooth={clearBooth}
          onOpenVoters={(b) => {
            setVoterSerial(undefined)
            setVoterBooth(b)
          }}
          showBooths={showBooths}
          onToggleBooths={setShowBooths}
          colorScale={colorScale}
        />
      </main>

      <footer className="foot">
        Boundaries: Census-based district maps (udit-001/india-maps-data), GHMC wards from OpenStreetMap via
        DataMeet. State & district figures: Census of India 2011. Ward and mandal figures{boothMeta.synthetic ? ', polling stations and voters' : ''} are illustrative samples. Gadwal mandal boundaries: gggodhwani/telangana_boundaries.
      </footer>
    </div>
  )
}
