import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Ab dieser Zugstrecke (px) bzw. mit Schwung schliesst das Sheet beim Loslassen. */
const CLOSE_DISTANCE = 120
const CLOSE_VELOCITY = 0.5 // px/ms
const SLIDE_MS = 280

/**
 * Book auf dem Smartphone als Bottom-Sheet über der Karte: fährt von unten hoch,
 * oben bleibt ein Streifen Karte sichtbar. Schliessen per Griff nach unten ziehen
 * oder Tippen auf den Kartenstreifen – das Sheet fährt dann wieder hinunter.
 */
export function BookSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [closing, setClosing] = useState(false)
  const start = useRef<{ id: number; y: number; t: number } | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const close = () => setClosing(true)

  // Nach der Ausfahr-Animation wirklich schliessen (Fallback, falls transitionend ausbleibt).
  useEffect(() => {
    if (!closing) return
    const t = window.setTimeout(() => onCloseRef.current(), SLIDE_MS + 60)
    return () => window.clearTimeout(t)
  }, [closing])

  return (
    <div className="absolute inset-0 z-20 md:hidden">
      {/* Kartenstreifen oben: leicht abgedunkelt, Tippen schliesst. */}
      <button
        className="absolute inset-0 bg-black/25 transition-opacity duration-300"
        style={{ opacity: closing ? 0 : Math.max(0, 1 - dragY / 400) }}
        aria-label="Book schliessen, zurück zur Karte"
        onClick={close}
      />

      <div
        className={`absolute inset-x-0 bottom-0 top-12 flex flex-col overflow-hidden rounded-t-2xl bg-gray-100 shadow-[0_-8px_30px_rgba(0,0,0,0.25)] ${
          closing || dragY > 0 ? '' : 'motion-safe:animate-sheet-up'
        }`}
        style={{
          transform: closing ? 'translateY(100%)' : dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragging ? 'none' : `transform ${SLIDE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`,
        }}
        role="dialog"
        aria-label="Book"
      >
        {/* Griff: nach unten ziehen schliesst. touch-none, damit der Browser nicht scrollt. */}
        <div
          className="flex h-7 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
          onPointerDown={(e) => {
            start.current = { id: e.pointerId, y: e.clientY, t: Date.now() }
            e.currentTarget.setPointerCapture(e.pointerId)
            setDragging(true)
          }}
          onPointerMove={(e) => {
            const s = start.current
            if (!s || s.id !== e.pointerId) return
            // Nur nach unten ziehbar, 1:1 mit dem Finger.
            const dy = e.clientY - s.y
            setDragY(dy > 0 ? dy : 0)
          }}
          onPointerUp={(e) => {
            const s = start.current
            if (!s || s.id !== e.pointerId) return
            start.current = null
            setDragging(false)
            const dy = Math.max(0, e.clientY - s.y)
            const v = dy / Math.max(1, Date.now() - s.t)
            // Antippen ohne Zug: ebenfalls schliessen (Griff als Knopf).
            if (dy < 4 || dy > CLOSE_DISTANCE || v > CLOSE_VELOCITY) close()
            else setDragY(0)
          }}
          onPointerCancel={() => {
            start.current = null
            setDragging(false)
            setDragY(0)
          }}
          aria-hidden="true"
        >
          <span className="h-1.5 w-10 rounded-full bg-gray-300" />
        </div>

        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
