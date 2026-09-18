import { describe, expect, it } from 'vitest'
import { haversineM, nearestPointOnLine } from '../src/geo'
import type { LineString } from '../src/types'

// Gerade Linie von West nach Ost auf 46.9° N (ca. 1.5 km).
const line: LineString = {
  type: 'LineString',
  coordinates: [
    [7.4, 46.9],
    [7.41, 46.9],
    [7.42, 46.9],
  ],
}

describe('nearestPointOnLine', () => {
  it('projiziert einen seitlich versetzten Punkt auf das Segment', () => {
    const { point, distM } = nearestPointOnLine(line, [7.405, 46.901])
    expect(point[0]).toBeCloseTo(7.405, 6)
    expect(point[1]).toBeCloseTo(46.9, 6)
    // 0.001° Breite ≈ 111 m
    expect(distM).toBeGreaterThan(100)
    expect(distM).toBeLessThan(120)
    expect(haversineM(point, [7.405, 46.901])).toBeCloseTo(distM, 6)
  })

  it('klemmt auf die Endpunkte, wenn der Punkt ausserhalb der Linie liegt', () => {
    const { point } = nearestPointOnLine(line, [7.5, 46.9])
    expect(point).toEqual([7.42, 46.9])
    const start = nearestPointOnLine(line, [7.3, 46.95])
    expect(start.point).toEqual([7.4, 46.9])
  })

  it('liefert Distanz 0 für einen Punkt auf der Linie', () => {
    const { distM } = nearestPointOnLine(line, [7.415, 46.9])
    expect(distM).toBeLessThan(0.01)
  })

  it('kommt mit leeren Linien zurecht', () => {
    const r = nearestPointOnLine({ type: 'LineString', coordinates: [] }, [7.4, 46.9])
    expect(r.point).toEqual([7.4, 46.9])
    expect(r.distM).toBe(Number.POSITIVE_INFINITY)
  })
})
