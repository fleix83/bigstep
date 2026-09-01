import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { Card, Image } from '@tourenbuch/shared'
import { useCards, useCardMutations, useTourImages } from '../hooks/useCards'
import { findDerivatives, type DerivativeUrls } from '../lib/image-store'
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

export function BookView({ tourId, highlightCardId, onHighlightDone, readOnly = false }: Props) {
  const { data: cards, isLoading } = useCards(tourId)
  const { data: images } = useTourImages(tourId)
  const mutations = useCardMutations(tourId)
  const [deleteCandidate, setDeleteCandidate] = useState<Card | null>(null)
  const [imageDeleteCandidate, setImageDeleteCandidate] = useState<Image | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
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

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          Book
        </h2>
        {!readOnly && (
          <button
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={mutations.createCard.isPending}
            onClick={() => mutations.createCard.mutate()}
          >
            + Neue Card
          </button>
        )}
      </div>

      {isLoading && <p className="text-sm text-gray-500">Lade Cards …</p>}
      {cards && cards.length === 0 && (
        <p className="text-sm text-gray-500">
          {readOnly ? 'Noch keine Cards.' : 'Noch keine Cards – mit «+ Neue Card» beginnen.'}
        </p>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {cards?.map((card) => (
          <CardItem
            key={card.id}
            card={card}
            readOnly={readOnly}
            images={imagesByCard.get(card.id) ?? []}
            mutations={mutations}
            onDelete={() => setDeleteCandidate(card)}
            onDeleteImage={setImageDeleteCandidate}
            onOpenImage={setLightbox}
            dragging={dragId === card.id}
            onDragStart={() => setDragId(card.id)}
            onDragEnd={() => setDragId(null)}
            onDropOn={() => handleDrop(card.id)}
          />
        ))}
      </div>

      {deleteCandidate && (
        <ConfirmDialog
          title="Card löschen?"
          message={`«${deleteCandidate.title || 'Ohne Titel'}» wird samt Bildern gelöscht.`}
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
          message="Das Bild wird aus der Card entfernt und die lokale Ableitung gelöscht."
          onConfirm={() => {
            mutations.deleteImage.mutate(imageDeleteCandidate)
            setImageDeleteCandidate(null)
          }}
          onCancel={() => setImageDeleteCandidate(null)}
        />
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-8"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} className="max-h-full max-w-full rounded shadow-2xl" />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

interface CardItemProps {
  card: Card
  readOnly: boolean
  images: Image[]
  mutations: ReturnType<typeof useCardMutations>
  onDelete: () => void
  onDeleteImage: (img: Image) => void
  onOpenImage: (url: string) => void
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDropOn: () => void
}

function CardItem({
  card,
  readOnly,
  images,
  mutations,
  onDelete,
  onDeleteImage,
  onOpenImage,
  dragging,
  onDragStart,
  onDragEnd,
  onDropOn,
}: CardItemProps) {
  const [editingBody, setEditingBody] = useState(false)
  const [bodyDraft, setBodyDraft] = useState(card.body_md ?? '')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const uploading = mutations.addImages.isPending && mutations.addImages.variables?.cardId === card.id

  const saveBody = () => {
    setEditingBody(false)
    if (bodyDraft !== (card.body_md ?? '')) {
      mutations.updateCard.mutate({ id: card.id, data: { body_md: bodyDraft || null } })
    }
  }

  const uploadFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return
    mutations.addImages.mutate({ cardId: card.id, files: [...files] })
  }

  return (
    <div
      id={`card-${card.id}`}
      className={`group flex flex-col rounded-lg border bg-white shadow-sm transition ${
        dragging ? 'opacity-40' : ''
      } ${dragOver ? 'border-blue-400 bg-blue-50/50' : 'border-gray-200'}`}
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
      <div
        className={`flex items-center gap-2 border-b border-gray-100 px-3 py-2 ${readOnly ? '' : 'cursor-grab'}`}
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
        <input
          className="w-full bg-transparent text-sm font-medium text-gray-900 outline-none placeholder:text-gray-400"
          readOnly={readOnly}
          placeholder={readOnly ? 'Ohne Titel' : 'Titel …'}
          defaultValue={card.title ?? ''}
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v !== (card.title ?? '')) {
              mutations.updateCard.mutate({ id: card.id, data: { title: v || null } })
            }
          }}
        />
        {readOnly ? (
          card.taken_at && (
            <span className="shrink-0 text-xs text-gray-500">{card.taken_at.slice(0, 10)}</span>
          )
        ) : (
          <input
            type="date"
            className="shrink-0 bg-transparent text-xs text-gray-500 outline-none"
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
            className="hidden shrink-0 rounded px-1 text-gray-400 hover:bg-red-100 hover:text-red-600 group-hover:block"
            title="Card löschen"
            onClick={onDelete}
          >
            🗑
          </button>
        )}
      </div>

      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2">
          {images.map((img) => (
            <ImageThumb
              key={img.id}
              image={img}
              readOnly={readOnly}
              onOpen={onOpenImage}
              onDelete={() => onDeleteImage(img)}
            />
          ))}
        </div>
      )}

      <div className="flex-1 px-3 py-2">
        {editingBody ? (
          <textarea
            autoFocus
            className="h-32 w-full resize-y rounded border border-blue-300 p-2 font-mono text-xs outline-none"
            value={bodyDraft}
            onChange={(e) => setBodyDraft(e.target.value)}
            onBlur={saveBody}
            placeholder="Markdown-Notizen …"
          />
        ) : (
          <div
            className={`prose prose-sm max-w-none text-sm text-gray-800 [&_a]:text-blue-600 [&_h1]:text-base [&_h2]:text-sm ${readOnly ? '' : 'cursor-text'}`}
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
                  : '<span class="text-gray-400">Notizen hinzufügen …</span>',
            }}
          />
        )}
      </div>

      {!readOnly && (
      <div className="flex items-center justify-between border-t border-gray-100 px-3 py-1.5">
        <button
          className="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Importiere Bilder …' : '📷 Bilder hinzufügen'}
        </button>
        {editingBody && (
          <span className="text-xs text-gray-400">Klick ausserhalb speichert</span>
        )}
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
      </div>
      )}
    </div>
  )
}

function ImageThumb({
  image,
  readOnly,
  onOpen,
  onDelete,
}: {
  image: Image
  readOnly: boolean
  onOpen: (displayUrl: string) => void
  onDelete: () => void
}) {
  const [urls, setUrls] = useState<DerivativeUrls | null | 'loading'>('loading')
  useEffect(() => {
    let alive = true
    void findDerivatives(image.sha256).then((u) => {
      if (alive) setUrls(u)
    })
    return () => {
      alive = false
    }
  }, [image.sha256])

  if (urls === 'loading') {
    return <div className="h-16 w-16 animate-pulse rounded bg-gray-100" />
  }
  if (urls === null) {
    return (
      <div
        className="flex h-16 w-16 items-center justify-center rounded bg-gray-100 text-center text-[10px] leading-tight text-gray-400"
        title="Ableitung nicht lokal vorhanden (Sync folgt mit R2, Phase 8)"
      >
        nicht lokal
      </div>
    )
  }
  return (
    <div className="group/thumb relative">
      <img
        src={urls.thumb}
        className="h-16 w-16 cursor-zoom-in rounded object-cover"
        onClick={() => onOpen(urls.display)}
      />
      {!readOnly && (
        <button
          className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-gray-900/80 text-[10px] text-white group-hover/thumb:flex"
          title="Bild entfernen"
          onClick={onDelete}
        >
          ✕
        </button>
      )}
    </div>
  )
}
