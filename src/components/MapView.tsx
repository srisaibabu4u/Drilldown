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

interface Props {
  view: ViewId
  selectedId?: string
  onSelect: (r: Region) => void
  onDrill: (v: ViewId, from: Region) => void
}

interface Size {
  w: number
  h: number
}

/** Camera as a d3 ZoomView: [centerX, centerY, width] in projected units. */
function cameraFor(view: ViewId, size: Size): ZoomView {
  const [[x0, y0], [x1, y1]] = boundsOf(VIEWS[view].focus)
  const pad = view === 'india' ? 1.04 : 1.18
  const aspect = size.w / size.h
  const bw = (x1 - x0) * pad
  const bh = (y1 - y0) * pad
  const width = Math.max(bw, bh * aspect)
  return [(x0 + x1) / 2, (y0 + y1) / 2, width]
}

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

export default function MapView({ view, selectedId, onSelect, onDrill }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState<Size>({ w: 800, h: 700 })
  const camRef = useRef<ZoomView | null>(null)
  const [settled, setSettled] = useState<ZoomView | null>(null)
  const [animating, setAnimating] = useState(false)
  const [hover, setHover] = useState<{ r: Region; x: number; y: number } | null>(null)

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

  // Animate the camera whenever the view (or container size) changes.
  useEffect(() => {
    const svg = svgRef.current!
    const target = cameraFor(view, size)
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
  }, [view, size])

  const level = VIEW_ORDER.indexOf(view)
  const active = VIEWS[view].regions
  const scale = useMemo(() => densityScale(active), [active])

  // px -> user units at the settled camera (for label sizes / stroke tweaks)
  const unit = settled ? settled[2] / size.w : 1

  const handleMove = (r: Region) => (e: React.PointerEvent) => {
    const box = wrapRef.current!.getBoundingClientRect()
    setHover({ r, x: e.clientX - box.left, y: e.clientY - box.top })
  }

  const interactiveProps = (r: Region) => ({
    onPointerMove: handleMove(r),
    onPointerLeave: () => setHover(null),
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
        const fill = isActive ? densityColor(scale, r) : undefined
        return (
          <path
            key={r.id}
            d={d(r)}
            className={[
              'region',
              isSel && 'is-selected',
              r.drillTo && 'is-drillable',
              hover?.r.id === r.id && 'is-hover',
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
          className="tooltip"
          style={{
            left: Math.min(hover.x + 14, size.w - 220),
            top: Math.max(8, hover.y - 10),
          }}
        >
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
        </div>
      )}
    </div>
  )
}
