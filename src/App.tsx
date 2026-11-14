import { useEffect, useMemo, useRef, useState } from 'react'
import MapView from './components/MapView'
import StatsPanel from './components/StatsPanel'
import MapSearch from './components/MapSearch'
import VoterList from './components/VoterList'
import VoterFinder, { type VoterTab } from './components/VoterFinder'
import HelpPanel, { type HelpTab } from './components/HelpPanel'
import CommandCentre, { type CentreAction } from './components/CommandCentre'
import { setLang, t, useLang } from './i18n'
import { loadTeam, overdueCount, type ReqStatus, type Team } from './team'
import { ROLE_LABEL } from './session'
import { availableMeasures, CLASS_LABELS, MEASURES, scaleFor, type MeasureScale } from './measures'
import { AC_VIEWS, pathGen, VIEW_IDS, viewForAc, viewPath, VIEWS, type Region, type ViewId } from './geo'
import { densityScale, fmtInt, RAMP } from './format'
import type { Session } from './session'
import { acMeta, boothMeta, boothsOfAc, siteOf, sitesOfAc, type Booth, type Site } from './booths'
import { scopeOf } from './scope'

function readHash(): ViewId {
  const h = window.location.hash.replace('#', '') as ViewId
  return VIEW_IDS.includes(h) ? h : 'india'
}

