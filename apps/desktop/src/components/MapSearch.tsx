import { useEffect, useRef, useState } from 'react'
import { searchLocations, type LocationResult } from '../lib/geo-search'

interface Props {
  onPick: (result: LocationResult) => void
}

/** Ortssuche in der Karte (GeoAdmin SearchServer), debounced mit Dropdown. */
export function MapSearch({ onPick }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LocationResult[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  // Nach einer Auswahl setzt pick() die Query aufs Label — das darf keine
  // neue Suche (und kein wieder aufklappendes Dropdown) auslösen.
  const suppressRef = useRef(false)

  useEffect(() => {
    if (suppressRef.current) {
      suppressRef.current = false
      return
    }
    abortRef.current?.abort()
    if (query.trim().length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    const timer = window.setTimeout(async () => {
      try {
        const found = await searchLocations(query.trim(), controller.signal)
        setResults(found)
        setActive(0)
        setOpen(found.length > 0)
      } catch {
        // Abbruch/Netzfehler: Dropdown einfach nicht öffnen.
      }
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const pick = (r: LocationResult) => {
    suppressRef.current = true
    setOpen(false)
    setResults([])
    setQuery(r.label)
    onPick(r)
  }

  return (
    <div className="relative w-full max-w-xs">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, results.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' && results[active]) {
            pick(results[active])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        placeholder="🔍 Ort suchen …"
        className="w-full rounded-lg border border-gray-200 bg-white/95 px-3 py-1.5 text-sm shadow-md outline-none focus:border-blue-400"
      />
      {open && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {results.map((r, i) => (
            <li key={`${r.lon},${r.lat},${r.label}`}>
              <button
                className={`block w-full px-3 py-2 text-left text-sm ${
                  i === active ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(r)
                }}
              >
                <span className="text-gray-900">{r.label}</span>
                {r.kind && <span className="ml-2 text-xs text-gray-400">{r.kind}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
