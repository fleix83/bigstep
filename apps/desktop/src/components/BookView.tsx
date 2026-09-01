import { useCallback, useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { Card, Image } from '@tourenbuch/shared'
import { useCards, useCardMutations, useTourImages } from '../hooks/useCards'
import { useApi } from '../lib/api'
import { resolveImageUrls, type DerivativeUrls } from '../lib/image-store'
import { ConfirmDialog } from './ConfirmDialog'

interface Props {
  tourId: string
  /** Card, zu der gescrollt werden soll (Klick auf Foto-Pin). */
  highlightCardId: string | null
  onHighlightDone: () => void
  /** PWA/Mobile: Editier-Controls werden nicht gerendert (PRD F6). */
  readOnly?: boolean
}

function renderMarkdown(md: string): string {
  return DOMPurify.sanitize(marked.parse(md, { async: false, gfm: true }))
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

export function BookView({ tourId, highlightCardId, onHighlightDone, readOnly = false }: Props) {
  const { data: cards, isLoading } = useCards(tourId)
  const { data: images } = useTourImages(tourId)
  const mutations = useCardMutations(tourId)
  const [deleteCandidate, setDeleteCandidate] = useState<Card | null>(null)
  const [imageDeleteCandidate, setImageDeleteCandidate] = useState<Image | null>(null)
  const [viewbox, setViewbox] = useState<ViewboxState | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

  // Zu markierter Card scrollen (Foto-Pin-Klick).
  useEffect(() => {
    if (!highlightCardId) return
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
  }, [highlightCardId, onHighlightDone, cards])

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

  return (
    <div className="h-full overflow-y-auto bg-gray-100 p-4 md:p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Book</h2>
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
        {cards?.map((card) =>
          card.kind === 'images' ? (
            <ImagesCard
              key={card.id}
              card={card}
              images={imagesByCard.get(card.id) ?? []}
              mutations={mutations}
              readOnly={readOnly}
              onDelete={() => setDeleteCandidate(card)}
              onDeleteImage={setImageDeleteCandidate}
              onOpenViewbox={(index) => setViewbox({ cardId: card.id, index })}
              dragging={dragId === card.id}
              onDragStart={() => setDragId(card.id)}
              onDragEnd={() => setDragId(null)}
              onDropOn={() => handleDrop(card.id)}
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
            />
          )
        )}
      </div>

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
    </div>
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
}

function CardHeader({ card, readOnly, mutations, onDelete, onDragStart, onDragEnd }: HeaderProps) {
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
      {!readOnly && <span className="text-gray-300">⠿</span>}
      <span className="flex-1" />
      {readOnly ? (
        card.taken_at && (
          <span className="text-xs text-gray-400">{card.taken_at.slice(0, 10)}</span>
        )
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
      />

      <div className="flex-1 px-6 pb-6 pt-2 md:px-8">
        {readOnly ? (
          <h3 className="mb-4 text-2xl font-semibold text-gray-900 md:text-3xl">
            {card.title || 'Ohne Titel'}
          </h3>
        ) : (
          <input
            className="mb-4 w-full bg-transparent text-2xl font-semibold text-gray-900 outline-none placeholder:text-gray-300 md:text-3xl"
            placeholder="Überschrift …"
            defaultValue={card.title ?? ''}
            onBlur={(e) => {
              const v = e.target.value.trim()
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
            className={`prose max-w-none text-gray-800 [&_a]:text-blue-600 [&_li]:my-0.5 [&_ul]:list-disc [&_ul]:pl-5 ${
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
// Viewbox: grosses Bild mit Vor/Zurück, Untertitel und Zähler
// ---------------------------------------------------------------------------

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

  const prev = useCallback(
    () => onNavigate((index - 1 + images.length) % images.length),
    [index, images.length, onNavigate]
  )
  const next = useCallback(
    () => onNavigate((index + 1) % images.length),
    [index, images.length, onNavigate]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, prev, next])

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[85vh] max-w-5xl items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {u ? (
          <img src={u.display} className="max-h-[80vh] max-w-full rounded shadow-2xl" />
        ) : (
          <div className="flex h-64 w-96 items-center justify-center text-sm text-gray-400">
            {u === null ? 'Bild nicht verfügbar' : 'lädt …'}
          </div>
        )}

        {images.length > 1 && (
          <>
            <button
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-2xl text-white hover:bg-black/70"
              title="Vorheriges Bild"
              onClick={prev}
            >
              ‹
            </button>
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-2xl text-white hover:bg-black/70"
              title="Nächstes Bild"
              onClick={next}
            >
              ›
            </button>
          </>
        )}

        <button
          className="absolute -right-2 -top-2 rounded-full bg-black/60 px-2.5 py-1 text-sm text-white hover:bg-black/80"
          title="Schliessen"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="mt-3 text-center text-sm text-gray-200" onClick={(e) => e.stopPropagation()}>
        {img?.caption && <p className="italic">{img.caption}</p>}
        {images.length > 1 && (
          <p className="mt-1 text-xs text-gray-400">
            {index + 1} / {images.length}
          </p>
        )}
      </div>
    </div>
  )
}
