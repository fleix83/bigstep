import { describe, expect, it } from 'vitest'
import {
  bboxSchema,
  cardsReorderSchema,
  lineStringSchema,
  tourCreateSchema,
  tourSchema,
  tourUpdateSchema,
} from '../src/schemas'

const validTour = {
  id: '7f9c24e5-2f60-4b8e-9c8d-1a2b3c4d5e6f',
  user_id: 'user-a-1111',
  name: 'Basel – Chrischona',
  status: 'geplant',
  visibility: 'private',
  geometry: {
    type: 'LineString',
    coordinates: [
      [7.59, 47.56],
      [7.68, 47.57],
    ],
  },
  waypoints: [
    [7.59, 47.56],
    [7.68, 47.57],
  ],
  distance_m: 8200,
  ascent_m: 320,
  descent_m: 120,
  duration_min: 140,
  bbox: [7.59, 47.56, 7.68, 47.57],
  notes_md: null,
  created_at: '2026-08-31T12:00:00.000Z',
  updated_at: '2026-08-31T12:00:00.000Z',
}

describe('tourSchema', () => {
  it('akzeptiert eine vollständige Tour', () => {
    expect(tourSchema.parse(validTour)).toEqual(validTour)
  })

  it('akzeptiert null-Geometrie (Tour ohne Route)', () => {
    const t = { ...validTour, geometry: null, waypoints: null, bbox: null }
    expect(tourSchema.parse(t).geometry).toBeNull()
  })

  it('weist unbekannten Status zurück', () => {
    expect(() => tourSchema.parse({ ...validTour, status: 'offen' })).toThrow()
  })
})

describe('tourCreateSchema', () => {
  it('braucht nur einen Namen', () => {
    expect(tourCreateSchema.parse({ name: 'Neue Tour' })).toEqual({ name: 'Neue Tour' })
  })

  it('weist leeren Namen zurück', () => {
    expect(() => tourCreateSchema.parse({ name: '' })).toThrow()
  })
})

describe('tourUpdateSchema', () => {
  it('weist leeres Update zurück', () => {
    expect(() => tourUpdateSchema.parse({})).toThrow()
  })

  it('akzeptiert Teil-Updates', () => {
    expect(tourUpdateSchema.parse({ status: 'gemacht' })).toEqual({ status: 'gemacht' })
  })
})

describe('Geometrie-Schemas', () => {
  it('LineString braucht mindestens 2 Positionen', () => {
    expect(() =>
      lineStringSchema.parse({ type: 'LineString', coordinates: [[7.5, 47.5]] })
    ).toThrow()
  })

  it('LineString erlaubt Höhen als dritte Komponente', () => {
    const ls = {
      type: 'LineString',
      coordinates: [
        [7.5, 47.5, 300],
        [7.6, 47.6, 350],
      ],
    }
    expect(lineStringSchema.parse(ls)).toEqual(ls)
  })

  it('bbox ist ein 4er-Tupel', () => {
    expect(() => bboxSchema.parse([7.5, 47.5, 7.6])).toThrow()
  })
})

describe('cardsReorderSchema', () => {
  it('verlangt mindestens eine id', () => {
    expect(() => cardsReorderSchema.parse({ tour_id: validTour.id, ids: [] })).toThrow()
  })
})
