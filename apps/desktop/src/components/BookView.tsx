import { useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { Card, Image } from '@tourenbuch/shared'
import { useCards, useCardMutations, useTourImages } from '../hooks/useCards'
import { useApi } from '../lib/api'
import { resolveImageUrls, type DerivativeUrls } from '../lib/image-store'
import { ConfirmDialog } from './ConfirmDialog'

interface Props {
  tourId: string
  /** Tour-Name — wird als Haupttitel des Books angezeigt. */
  tourName: string
  /** Card, zu der gescrollt werden soll (Klick auf Foto-Pin). */
  highlightCardId: string | null
  onHighlightDone: () => void
  /** Fremde (geteilte) Touren: Editier-Controls werden nicht gerendert. */
  readOnly?: boolean
  /**
   * 'page': Book-Reiter (Grid). 'panel': schmale Spalte rechts auf der Karte —
   * Kacheln kompakt untereinander, eine davon nach links über die Karte aufklappbar.
   */
  variant?: 'page' | 'panel'
}

/** Markdown grob zu Fliesstext für die Kompaktansicht (Kachel-Vorschau). */
function plainSnippet(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/[*_`>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function renderMarkdown(md: string): string {
  // breaks: einfacher Zeilenumbruch im Editor = <br> in der Anzeige.
  return DOMPurify.sanitize(marked.parse(md, { async: false, gfm: true, breaks: true }))
}

/** Textarea an ihren Inhalt anpassen (Titel umbricht statt abzuschneiden). */
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

/** Display-/Thumb-URLs für eine Bildliste auflösen (lokal oder aus R2). */
function useImageUrls(images: Image[]) {
  const api = useApi()
  const [urls, setUrls] = useState<Record<string, DerivativeUrls | null>>({})
  const key = images.map((i) => i.id).join(',')
  useEffect(() => {
    let alive = true
    void Promise.all(
      images.map(async (img) => [img.id, await resolveImageUrls(img, api)] as const)
    ).then((entries) => {
      if (alive) setUrls(Object.fromEntries(entries))
    })
    return () => {
      alive = false
    }
    // key repräsentiert die Bildliste; images selbst wechselt die Identität pro Fetch.
  }, [key, api])
  return urls
}

interface ViewboxState {
  cardId: string
  index: number
}

export function BookView({
  tourId,
  tourName,
  highlightCardId,
  onHighlightDone,
  readOnly = false,
  variant = 'page',
}: Props) {
  const panel = variant === 'panel'
  const { data: cards, isLoading } = useCards(tourId)
  const { data: images } = useTourImages(tourId)
  const mutations = useCardMutations(tourId)
  const [deleteCandidate, setDeleteCandidate] = useState<Card | null>(null)
  const [imageDeleteCandidate, setImageDeleteCandidate] = useState<Image | null>(null)
  const [viewbox, setViewbox] = useState<ViewboxState | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  // Panel: die aktuell nach links aufgeklappte Kachel (höchstens eine).
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Zu markierter Card scrollen (Foto-Pin-Klick); im Panel zusätzlich aufklappen.
  useEffect(() => {
    if (!highlightCardId) return
    if (panel) setExpandedId(highlightCardId)
    const el = document.getElementById(`card-${highlightCardId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('ring-2', 'ring-blue-500')
      const t = window.setTimeout(() => {
        el.classList.remove('ring-2', 'ring-blue-500')
        onHighlightDone()
      }, 2000)
      return () => window.clearTimeout(t)
    }
    onHighlightDone()
  }, [highlightCardId, onHighlightDone, cards, panel, expandedId])

  const handleDrop = (targetId: string) => {
    if (!dragId || !cards || dragId === targetId) return
    const ids = cards.map((c) => c.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(from, 1)
    ids.splice(to, 0, dragId)
    mutations.reorderCards.mutate(ids)
  }

  const imagesByCard = new Map<string, Image[]>()
  for (const img of images ?? []) {
    const list = imagesByCard.get(img.card_id) ?? []
    list.push(img)
    imagesByCard.set(img.card_id, list)
  }

  const viewboxImages = viewbox ? (imagesByCard.get(viewbox.cardId) ?? []) : []

  const overlays = createPortal(
    <>
      {deleteCandidate && (
        <ConfirmDialog
          title="Kachel löschen?"
          message={`«${deleteCandidate.title || 'Ohne Titel'}» wird ${
            deleteCandidate.kind === 'images' ? 'samt Bildern ' : ''
          }gelöscht.`}
          onConfirm={() => {
            mutations.deleteCard.mutate(deleteCandidate.id)
            setDeleteCandidate(null)
          }}
          onCancel={() => setDeleteCandidate(null)}
        />
      )}

      {imageDeleteCandidate && (
        <ConfirmDialog
          title="Bild entfernen?"
          message="Das Bild wird aus der Kachel entfernt und die Ableitungen gelöscht."
          onConfirm={() => {
            mutations.deleteImage.mutate(imageDeleteCandidate)
            setImageDeleteCandidate(null)
          }}
          onCancel={() => setImageDeleteCandidate(null)}
        />
      )}

      {viewbox && viewboxImages.length > 0 && (
        <Viewbox
          images={viewboxImages}
          index={Math.min(viewbox.index, viewboxImages.length - 1)}
          onNavigate={(index) => setViewbox({ ...viewbox, index })}
          onClose={() => setViewbox(null)}
        />
      )}
    </>,
    document.body
  )

  const renderFullCard = (card: Card) =>
    card.kind === 'images' ? (
      <ImagesCard
        key={card.id}
        card={card}
        images={imagesByCard.get(card.id) ?? []}
        mutations={mutations}
        readOnly={readOnly}
        onDelete={() => setDeleteCandidate(card)}
        onDeleteImage={setImageDeleteCandidate}
        onOpenViewbox={(index) => {
          // Fullscreen synchron innerhalb der Klick-Geste anfordern (User
          // Activation); der Viewer selbst mountet erst nach dem Render.
          void enterFullscreen()
          setViewbox({ cardId: card.id, index })
        }}
        dragging={dragId === card.id}
        onDragStart={() => setDragId(card.id)}
        onDragEnd={() => setDragId(null)}
        onDropOn={() => handleDrop(card.id)}
        onCollapse={panel ? () => setExpandedId(null) : undefined}
      />
    ) : (
      <TextCard
        key={card.id}
        card={card}
        mutations={mutations}
        readOnly={readOnly}
        onDelete={() => setDeleteCandidate(card)}
        dragging={dragId === card.id}
        onDragStart={() => setDragId(card.id)}
        onDragEnd={() => setDragId(null)}
        onDropOn={() => handleDrop(card.id)}
        onCollapse={panel ? () => setExpandedId(null) : undefined}
      />
    )

  if (panel) {
    const expanded = expandedId !== null && cards?.some((c) => c.id === expandedId)
    return (
      <div
        className={`flex h-full flex-col transition-[width] duration-200 ease-out ${
          expanded ? 'w-[min(64rem,calc(100vw-22rem))]' : 'w-[36rem]'
        }`}
      >
        {/* Kopf: rechtsbündig, immer in Spaltenbreite */}
        <div className="ml-auto flex w-[36rem] items-center justify-between gap-2 pb-2">
          <span className="rounded-full bg-white/90 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-gray-500 shadow-sm backdrop-blur">
            Book
          </span>
          {!readOnly && (
            <div className="flex gap-1">
              <button
                className="rounded-lg border border-gray-200 bg-white/95 px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                disabled={mutations.createCard.isPending}
                onClick={() =>
                  mutations.createCard.mutate('text', {
                    onSuccess: (c) => setExpandedId(c.id),
                  })
                }
              >
                + Text
              </button>
              <button
                className="rounded-lg border border-gray-200 bg-white/95 px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                disabled={mutations.createCard.isPending}
                onClick={() =>
                  mutations.createCard.mutate('images', {
                    onSuccess: (c) => setExpandedId(c.id),
                  })
                }
              >
                + Bilder
              </button>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
          {isLoading && (
            <p className="ml-auto w-[36rem] rounded-xl bg-white/90 p-3 text-xs text-gray-500">
              Lade Kacheln …
            </p>
          )}
          {cards && cards.length === 0 && (
            <p className="ml-auto w-[36rem] rounded-xl bg-white/90 p-3 text-xs text-gray-500 shadow-sm">
              {readOnly ? 'Noch keine Kacheln.' : 'Noch keine Kacheln – «+ Text» oder «+ Bilder».'}
            </p>
          )}
          <div className="flex flex-col gap-2 pb-1">
            {cards?.map((card) =>
              card.id === expandedId ? (
                <div key={card.id} className="w-full">
                  {renderFullCard(card)}
                </div>
              ) : (
                <CompactTile
                  key={card.id}
                  card={card}
                  images={imagesByCard.get(card.id) ?? []}
                  onExpand={() => setExpandedId(card.id)}
                />
              )
            )}
          </div>
        </div>

        {overlays}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-100 p-4 md:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="truncate text-xl font-bold text-gray-900 md:text-2xl">{tourName}</h2>
        {!readOnly && (
          <div className="flex gap-2">
            <button
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={mutations.createCard.isPending}
              onClick={() => mutations.createCard.mutate('text')}
            >
              + Text
            </button>
            <button
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={mutations.createCard.isPending}
              onClick={() => mutations.createCard.mutate('images')}
            >
              + Bilder
            </button>
          </div>
        )}
      </div>

      {isLoading && <p className="text-sm text-gray-500">Lade Cards …</p>}
      {cards && cards.length === 0 && (
        <p className="text-sm text-gray-500">
          {readOnly
            ? 'Noch keine Kacheln.'
            : 'Noch keine Kacheln – erstelle eine Text- oder Bilder-Kachel.'}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {cards?.map((card) => renderFullCard(card))}
      </div>

      {overlays}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Kompakt-Kachel (Panel auf der Karte): Vorschau, Klick klappt nach links auf
// ---------------------------------------------------------------------------

function CompactTile({
  card,
  images,
  onExpand,
}: {
  card: Card
  images: Image[]
  onExpand: () => void
}) {
  const preview = images.slice(0, 6)
  const urls = useImageUrls(preview)
  const more = images.length - preview.length
  const snippet = card.body_md ? plainSnippet(card.body_md) : ''

  return (
    <button
      id={`card-${card.id}`}
      className="group ml-auto block w-[36rem] rounded-xl border border-white/60 bg-white/95 p-3 text-left shadow-md backdrop-blur-md transition hover:-translate-x-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      title="Aufklappen"
      onClick={onExpand}
    >
      <div className="flex items-start gap-2">
        <svg
          className="mt-0.5 h-4 w-4 shrink-0 text-gray-300 transition group-hover:text-blue-600"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m15 6-6 6 6 6" />
        </svg>
        <div className="min-w-0 flex-1">
          {card.taken_at && (
            <div className="text-[11px] text-gray-400">{card.taken_at.slice(0, 10)}</div>
          )}
          <div className="line-clamp-2 text-sm font-semibold leading-snug text-gray-900">
            {card.title || (card.kind === 'images' ? 'Bilder' : 'Ohne Titel')}
          </div>
          {card.kind === 'images' ? (
            images.length === 0 ? (
              <div className="mt-1.5 text-xs text-gray-400">Noch keine Bilder</div>
            ) : (
              <div className="mt-2 grid grid-cols-6 gap-1.5">
                {preview.map((img, i) => {
                  const u = urls[img.id]
                  const last = i === preview.length - 1 && more > 0
                  return (
                    <div
                      key={img.id}
                      className="relative aspect-square overflow-hidden rounded-md bg-gray-100"
                    >
                      {u && <img src={u.thumb} className="h-full w-full object-cover" alt="" />}
                      {last && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-semibold text-white">
                          +{more}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          ) : (
            snippet && (
              <div className="mt-1 line-clamp-4 text-sm leading-snug text-gray-600">{snippet}</div>
            )
          )}
        </div>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Gemeinsame Kopfzeile (Drag-Handle, Datum, Löschen)
// ---------------------------------------------------------------------------

interface HeaderProps {
  card: Card
  readOnly: boolean
  mutations: ReturnType<typeof useCardMutations>
  onDelete: () => void
  onDragStart: () => void
  onDragEnd: () => void
  /** Panel auf der Karte: Kachel wieder nach rechts einklappen. */
  onCollapse?: () => void
}

function CardHeader({
  card,
  readOnly,
  mutations,
  onDelete,
  onDragStart,
  onDragEnd,
  onCollapse,
}: HeaderProps) {
  return (
    <div
      className={`flex items-center gap-2 px-4 pt-3 ${readOnly ? '' : 'cursor-grab'}`}
      draggable={!readOnly}
      onDragStart={
        readOnly
          ? undefined
          : (e) => {
              e.dataTransfer.effectAllowed = 'move'
              onDragStart()
            }
      }
      onDragEnd={readOnly ? undefined : onDragEnd}
      title={readOnly ? undefined : 'Ziehen zum Umsortieren'}
    >
      {onCollapse && (
        <button
          className="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          title="Einklappen"
          aria-label="Kachel einklappen"
          onClick={(e) => {
            e.stopPropagation()
            onCollapse()
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      )}
      {!readOnly && <span className="text-gray-300">⠿</span>}
      <span className="flex-1" />
      {readOnly ? (
        card.taken_at && <span className="text-xs text-gray-400">{card.taken_at.slice(0, 10)}</span>
      ) : (
        <input
          type="date"
          className="bg-transparent text-xs text-gray-400 outline-none"
          defaultValue={card.taken_at ? card.taken_at.slice(0, 10) : ''}
          onChange={(e) => {
            const v = e.target.value
            mutations.updateCard.mutate({
              id: card.id,
              data: { taken_at: v ? `${v}T12:00:00+00:00` : null },
            })
          }}
        />
      )}
      {!readOnly && (
        <button
          className="hidden rounded px-1 text-gray-400 hover:bg-red-100 hover:text-red-600 group-hover:block"
          title="Kachel löschen"
          onClick={onDelete}
        >
          🗑
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Text-Kachel: grosse Überschrift + Markdown (Fliesstext, Bulletpoints)
// ---------------------------------------------------------------------------

interface TextCardProps {
  card: Card
  mutations: ReturnType<typeof useCardMutations>
  readOnly: boolean
  onDelete: () => void
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDropOn: () => void
  onCollapse?: () => void
}

function TextCard({
  card,
  mutations,
  readOnly,
  onDelete,
  dragging,
  onDragStart,
  onDragEnd,
  onDropOn,
  onCollapse,
}: TextCardProps) {
  const [editingBody, setEditingBody] = useState(false)
  const [bodyDraft, setBodyDraft] = useState(card.body_md ?? '')

  const saveBody = () => {
    setEditingBody(false)
    if (bodyDraft !== (card.body_md ?? '')) {
      mutations.updateCard.mutate({ id: card.id, data: { body_md: bodyDraft || null } })
    }
  }

  return (
    <div
      id={`card-${card.id}`}
      className={`group flex flex-col rounded-xl bg-white shadow-sm transition ${
        dragging ? 'opacity-40' : ''
      }`}
      onDragOver={readOnly ? undefined : (e) => e.preventDefault()}
      onDrop={
        readOnly
          ? undefined
          : (e) => {
              e.preventDefault()
              onDropOn()
            }
      }
    >
      <CardHeader
        card={card}
        readOnly={readOnly}
        mutations={mutations}
        onDelete={onDelete}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onCollapse={onCollapse}
      />

      <div className="flex-1 px-6 pb-6 pt-2 md:px-8">
        {readOnly ? (
          <h3 className="mb-4 break-words text-2xl font-semibold leading-tight text-gray-900 md:text-3xl">
            {card.title || 'Ohne Titel'}
          </h3>
        ) : (
          <textarea
            className="mb-4 block w-full resize-none overflow-hidden bg-transparent text-2xl font-semibold leading-tight text-gray-900 outline-none placeholder:text-gray-300 md:text-3xl"
            placeholder="Überschrift …"
            rows={1}
            defaultValue={card.title ?? ''}
            ref={autoGrow}
            onInput={(e) => autoGrow(e.currentTarget)}
            onKeyDown={(e) => {
              // Enter = fertig (kein Zeilenumbruch im Titel)
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
            onBlur={(e) => {
              const v = e.target.value.replace(/\s+/g, ' ').trim()
              if (v !== (card.title ?? '')) {
                mutations.updateCard.mutate({ id: card.id, data: { title: v || null } })
              }
            }}
          />
        )}

        {editingBody && !readOnly ? (
          <textarea
            autoFocus
            className="h-48 w-full resize-y rounded border border-blue-300 p-3 font-mono text-sm outline-none"
            value={bodyDraft}
            onChange={(e) => setBodyDraft(e.target.value)}
            onBlur={saveBody}
            placeholder={'Fliesstext …\n\n- Bulletpoints\n- gehen auch'}
          />
        ) : (
          <div
            className={`max-w-none whitespace-normal break-words text-gray-800 [overflow-wrap:anywhere] [&_a]:text-blue-600 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-gray-200 [&_blockquote]:pl-4 [&_blockquote]:text-gray-500 [&_code]:rounded [&_code]:bg-gray-100 [&_code]:px-1 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-gray-100 [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 ${
              readOnly ? '' : 'cursor-text'
            }`}
            title={readOnly ? undefined : 'Klicken zum Bearbeiten'}
            onClick={
              readOnly
                ? undefined
                : () => {
                    setBodyDraft(card.body_md ?? '')
                    setEditingBody(true)
                  }
            }
            dangerouslySetInnerHTML={{
              __html: card.body_md
                ? renderMarkdown(card.body_md)
                : readOnly
                  ? ''
                  : '<span class="text-gray-400">Text hinzufügen …</span>',
            }}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bilder-Kachel: ein Bild gross, Thumbnails darunter, Untertitel pro Bild
// ---------------------------------------------------------------------------

interface ImagesCardProps {
  card: Card
  images: Image[]
  mutations: ReturnType<typeof useCardMutations>
  readOnly: boolean
  onDelete: () => void
  onDeleteImage: (img: Image) => void
  onOpenViewbox: (index: number) => void
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDropOn: () => void
  onCollapse?: () => void
}

function ImagesCard({
  card,
  images,
  mutations,
  readOnly,
  onDelete,
  onDeleteImage,
  onOpenViewbox,
  dragging,
  onDragStart,
  onDragEnd,
  onDropOn,
  onCollapse,
}: ImagesCardProps) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const urls = useImageUrls(images)
  const uploading =
    mutations.addImages.isPending && mutations.addImages.variables?.cardId === card.id

  const active = images[Math.min(activeIdx, Math.max(images.length - 1, 0))]
  const activeUrls = active ? urls[active.id] : null

  const uploadFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return
    mutations.addImages.mutate({ cardId: card.id, files: [...files] })
  }

  return (
    <div
      id={`card-${card.id}`}
      className={`group flex flex-col rounded-xl bg-white shadow-sm transition ${
        dragging ? 'opacity-40' : ''
      } ${dragOver ? 'ring-2 ring-blue-400' : ''}`}
      onDragOver={
        readOnly
          ? undefined
          : (e) => {
              e.preventDefault()
              setDragOver(true)
            }
      }
      onDragLeave={readOnly ? undefined : () => setDragOver(false)}
      onDrop={
        readOnly
          ? undefined
          : (e) => {
              e.preventDefault()
              setDragOver(false)
              if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files)
              else onDropOn()
            }
      }
    >
      <CardHeader
        card={card}
        readOnly={readOnly}
        mutations={mutations}
        onDelete={onDelete}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onCollapse={onCollapse}
      />

      <div className="flex-1 px-4 pb-4 pt-2">
        {images.length === 0 ? (
          readOnly ? (
            <p className="py-10 text-center text-sm text-gray-400">Noch keine Bilder.</p>
          ) : (
            <button
              className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-600"
              onClick={() => fileRef.current?.click()}
            >
              <span className="text-3xl">📷</span>
              {uploading ? 'Importiere Bilder …' : 'Bilder hierher ziehen oder klicken'}
            </button>
          )
        ) : (
          <>
            {/* Hauptbild */}
            <div className="relative">
              {activeUrls ? (
                <img
                  src={activeUrls.display}
                  className="aspect-[4/3] w-full cursor-zoom-in rounded-lg object-cover"
                  onClick={() => onOpenViewbox(activeIdx)}
                />
              ) : (
                <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-400">
                  {activeUrls === null ? 'noch nicht synchronisiert' : 'lädt …'}
                </div>
              )}
            </div>

            {/* Untertitel des grossen Bildes */}
            {active &&
              (readOnly ? (
                active.caption && (
                  <p className="mt-2 text-sm italic text-gray-500">{active.caption}</p>
                )
              ) : (
                <input
                  key={active.id}
                  className="mt-2 w-full bg-transparent text-sm italic text-gray-500 outline-none placeholder:text-gray-300"
                  placeholder="Untertitel …"
                  defaultValue={active.caption ?? ''}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    if (v !== (active.caption ?? '')) {
                      mutations.updateImage.mutate({
                        id: active.id,
                        data: { caption: v || null },
                      })
                    }
                  }}
                />
              ))}

            {/* Thumbnail-Reihe */}
            <div className="mt-3 flex flex-wrap gap-2">
              {images.map((img, i) => {
                const u = urls[img.id]
                return (
                  <div key={img.id} className="group/thumb relative">
                    {u ? (
                      <img
                        src={u.thumb}
                        className={`h-20 w-20 cursor-pointer rounded-md object-cover ${
                          i === activeIdx ? 'ring-2 ring-blue-500' : 'opacity-80 hover:opacity-100'
                        }`}
                        onClick={() => setActiveIdx(i)}
                      />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-md bg-gray-100 text-center text-[10px] leading-tight text-gray-400">
                        {u === null ? 'nicht synchron' : '…'}
                      </div>
                    )}
                    {!readOnly && (
                      <button
                        className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-gray-900/80 text-[10px] text-white group-hover/thumb:flex"
                        title="Bild entfernen"
                        onClick={() => onDeleteImage(img)}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )
              })}
              {!readOnly && (
                <button
                  className="flex h-20 w-20 items-center justify-center rounded-md border-2 border-dashed border-gray-300 text-xl text-gray-400 hover:border-blue-400 hover:text-blue-600"
                  title="Bilder hinzufügen"
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? '…' : '+'}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {!readOnly && (
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          className="hidden"
          onChange={(e) => {
            uploadFiles(e.target.files)
            e.target.value = ''
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Viewbox: Vollbild-Bildbetrachter
//
// - Nutzt die Fullscreen-API (deckt auch die Browser-Chrome ab, bis an den
//   Bildschirmrand). Fallback ohne Fullscreen-API (z. B. iPhone-Safari):
//   fixed-Overlay über den ganzen Viewport, Safe-Area-Insets berücksichtigt.
// - Esc/Browser-«Vollbild verlassen» schliesst den Viewer (Esc wird im
//   Fullscreen vom Browser konsumiert → wir reagieren auf fullscreenchange).
// - Pfeiltasten/Swipe blättern, Swipe nach unten schliesst, Klick aufs Bild
//   blendet die Bedienelemente ein/aus, Klick auf den schwarzen Rand schliesst.
// - Nachbarbilder werden vorgeladen, Bildwechsel blendet weich über,
//   Bedienelemente und Cursor verschwinden bei Inaktivität.
// ---------------------------------------------------------------------------

type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

function fullscreenElement(): Element | null {
  const d = document as FsDocument
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null
}

function fullscreenSupported(): boolean {
  const el = document.documentElement as FsElement
  return Boolean(el.requestFullscreen || el.webkitRequestFullscreen)
}

/** Vollbild fürs ganze Dokument anfordern (der Viewer liegt als Overlay darüber). */
async function enterFullscreen(): Promise<void> {
  if (fullscreenElement()) return
  const e = document.documentElement as FsElement
  try {
    if (e.requestFullscreen) await e.requestFullscreen({ navigationUI: 'hide' })
    else if (e.webkitRequestFullscreen) await e.webkitRequestFullscreen()
  } catch {
    // z. B. ohne User-Gesture oder in eingebetteten Kontexten – Fallback-Overlay reicht.
  }
}

async function exitFullscreen(): Promise<void> {
  const d = document as FsDocument
  try {
    if (d.fullscreenElement && d.exitFullscreen) await d.exitFullscreen()
    else if (d.webkitFullscreenElement && d.webkitExitFullscreen) await d.webkitExitFullscreen()
  } catch {
    // ignorieren
  }
}

const CONTROLS_IDLE_MS = 2500
const SWIPE_MIN_PX = 48

function Viewbox({
  images,
  index,
  onNavigate,
  onClose,
}: {
  images: Image[]
  index: number
  onNavigate: (index: number) => void
  onClose: () => void
}) {
  const urls = useImageUrls(images)
  const img = images[index]
  const u = img ? urls[img.id] : null

  const [isFullscreen, setIsFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const idleTimer = useRef<number | null>(null)
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null)
  const canFullscreen = fullscreenSupported()

  const prev = useCallback(
    () => onNavigate((index - 1 + images.length) % images.length),
    [index, images.length, onNavigate]
  )
  const next = useCallback(
    () => onNavigate((index + 1) % images.length),
    [index, images.length, onNavigate]
  )

  // Bedienelemente einblenden und Idle-Timer neu starten.
  const wake = useCallback(() => {
    setControlsVisible(true)
    if (idleTimer.current) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_MS)
  }, [])

  // Öffnen/Schliessen: Idle-Timer starten; beim Schliessen Vollbild verlassen.
  useEffect(() => {
    wake()
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current)
      if (fullscreenElement()) void exitFullscreen()
    }
    // nur beim Mount/Unmount
  }, [])

  // Fullscreen-Status verfolgen; verlässt der Browser das Vollbild (Esc,
  // System-UI), schliesst der Viewer.
  useEffect(() => {
    let wasFullscreen = fullscreenElement() !== null
    const onChange = () => {
      const active = fullscreenElement() !== null
      setIsFullscreen(active)
      if (wasFullscreen && !active) onClose()
      wasFullscreen = active
    }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
    }
  }, [onClose])

  // Tastatur
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose()
          break
        case 'ArrowLeft':
          prev()
          wake()
          break
        case 'ArrowRight':
        case ' ':
          e.preventDefault()
          next()
          wake()
          break
        case 'Home':
          onNavigate(0)
          wake()
          break
        case 'End':
          onNavigate(images.length - 1)
          wake()
          break
        case 'f':
        case 'F':
          if (!canFullscreen) break
          if (fullscreenElement()) void exitFullscreen()
          else void enterFullscreen()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, prev, next, onNavigate, images.length, wake, canFullscreen])

  // Bildwechsel: Ladezustand zurücksetzen (für die Überblendung).
  useEffect(() => {
    setLoaded(false)
  }, [img?.id])

  // Nachbarbilder vorladen, damit das Blättern ohne Wartezeit läuft.
  useEffect(() => {
    if (images.length < 2) return
    const neighbours = [
      images[(index + 1) % images.length],
      images[(index - 1 + images.length) % images.length],
    ]
    for (const n of neighbours) {
      const nu = n ? urls[n.id] : null
      if (nu) {
        const pre = new window.Image()
        pre.src = nu.display
      }
    }
  }, [index, images, urls])

  // Touch: horizontal blättern, vertikal nach unten schliessen.
  const onTouchStart = (e: ReactTouchEvent) => {
    const t = e.touches[0]
    if (!t || e.touches.length !== 1) {
      touchStart.current = null
      return
    }
    touchStart.current = { x: t.clientX, y: t.clientY, t: Date.now() }
  }
  const onTouchEnd = (e: ReactTouchEvent) => {
    const start = touchStart.current
    touchStart.current = null
    const t = e.changedTouches[0]
    if (!start || !t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    const fast = Date.now() - start.t < 600
    if (Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) next()
      else prev()
      wake()
    } else if (dy > SWIPE_MIN_PX * 1.5 && Math.abs(dy) > Math.abs(dx) * 1.5 && fast) {
      onClose()
    }
  }

  const controlCls = `transition-opacity duration-300 ${
    controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
  }`
  const btnCls =
    'flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-95'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={img?.caption || 'Bildbetrachter'}
      className={`fixed inset-0 z-50 flex h-dvh w-screen touch-none select-none items-center justify-center overscroll-none bg-black ${
        controlsVisible ? '' : 'cursor-none'
      }`}
      onMouseMove={wake}
      onTouchStart={(e) => {
        onTouchStart(e)
        wake()
      }}
      onTouchEnd={onTouchEnd}
      onClick={onClose}
    >
      {u ? (
        <img
          key={img?.id}
          src={u.display}
          draggable={false}
          onLoad={() => setLoaded(true)}
          onClick={(e) => {
            e.stopPropagation()
            setControlsVisible((v) => {
              if (v) {
                if (idleTimer.current) window.clearTimeout(idleTimer.current)
                return false
              }
              wake()
              return true
            })
          }}
          className={`max-h-full max-w-full object-contain transition-opacity duration-300 ease-out ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
          alt={img?.caption ?? ''}
        />
      ) : (
        <div className="text-sm text-gray-400">
          {u === null ? 'Bild nicht verfügbar' : 'lädt …'}
        </div>
      )}

      {u && !loaded && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
        </div>
      )}

      {/* Kopfzeile: Zähler links, Vollbild + Schliessen rechts (Safe-Area-bewusst) */}
      <div
        className={`absolute inset-x-0 top-0 z-10 flex items-start justify-between bg-gradient-to-b from-black/60 to-transparent px-3 pb-8 pt-[max(0.75rem,env(safe-area-inset-top))] ${controlCls}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pl-[env(safe-area-inset-left)] pt-2.5 text-sm tabular-nums text-white/70">
          {images.length > 1 && (
            <span>
              {index + 1} / {images.length}
            </span>
          )}
        </div>
        <div className="flex gap-2 pr-[env(safe-area-inset-right)]">
          {canFullscreen && (
            <button
              className={btnCls}
              title={isFullscreen ? 'Vollbild verlassen (F)' : 'Vollbild (F)'}
              aria-label={isFullscreen ? 'Vollbild verlassen' : 'Vollbild'}
              onClick={() => {
                if (isFullscreen) void exitFullscreen()
                else void enterFullscreen()
              }}
            >
              {isFullscreen ? (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
                </svg>
              ) : (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
                </svg>
              )}
            </button>
          )}
          <button
            className={btnCls}
            title="Schliessen (Esc)"
            aria-label="Schliessen"
            onClick={onClose}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {images.length > 1 && (
        <>
          <button
            className={`${btnCls} absolute top-1/2 z-10 -translate-y-1/2 left-[max(0.5rem,env(safe-area-inset-left))] md:left-4 md:h-12 md:w-12 ${controlCls}`}
            title="Vorheriges Bild (←)"
            aria-label="Vorheriges Bild"
            onClick={(e) => {
              e.stopPropagation()
              prev()
              wake()
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            className={`${btnCls} absolute top-1/2 z-10 -translate-y-1/2 right-[max(0.5rem,env(safe-area-inset-right))] md:right-4 md:h-12 md:w-12 ${controlCls}`}
            title="Nächstes Bild (→)"
            aria-label="Nächstes Bild"
            onClick={(e) => {
              e.stopPropagation()
              next()
              wake()
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </>
      )}

      {img?.caption && (
        <div
          // Untertitel bleibt immer sichtbar (blendet nicht mit den Controls aus).
          className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-[max(1.5rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] pt-12 text-center"

          onClick={(e) => e.stopPropagation()}
        >
          <p className="mx-auto max-w-3xl text-base text-gray-100 [text-shadow:0_1px_2px_rgba(0,0,0,.6)] md:text-lg">
            {img.caption}
          </p>
        </div>
      )}
    </div>
  )
}
