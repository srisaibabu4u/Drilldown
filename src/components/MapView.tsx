import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { interpolateZoom, type ZoomView } from 'd3-interpolate'
import { easeCubicInOut } from 'd3-ease'
import {
  boundsOf,
  centroid,
  districts,
  kukatpallyWards,
  pathGen,
  states,
  VIEW_ORDER,
  VIEWS,
  wards,
  type Region,
  type ViewId,
} from '../geo'
import { densityColor, densityScale, fmtInt, fmtDensity } from '../format'
import { boothMeta, buildingName, summarize, type Booth, type Site } from '../booths'
import { CLASS_LABELS, type MeasureScale } from '../measures'

interface Props {
  view: ViewId
  selectedId?: string
  onSelect: (r: Region) => void
  onDrill: (v: ViewId, from: Region) => void
  /** Polling booths to draw (Kukatpally level only); empty to hide. */
  sites: Site[]
  selectedBoothNo?: number
  onBoothClick: (b: Booth) => void
  onBoothClose: () => void
  /** When set, the camera zooms in on this point (virtual units) instead of the whole view. */
  focus?: { x: number; y: number }
  /** When set (and no `focus`), the camera fits these bounds, e.g. a selected ward. */
  focusBounds?: [[number, number], [number, number]]
  /** Ward the user zoomed into: stations elsewhere are faded. */
  focusWardNo?: number
  /** Colour station pins by this measure (and show Kukatpally wards in neutral grey). */
  colorScale?: MeasureScale | null
}

const CLASS_FILL = ['var(--div-low)', 'var(--div-mid)', 'var(--div-high)']

type Hover = { kind: 'region'; r: Region; x: number; y: number } | { kind: 'site'; s: Site; x: number; y: number }

interface Size {
  w: number
  h: number
}

/** Camera as a d3 ZoomView: [centerX, centerY, width] in projected units. */
function cameraFor(view: ViewId, size: Size): ZoomView {
  return fitBounds(boundsOf(VIEWS[view].focus), size, view === 'india' ? 1.04 : 1.18)
}

function fitBounds([[x0, y0], [x1, y1]]: [[number, number], [number, number]], size: Size, pad: number): ZoomView {
  const aspect = size.w / size.h
  const bw = (x1 - x0) * pad
  const bh = (y1 - y0) * pad
  const width = Math.max(bw, bh * aspect)
  return [(x0 + x1) / 2, (y0 + y1) / 2, width]
}

// Map-pin marker in screen pixels, tip at (0,0).
const PIN = 'M0,0 C-1.8,-3.6 -6,-6.6 -6,-11.5 A6,6 0 1 1 6,-11.5 C6,-6.6 1.8,-3.6 0,0Z'
const PIN_LARGE = 'M0,0 C-2.4,-4.6 -7.5,-8.2 -7.5,-14 A7.5,7.5 0 1 1 7.5,-14 C7.5,-8.2 2.4,-4.6 0,0Z'

function viewBox(z: ZoomView, size: Size) {
  const w = z[2]
  const h = w * (size.h / size.w)
  return `${z[0] - w / 2} ${z[1] - h / 2} ${w} ${h}`
}

const paths = new Map<string, string>()
function d(r: Region) {
  let p = paths.get(r.id)
  if (!p) {
    p = pathGen(r.feature) ?? ''
    paths.set(r.id, p)
  }
  return p
}

