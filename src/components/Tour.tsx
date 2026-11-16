import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { t } from '../i18n'

export interface TourStep {
  title: string
  body: string
  /** CSS selector to spotlight; none = a centred card. */
  target?: string
  /** Puts the app in the right state for this step (open a panel, fly the map, …). */
  run?: () => void | Promise<void>
  /** How long to wait for the target to appear (ms). */
  wait?: number
}

type Rect = { x: number; y: number; w: number; h: number }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function visibleRect(sel: string): Rect | null {
  const el = document.querySelector(sel)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width < 4 || r.height < 4) return null
  // Clip to the viewport so a tall panel still gets a sensible frame.
  const x = Math.max(4, r.left)
  const y = Math.max(4, r.top)
  const w = Math.min(window.innerWidth - 4, r.right) - x
  const h = Math.min(window.innerHeight - 4, r.bottom) - y
  return w > 4 && h > 4 ? { x, y, w, h } : null
}

/**
 * Guided demo tour: each step drives the app itself, then spotlights one part of
 * the screen with a short caption. Clicks on the page are paused during the tour;
 * use Next / Back (or the arrow keys) and Esc to leave.
 */
export default function Tour({ steps, onExit }: { steps: TourStep[]; onExit: () => void }) {
  const [i, setI] = useState(0)
  const [busy, setBusy] = useState(true)
  const [rect, setRect] = useState<Rect | null>(null)
  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const cardRef = useRef<HTMLDivElement>(null)
  const [cardH, setCardH] = useState(220)
  const step = steps[i]
  const last = i === steps.length - 1

  // Run the step, then wait for its target.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setBusy(true)
      setRect(null)
      const s = stepsRef.current[i]
      try {
        await s.run?.()
      } catch (e) {
        console.error('tour step failed', e)
      }
      if (s.target) {
        const until = Date.now() + (s.wait ?? 8000)
        while (!cancelled && Date.now() < until && !visibleRect(s.target)) await sleep(150)
      }
      if (cancelled) return
      setRect(s.target ? visibleRect(s.target) : null)
      setBusy(false)
    })()
    return () => {
      cancelled = true
    }
  }, [i])

  // Follow the target while the map animates or panels settle.
  useEffect(() => {
    if (busy || !step.target) return
    const id = setInterval(() => setRect(visibleRect(step.target!)), 250)
    return () => clearInterval(id)
  }, [busy, step.target])

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight)
  })

  const next = useCallback(() => {
    if (busy) return
    if (last) onExit()
    else setI((n) => n + 1)
  }, [busy, last, onExit])
  const back = useCallback(() => !busy && setI((n) => Math.max(0, n - 1)), [busy])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      else if (e.key === 'ArrowLeft') back()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [next, back, onExit])

  // Card placement: below or above the spotlight, else a corner; a bottom sheet on phones.
  const vw = window.innerWidth
  const vh = window.innerHeight
  const W = Math.min(400, vw - 32)
  const phone = vw < 700
  let pos: CSSProperties
  if (phone) pos = { left: 12, right: 12, bottom: 12 }
  else if (!rect) pos = { left: (vw - W) / 2, top: Math.max(16, (vh - cardH) / 2), width: W }
  else {
    const left = Math.min(Math.max(16, rect.x), vw - W - 16)
    if (rect.y + rect.h + 16 + cardH < vh - 8) pos = { left, top: rect.y + rect.h + 14, width: W }
    else if (rect.y - 16 - cardH > 8) pos = { left, top: rect.y - 14 - cardH, width: W }
    else pos = { right: 24, bottom: 24, width: W }
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={t('Demo tour')}>
      {/* Pauses clicks on the page while the tour drives it. */}
      <div className={`tour-block ${rect ? '' : 'is-dim'}`} onClick={(e) => e.stopPropagation()} />
      {rect && (
        <div
          className="tour-spot"
          style={{ left: rect.x - 6, top: rect.y - 6, width: rect.w + 12, height: rect.h + 12 }}
          aria-hidden="true"
        />
      )}
      <div ref={cardRef} className={`tour-card ${phone ? 'is-sheet' : ''}`} style={pos} aria-live="polite">
        <div className="tour-top">
          <span className="kicker">
            {t('Demo tour')} · {i + 1} / {steps.length}
          </span>
          <button className="link-btn" onClick={onExit}>
            {t('Exit tour')}
          </button>
        </div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-dots" aria-hidden="true">
          {steps.map((_, n) => (
            <span key={n} className={n === i ? 'is-on' : n < i ? 'is-done' : ''} />
          ))}
        </div>
        <div className="tour-actions">
          <button className="ghost" onClick={back} disabled={busy || i === 0}>
            ← {t('Back')}
          </button>
          <button className="primary" onClick={next} disabled={busy} autoFocus>
            {busy ? t('Getting it ready…') : last ? t('Finish') : `${t('Next')} →`}
          </button>
        </div>
      </div>
    </div>
  )
}