export default function App({ user, onLogout }: { user: Session; onLogout: () => void }) {
  // What this person may see (admins: everything; leads: their own area only).
  const scope = useMemo(() => scopeOf(user), [user])
  const locked = !scope.all
  const [view, setView] = useState<ViewId>(() => (locked && scope.home ? scope.home : readHash()))
  const [selected, setSelected] = useState<Region | undefined>()
  const [booth, setBooth] = useState<Booth | undefined>()
  const [showBooths, setShowBooths] = useState(true)
  // Station whose voter list is open (drill-down below a station).
  const [voterBooth, setVoterBooth] = useState<Booth | undefined>()
  const [voterSerial, setVoterSerial] = useState<number | undefined>()
  const [voterTool, setVoterTool] = useState<VoterTab | null>(null)
  const [helpTab, setHelpTab] = useState<HelpTab | null>(null)
  const [helpStatus, setHelpStatus] = useState<'open' | 'overdue' | ReqStatus>('open')
  // Command centre: first screen for admins and ward / mandal leads (once per sign-in).
  const hasCentre = !!user.team && (user.role === 'admin' || user.role === 'unit_lead')
  const [centre, setCentre] = useState(() => {
    if (!hasCentre) return false
    try {
      if (sessionStorage.getItem('biq-centre-seen')) return false
      sessionStorage.setItem('biq-centre-seen', '1')
    } catch {
      /* show it anyway */
    }
    return true
  })
  const lang = useLang()
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
      if (locked && v !== scope.home) {
        // Leads stay in their own constituency.
        if (scope.home) window.location.hash = scope.home
        return
      }
      viewRef.current = v
      setView(v)
      setSelected(undefined)
      setBooth(undefined)
      setVoterBooth(undefined)
      setZoomToBooth(false)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [locked, scope.home])

  // Keep the address bar in step with a lead's home view.
  useEffect(() => {
    if (locked && scope.home && readHash() !== scope.home) {
      viewRef.current = scope.home
      window.location.hash = scope.home
    }
  }, [locked, scope.home])

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme
  }, [theme])

  const go = (v: ViewId) => {
    if (locked && v !== scope.home) return // leads can't leave their constituency
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
    setVoterTool(null)
    setHelpTab(null)
    findBooth(b)
    setVoterSerial(serial)
    setVoterBooth(b)
  }

  // Only one of the big panels at a time (Find voter / Duplicates vs Help requests).
  const openVoterTool = (tab: VoterTab) => {
    setHelpTab(null)
    setCentre(false)
    setVoterTool(tab)
  }
  const openHelp = (tab: HelpTab, status: 'open' | 'overdue' | ReqStatus = 'open') => {
    setVoterTool(null)
    setVoterBooth(undefined)
    setCentre(false)
    setHelpStatus(status)
    setHelpTab(tab)
  }
  const openCentre = () => {
    setVoterTool(null)
    setVoterBooth(undefined)
    setHelpTab(null)
    setCentre(true)
  }

  // Requests past their time limit, for the header badge (refreshed when the panel closes).
  const [overdue, setOverdue] = useState(0)
  useEffect(() => {
    if (user.team && helpTab === null) overdueCount().then(setOverdue).catch(() => {})
  }, [user.team, helpTab])

  // Coverage map for a constituency (zooming into a lead's own ward / mandal).
  const showCoverage = (acNo: number) => {
    setHelpTab(null)
    setCentre(false)
    chooseColorBy('coverage')
    const v = viewForAc(acNo)
    go(v)
    const own = user.role === 'unit_lead' && user.units?.length === 1 ? user.units[0].id : undefined
    const region = own ? VIEWS[v].regions.find((r) => r.unitId === own) : undefined
    if (region) setSelected(region)
  }

  const onCentre = (a: CentreAction) => {
    if (a.kind === 'requests') return openHelp('requests', a.status)
    if (a.kind === 'team') return openHelp('team')
    if (a.kind === 'coverage') return showCoverage(a.ac)
    setCentre(false)
    const v = viewForAc(a.ac)
    go(v)
    const region = VIEWS[v].regions.find((r) => r.unitId === a.unitId)
    if (region && regionAllowed(region)) setSelected(region)
  }

  const clearBooth = () => {
    setBooth(undefined)
    setVoterBooth(undefined)
    setZoomToBooth(false)
  }

  const ac = VIEWS[view].ac
  // Leads always look at their own ward / mandal.
  const current = selected ?? (locked ? scope.homeRegion : undefined)
  const focusSite = booth && zoomToBooth ? siteOf.get(booth.id) : undefined
  // Clicking a ward / mandal in a constituency zooms the map to fill the screen with it.
  const focusWard = ac && !focusSite ? current : undefined
  const zoomedOut = () => {
    clearBooth()
    setSelected(undefined)
  }
  const regionAllowed = (r: Region) => !locked || (!!r.unitId && scope.units.has(r.unitId))

  const onPick = (r: Region) => {
    if (!regionAllowed(r)) return
    if (r.drillTo) go(r.drillTo)
    else setSelected(r)
  }

  const crumbs = locked ? (scope.home ? [scope.home] : []) : viewPath(view)
  // Map pins: only the stations this person may see.
  const visibleSites = useMemo<Site[]>(() => {
    if (!ac) return []
    const all = sitesOfAc(ac.no)
    if (!locked) return all
    return all.flatMap((s) => {
      const bs = s.booths.filter((b) => scope.canSeeBooth(b))
      return bs.length ? [{ ...s, booths: bs }] : []
    })
  }, [ac, locked, scope])
  const acBooths = ac ? boothsOfAc(ac.no) : []
  const measures = useMemo(() => (ac ? availableMeasures(ac.no) : []), [ac])
  // Voter tools stay inside the constituency on screen (and the user's own area).
  const finderBoothIds = useMemo(() => {
    if (!ac) return scope.boothIds
    return new Set(boothsOfAc(ac.no).filter((b) => !scope.boothIds || scope.boothIds.has(b.id)).map((b) => b.id))
  }, [ac, scope.boothIds])

  // Team coverage (leads and admins only): which stations have a booth lead.
  const [team, setTeam] = useState<Team | null>(null)
  useEffect(() => {
    if (user.team) loadTeam().then(setTeam).catch(() => {})
  }, [user.team])
  const coverageScale = useMemo<MeasureScale | null>(() => {
    if (!team || !ac) return null
    const hasLead = new Map(team.booths.map((b) => [b.id, !!b.lead]))
    const known = team.booths.filter((b) => b.ac === ac.no)
    if (known.length === 0) return null
    const share = known.filter((b) => b.lead).length / known.length
    const pct = (v: number) => `${Math.round(v * 100)}%`
    return {
      measure: { id: 'coverage', label: 'Booth lead', value: () => undefined, format: pct },
      average: share,
      low: 0,
      high: 1,
      labels: ['No booth lead', 'Some booths covered', 'Has a booth lead'],
      siteValue: (site) => {
        const ks = site.booths.filter((b) => hasLead.has(b.id))
        return ks.length ? ks.filter((b) => hasLead.get(b.id)).length / ks.length : undefined
      },
      classOf: (v) => (v === undefined ? undefined : v >= 1 ? 2 : v <= 0 ? 0 : 1),
    }
  }, [team, ac])

  const scale = useMemo(() => densityScale(VIEWS[view].regions), [view])
  const colorScale = useMemo(() => {
    if (colorBy === 'coverage') return showBooths ? coverageScale : null
    const m = MEASURES.find((x) => x.id === colorBy)
    return ac && showBooths && m ? scaleFor(m, ac.no) : null
  }, [ac, showBooths, colorBy, coverageScale])

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ◉
          </span>
          <div>
            <h1>Booth<span className="iq">IQ</span></h1>
            <p>
              {locked
                ? t('Your area: {area}', { area: `${scope.homeRegion ? t(scope.homeRegion.name) : '—'}${scope.home ? `, ${t(VIEWS[scope.home].title)}` : ''}` })
                : t('Booth-level intelligence · Kukatpally & Gadwal')}
            </p>
          </div>
        </div>
        <div className="top-actions">
          {hasCentre && (
            <button className={`ghost find-voter-btn ${centre ? 'is-active' : ''}`} onClick={openCentre}>
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="3" width="7" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
                <rect x="14" y="3" width="7" height="5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
                <rect x="14" y="12" width="7" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
                <rect x="3" y="16" width="7" height="5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
              {t('Command centre')}
            </button>
          )}
          <button className="ghost find-voter-btn" onClick={() => openVoterTool('find')}>
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="10" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M3 20c0-3.5 3-6 7-6M16 16l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
              <circle cx="15" cy="15" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
            {t('Find voter')}
          </button>
          {scope.canReviewDuplicates && (
          <button className="ghost find-voter-btn" onClick={() => openVoterTool('dups')}>
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="11" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
              <rect x="10" y="3" width="11" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
            {t('Duplicates')}
          </button>
          )}
          {user.team && (
            <button className="ghost find-voter-btn" onClick={() => openHelp('requests')}>
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 5h16v11H8l-4 4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <path d="M8 9h8M8 12h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {t('Help requests')}
              {overdue > 0 && (
                <span className="alert-badge" title={t('{n} past the time limit', { n: overdue })}>
                  {overdue}
                </span>
              )}
            </button>
          )}
          <span className="user-chip" title={user.username}>
            <span className="muted">{t('Signed in:')} </span>
            {user.name}
            {user.team && user.role && <span className="muted"> · {t(ROLE_LABEL[user.role])}</span>}
          </span>
          <button
            className="ghost lang-btn"
            onClick={() => setLang(lang === 'te' ? 'en' : 'te')}
            title={lang === 'te' ? 'Switch to English' : 'తెలుగులోకి మార్చండి'}
            lang={lang === 'te' ? 'en' : 'te'}
          >
            {lang === 'te' ? 'English' : 'తెలుగు'}
          </button>
          <button className="ghost" onClick={onLogout}>
            {t('Log out')}
          </button>
          {!locked && AC_VIEWS.filter((v) => v !== view).map((v) => (
            <button key={v} className="primary" onClick={() => go(v)}>
              {t(VIEWS[v].title)} ✈
            </button>
          ))}
          <button
            className="ghost icon-btn"
            aria-label={t('Toggle light / dark')}
            title={t('Toggle light / dark')}
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

      <nav className="crumbs" aria-label={t('Breadcrumb')}>
        {crumbs.map((c, i) => (
          <span key={c} className="crumb-wrap">
            {i > 0 && <span className="sep">›</span>}
            <button
              className={`crumb ${c === view ? 'is-current' : ''}`}
              aria-current={c === view ? 'page' : undefined}
              onClick={() => go(c)}
            >
              {t(VIEWS[c].title)}
            </button>
          </span>
        ))}
        {current && (
          <span className="crumb-wrap">
            <span className="sep">›</span>
            <span className="crumb is-current">{t(current.name)}</span>
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
            <span className="crumb is-current">{t('Voters')}</span>
          </span>
        )}
      </nav>

      <main className={`main ${helpTab || centre ? 'is-wide' : ''}`}>
        <section className="map-area">
          <MapView
            view={view}
            selectedId={current?.id}
            onSelect={(r) => {
              if (!regionAllowed(r)) return
              clearBooth()
              setSelected(r)
            }}
            onDrill={(v) => go(v)}
            sites={ac && showBooths ? visibleSites : booth ? [siteOf.get(booth.id)!] : []}
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
            allowedUnits={locked ? scope.units : null}
          />

          <div className="map-top">
            {locked ? (
              zoomToBooth &&
              booth && (
                <button className="back ghost" onClick={zoomedOut}>
                  ← {t('My area')}
                </button>
              )
            ) : (zoomToBooth && booth) || focusWard ? (
              <button className="back ghost" onClick={zoomedOut}>
                ← {t('All of {area}', { area: t(VIEWS[view].title) })}
              </button>
            ) : (
              VIEWS[view].parent && (
                <button className="back ghost" onClick={() => go(VIEWS[view].parent!)}>
                  ← {t(VIEWS[VIEWS[view].parent!].title)}
                </button>
              )
            )}
            <MapSearch onFind={findBooth} canSee={(b) => scope.canSeeBooth(b) && (!ac || b.ac === ac.no)} />
          </div>

          {voterBooth && (
            <VoterList
              key={`${voterBooth.id}-${voterSerial ?? ''}`}
              booth={voterBooth}
              focusSerial={voterSerial}
              user={user}
              onClose={() => {
                setVoterBooth(undefined)
                setVoterSerial(undefined)
              }}
            />
          )}
          {voterTool && (
            <VoterFinder
              tab={voterTool}
              onTab={setVoterTool}
              onClose={() => setVoterTool(null)}
              onPick={showVoter}
              onFindStation={(b) => {
                setVoterTool(null)
                findBooth(b)
              }}
              boothIds={finderBoothIds}
              acNo={ac?.no}
              canReviewDuplicates={scope.canReviewDuplicates}
            />
          )}
          {centre && (
            <CommandCentre user={user} scope={scope} team={team} onAction={onCentre} onClose={() => setCentre(false)} />
          )}
          {helpTab && (
            <HelpPanel
              key={helpStatus}
              user={user}
              tab={helpTab}
              onTab={setHelpTab}
              onClose={() => setHelpTab(null)}
              onOpenVoter={showVoter}
              onShowCoverage={showCoverage}
              initialStatus={helpStatus}
            />
          )}

          <div className="map-legend">
            {ac && showBooths && measures.length > 0 && (
              <label>
                <span className="legend-title">{t('Colour stations by')}</span>
                <select className="legend-select" value={colorBy} onChange={(e) => chooseColorBy(e.target.value)}>
                  <option value="none">{t('Nothing (show ward density)')}</option>
                  {coverageScale && <option value="coverage">{t('Booth lead coverage (team)')}</option>}
                  {measures.map((m) => (
                    <option key={m.id} value={m.id}>
                      {t(m.label)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {colorScale ? (
              <>
                <ul className="legend-classes">
                  {(colorScale.labels ?? CLASS_LABELS).map((label, i) => (
                    <li key={label}>
                      <span className="class-swatch" style={{ background: `var(--div-${['low', 'mid', 'high'][i]})` }} />
                      {t(label)}
                      {!colorScale.labels && (
                        <b>
                          {i === 0 && `< ${colorScale.measure.format(colorScale.low)}`}
                          {i === 1 &&
                            `${colorScale.measure.format(colorScale.low)}–${colorScale.measure.format(colorScale.high)}`}
                          {i === 2 && `> ${colorScale.measure.format(colorScale.high)}`}
                        </b>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="legend-hint">
                  {colorScale.labels
                    ? t('{pct} of polling stations have a booth lead', { pct: colorScale.measure.format(colorScale.average) })
                    : t('{area} average {value}', { area: t(ac?.name ?? ''), value: colorScale.measure.format(colorScale.average) })}
                  {ac && acMeta(ac.no).synthetic ? ` · ${t('sample data')}` : ''}
                </div>
                {!focusWard && !focusSite && ac && (
                  <div className="legend-hint">{t(`Click a ${ac.unitLabel.toLowerCase()} to zoom in`)}</div>
                )}
              </>
            ) : (
              <>
                <div className="legend-title">{t('Population density (people / km²)')}</div>
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
                    <span className="hl-swatch" /> {t('Glowing outline = click to zoom in')}
                  </div>
                )}
                {ac && showBooths && acBooths.length > 0 && (
                  <div className="legend-hint">
                    <span className="pin-swatch" /> {t('Polling station')}{acMeta(ac.no).synthetic ? ` (${t('sample')})` : ''}
                    {!focusWard && !focusSite && ` · ${t(`click a ${ac.unitLabel.toLowerCase()} to zoom in`)}`}
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <StatsPanel
          view={view}
          selected={current}
          locked={locked}
          myStations={
            locked && user.role === 'booth_lead' && !booth && scope.boothIds
              ? boothsOfAc(ac?.no ?? 0).filter((b) => scope.canSeeBooth(b))
              : undefined
          }
          canSeeBooth={scope.canSeeBooth}
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
        {t('Boundaries: Census-based district maps (udit-001/india-maps-data), GHMC wards from OpenStreetMap via DataMeet. State & district figures: Census of India 2011.')}{' '}
        {boothMeta.synthetic ? t('Ward and mandal figures, polling stations and voters are illustrative samples.') : t('Ward and mandal figures are illustrative samples.')}{' '}
        {t('Gadwal mandal boundaries: gggodhwani/telangana_boundaries.')}
      </footer>
    </div>
  )
}
