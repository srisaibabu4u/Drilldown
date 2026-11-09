import { useId, useMemo, useRef, useState } from 'react'
import { acName, booths, buildingName, searchBooths, type Booth } from '../booths'

/** Search box over the map: find a polling station by number, building or street. */
export default function MapSearch({ onFind }: { onFind: (b: Booth) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const results = useMemo(() => (q.trim() ? searchBooths(booths, q).slice(0, 8) : []), [q])

  if (booths.length === 0) return null

  const choose = (b: Booth) => {
    onFind(b)
    setQ(`${acName(b.ac)} PS ${b.no} · ${buildingName(b)}`)
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div className="map-search" role="search">
      <svg className="map-search-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        value={q}
        placeholder="Find polling station (no., school, street)"
        aria-label="Find polling station"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        onChange={(e) => {
          setQ(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={(e) => {
          e.target.select()
          setOpen(true)
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault()
            choose(results[active])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && q.trim() && (
        <ul className="map-search-results" id={listId} role="listbox">
          {results.map((b, i) => (
            <li
              key={b.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : ''}
              onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => {
                e.preventDefault()
                choose(b)
              }}
            >
              <span className="booth-no">{b.no}</span>
              <span className="msr-text">
                <span className="msr-name">{b.name}</span>
                <span className="msr-addr">
                  AC {b.ac} {acName(b.ac)} · {b.address}
                </span>
              </span>
            </li>
          ))}
          {results.length === 0 && <li className="msr-empty">No polling station matches “{q.trim()}”</li>}
        </ul>
      )}
    </div>
  )
}