export default function MapView({ view, selectedId, onSelect, onDrill, sites, selectedBoothNo, onBoothClick, onBoothClose, focus, focusBounds, focusWardNo, colorScale }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState<Size>({ w: 800, h: 700 })
  const camRef = useRef<ZoomView | null>(null)
  const [settled, setSettled] = useState<ZoomView | null>(null)
  const [animating, setAnimating] = useState(false)
  const [hover, setHover] = useState<Hover | null>(null)
  const hideTimer = useRef<number | undefined>(undefined)

  // Tooltips linger briefly so they can be read (and entered, for station tooltips).
  const cancelHide = () => window.clearTimeout(hideTimer.current)
  const scheduleHide = (ms = 450) => {
    cancelHide()
    hideTimer.current = window.setTimeout(() => setHover(null), ms)
  }
  const hoverRef = useRef<Hover | null>(null)
  hoverRef.current = hover
  const show = (h: Hover) => {
    cancelHide()
    setHover(h)
  }
  useEffect(() => cancelHide, [])

  // Track container size.
  useLayoutEffect(() => {
    const el = wrapRef.current!
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      if (width > 0 && height > 0) setSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // focusBounds arrives as a fresh array each render; compare it by value.
  const focusKey = focusBounds ? focusBounds.flat().join(',') : ''

  // Animate the camera whenever the view, focus or container size changes.
  useEffect(() => {
    const svg = svgRef.current!
    const target: ZoomView = focus
      ? [focus.x, focus.y, cameraFor('kukatpally', size)[2] / 4]
      : focusBounds
        ? fitBounds(focusBounds, size, 1.25)
        : cameraFor(view, size)
    const from = camRef.current
    if (!from) {
      camRef.current = target
      svg.setAttribute('viewBox', viewBox(target, size))
      setSettled(target)
      return
    }
    const interp = interpolateZoom(from, target)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = reduce ? 0 : Math.min(3200, Math.max(700, interp.duration * 0.7))
    let raf = 0
    const t0 = performance.now()
    setAnimating(true)
    setHover(null)
    const step = (now: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (now - t0) / duration)
      const z = interp(easeCubicInOut(t))
      camRef.current = z
      svg.setAttribute('viewBox', viewBox(z, size))
      if (t < 1) raf = requestAnimationFrame(step)
      else {
        setAnimating(false)
        setSettled(target)
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [view, size, focus?.x, focus?.y, focusKey])

  const level = VIEW_ORDER.indexOf(view)
  const active = VIEWS[view].regions
  const scale = useMemo(() => densityScale(active), [active])

  // px -> user units at the settled camera (for label sizes / stroke tweaks)
  const unit = settled ? settled[2] / size.w : 1
  // Zoomed in past the whole-Kukatpally view (a ward or a single station): show pin icons.
  const zoomedIn = settled !== null && settled[2] < cameraFor('kukatpally', size)[2] * 0.6

  const pointer = (e: React.PointerEvent) => {
    const box = wrapRef.current!.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }
  const handleMove = (r: Region) => (e: React.PointerEvent) => {
    // A station tooltip keeps priority until it fades, so moving off a small pin
    // onto the ward underneath doesn't instantly replace it.
    if (hoverRef.current?.kind === 'site') return
    show({ kind: 'region', r, ...pointer(e) })
  }

  /** Screen position (px, relative to the map box) of a point in virtual units. */
  const toScreen = (x: number, y: number) => {
    const [cx, cy, w] = camRef.current ?? [0, 0, 1]
    const k = w / size.w
    const h = w * (size.h / size.w)
    return { x: (x - (cx - w / 2)) / k, y: (y - (cy - h / 2)) / k }
  }
  const selectedSite = selectedBoothNo !== undefined ? sites.find((s) => s.booths.some((b) => b.no === selectedBoothNo)) : undefined

  const interactiveProps = (r: Region) => ({
    onPointerMove: handleMove(r),
    onPointerLeave: () => scheduleHide(150),
    onClick: () => (r.drillTo ? onDrill(r.drillTo, r) : onSelect(r)),
    tabIndex: 0,
    role: 'button',
    'aria-label': `${r.name}${r.drillTo ? ', open' : ''}`,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        if (r.drillTo) onDrill(r.drillTo, r)
        else onSelect(r)
      }
    },
  })

  const renderLayer = (regions: Region[], isActive: boolean, cls: string) => (
    <g className={`layer ${cls} ${isActive ? 'is-active' : 'is-context'}`}>
      {regions.map((r) => {
        const isSel = r.id === selectedId
        const fill = !isActive
          ? undefined
          : colorScale && view === 'kukatpally'
            ? 'var(--land-muted)'
            : densityColor(scale, r)
        return (
          <path
            key={r.id}
            d={d(r)}
            className={[
              'region',
              isSel && 'is-selected',
              r.drillTo && 'is-drillable',
              hover?.kind === 'region' && hover.r.id === r.id && 'is-hover',
            ]
              .filter(Boolean)
              .join(' ')}
            style={fill ? { fill } : undefined}
            {...(isActive && !animating ? interactiveProps(r) : {})}
          />
        )
      })}
    </g>
  )

  // Labels for the settled active layer: only where the shape is big enough on screen.
  const labels =
    settled && !animating
      ? active
          .map((r) => {
            const [[x0, y0], [x1, y1]] = pathGen.bounds(r.feature)
            const wpx = (x1 - x0) / unit
            const hpx = (y1 - y0) / unit
            const [cx, cy] = centroid(r.feature)
            const minW = view === 'ghmc' ? 70 : 46
            return { r, cx, cy, ok: wpx > minW && hpx > 18, big: wpx > 110 }
          })
          // At city level the Kukatpally wards get one group label instead of eleven.
          .filter((l) => (view === 'ghmc' && l.r.drillTo ? false : l.ok || l.r.drillTo || l.r.id === selectedId))
      : []

  const drillHint = useMemo(() => active.filter((r) => r.drillTo), [active])

  // One label for the whole Kukatpally cluster when viewing the city.
  const groupLabel = useMemo(() => {
    if (view !== 'ghmc') return null
    const [[x0, y0], [x1]] = boundsOf(drillHint.map((r) => r.feature))
    return { x: (x0 + x1) / 2, y: y0 }
  }, [view, drillHint])

  return (
    <div className="map-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="map"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Map of ${VIEWS[view].title}`}
      >
        <defs>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={6 * unit} result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {renderLayer(states, level === 0, 'states')}
        {level >= 1 && renderLayer(districts, level === 1, 'districts')}
        {level >= 2 && renderLayer(wards, level === 2, 'wards')}
        {level >= 3 && renderLayer(kukatpallyWards, true, 'kukatpally')}

        {/* Pulsing call-out for the drillable regions */}
        {!animating &&
          drillHint.map((r) => (
            <path key={`hl-${r.id}`} d={d(r)} className="drill-outline" filter="url(#glow)" />
          ))}

        {view === 'kukatpally' && !animating && sites.length > 0 && (
          <g className="booths">
            {sites.map((site) => {
              const first = site.booths[0]
              const n = site.booths.length
              const sel = site.booths.some((b) => b.no === selectedBoothNo)
              const open = () => {
                cancelHide()
                setHover(null)
                onBoothClick(first)
              }
              const faded = focusWardNo !== undefined && first.wardNo !== focusWardNo && !sel
              const cls = colorScale ? colorScale.classOf(colorScale.siteValue(site)) : undefined
              const fillStyle = cls !== undefined ? { fill: CLASS_FILL[cls] } : undefined
              return (
                <g
                  key={site.key}
                  className={[
                    'booth',
                    zoomedIn ? 'is-pin' : 'is-dot',
                    sel && 'is-selected',
                    faded && 'is-faded',
                    first.precision === 'approx' && 'is-approx',
                    cls !== undefined && 'is-coloured',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  // scale(unit) lets the marker be drawn in screen pixels
                  transform={`translate(${site.x},${site.y}) scale(${unit})`}
                  onPointerEnter={() => {
                    if (site !== selectedSite) show({ kind: 'site', s: site, ...toScreen(site.x, site.y) })
                  }}
                  onPointerLeave={() => scheduleHide()}
                  onClick={open}
                  tabIndex={zoomedIn || sel ? 0 : -1}
                  role="button"
                  aria-label={`${buildingName(first)}, ${n} polling station${n > 1 ? 's' : ''}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      open()
                    }
                  }}
                >
                  {zoomedIn ? (
                    <>
                      <circle className="booth-hit" cx={0} cy={-10} r={12} />
                      <path className="booth-pin" d={sel ? PIN_LARGE : PIN} style={fillStyle} />
                      {n > 1 ? (
                        <text className="booth-count" y={sel ? -14 : -11.5}>
                          {n}
                        </text>
                      ) : (
                        <circle className="booth-pin-eye" cy={sel ? -14 : -11.5} r={sel ? 2.4 : 2} />
                      )}
                    </>
                  ) : (
                    <>
                      <circle className="booth-hit" r={7} />
                      <circle
                        className="booth-dot"
                        r={sel ? 5 : cls !== undefined ? 3.4 : n > 1 ? 3 : 2.4}
                        style={fillStyle}
                      />
                    </>
                  )}
                </g>
              )
            })}
          </g>
        )}

        <g className="labels" aria-hidden="true">
          {labels.map(({ r, cx, cy, big }) => (
            <text
              key={`lb-${r.id}`}
              x={cx}
              y={cy}
              className={`label ${r.drillTo ? 'label-drill' : ''}`}
              style={{ fontSize: (big ? 12 : 10.5) * unit, strokeWidth: 3 * unit }}
            >
              {r.name}
            </text>
          ))}
          {groupLabel && !animating && (
            <text
              x={groupLabel.x}
              y={groupLabel.y - 10 * unit}
              className="label group-label"
              style={{ fontSize: 14 * unit, strokeWidth: 4 * unit }}
            >
              Kukatpally ↘
            </text>
          )}
        </g>
      </svg>

      {hover && (
        <div
          className={`tooltip ${hover.kind === 'site' ? 'is-anchored' : ''}`}
          style={{
            left: Math.max(8, Math.min(hover.x + 14, size.w - 240)),
            top: Math.max(8, Math.min(hover.kind === 'site' ? hover.y - 16 : hover.y - 10, size.h - 170)),
          }}
          onPointerEnter={hover.kind === 'site' ? cancelHide : undefined}
          onPointerLeave={hover.kind === 'site' ? () => scheduleHide(200) : undefined}
        >
          {hover.kind === 'site' ? (
            <>
              <div className="tt-title">{buildingName(hover.s.booths[0])}</div>
              <div className="tt-addr">{hover.s.booths[0].address}</div>
              <div className="tt-row">
                <span>{hover.s.booths.length > 1 ? 'Stations' : 'Station'}</span>
                <b>PS {hover.s.booths.map((b) => b.no).join(', ')}</b>
              </div>
              {hover.s.booths.some((b) => b.voters !== undefined) && (
                <div className="tt-row">
                  <span>Electors</span>
                  <b>{fmtInt(hover.s.booths.reduce((a, b) => a + (b.voters ?? 0), 0))}</b>
                </div>
              )}
              {(() => {
                const t = summarize(hover.s.booths)?.turnout
                return t !== undefined && colorScale?.measure.id !== 'turnout' ? (
                  <div className="tt-row">
                    <span>Turnout (last AE)</span>
                    <b>{t.toFixed(1)}%</b>
                  </div>
                ) : null
              })()}
              {colorScale &&
                (() => {
                  const v = colorScale.siteValue(hover.s)
                  const c = colorScale.classOf(v)
                  return v !== undefined && c !== undefined ? (
                    <>
                      <div className="tt-row">
                        <span>{colorScale.measure.label}</span>
                        <b>{colorScale.measure.format(v)}</b>
                      </div>
                      <div className="tt-class">
                        <span className="class-swatch" style={{ background: CLASS_FILL[c] }} />
                        {CLASS_LABELS[c]} (avg {colorScale.measure.format(colorScale.average)})
                      </div>
                    </>
                  ) : null
                })()}
              {boothMeta.synthetic && <div className="tt-note">Sample data · not a real station</div>}
              {!boothMeta.synthetic && hover.s.booths[0].precision === 'approx' && (
                <div className="tt-note">Approximate location</div>
              )}
            </>
          ) : (
            <>
              <div className="tt-title">
                {hover.r.wardNo ? `Ward ${hover.r.wardNo} · ` : ''}
                {hover.r.name}
              </div>
              {hover.r.stats && (
                <div className="tt-row">
                  <span>Population</span>
                  <b>{fmtInt(hover.r.stats.population)}</b>
                </div>
              )}
              {hover.r.stats && (
                <div className="tt-row">
                  <span>Density</span>
                  <b>{fmtDensity(hover.r.stats.population / hover.r.areaKm2)}</b>
                </div>
              )}
              {hover.r.stats?.source === 'sample' && <div className="tt-note">Sample data</div>}
              {hover.r.drillTo && <div className="tt-cta">Click to zoom in →</div>}
            </>
          )}
        </div>
      )}
      {selectedSite && !animating && view === 'kukatpally' && (() => {
        const p = toScreen(selectedSite.x, selectedSite.y)
        if (p.x < 0 || p.y < 0 || p.x > size.w || p.y > size.h) return null
        const sel = selectedSite.booths.find((b) => b.no === selectedBoothNo)!
        const below = p.y < 190
        return (
          <div
            className={`pin-popup ${below ? 'is-below' : ''}`}
            style={{
              left: Math.max(8, Math.min(p.x - 120, size.w - 248)),
              // sit above the marker, or below it when there's no room under the search bar
              top: below ? p.y + 10 : p.y - (zoomedIn ? 26 : 12),
            }}
          >
            <button className="pin-close" aria-label="Close" onClick={onBoothClose}>
              ×
            </button>
            <div className="tt-title">PS {sel.no}</div>
            <div className="tt-addr">{buildingName(sel)}</div>
            {selectedSite.booths.length > 1 && (
              <div className="pin-others">
                {selectedSite.booths.map((b) => (
                  <button
                    key={b.no}
                    className={b.no === sel.no ? 'is-current' : ''}
                    onClick={() => onBoothClick(b)}
                  >
                    {b.no}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
