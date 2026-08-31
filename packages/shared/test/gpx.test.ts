import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GpxParseError, parseGpx, serializeGpx } from '../src/gpx'
import { elevationGainLoss, haversineM, lineBbox, lineDistanceM } from '../src/geo'

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8')

describe('parseGpx', () => {
  it('liest Track mit Höhen, Name aus <trk><name>', () => {
    const { name, line } = parseGpx(fixture('track-with-ele.gpx'))
    expect(name).toBe('Basel – Chrischona')
    expect(line.coordinates).toHaveLength(6)
    expect(line.coordinates[0]).toEqual([7.5906, 47.5566, 260.5])
    expect(line.coordinates[5]).toEqual([7.687, 47.5721, 493])
  })

  it('liest Track ohne Höhen und hängt Segmente aneinander', () => {
    const { name, line } = parseGpx(fixture('track-no-ele.gpx'))
    expect(name).toBeNull()
    expect(line.coordinates).toHaveLength(4)
    expect(line.coordinates[0]).toEqual([6.6323, 46.5197])
    expect(line.coordinates[3]).toEqual([6.64, 46.526])
  })

  it('fällt auf <rte> zurück, wenn kein Track vorhanden ist', () => {
    const { name, line } = parseGpx(fixture('route-only.gpx'))
    expect(name).toBe('Geplante Route')
    expect(line.coordinates).toHaveLength(3)
  })

  it('wirft bei Nicht-XML und bei GPX ohne Punkte', () => {
    expect(() => parseGpx('kein xml')).toThrow(GpxParseError)
    expect(() =>
      parseGpx('<?xml version="1.0"?><gpx version="1.1"><trk><trkseg/></trk></gpx>')
    ).toThrow(GpxParseError)
  })

  it('wirft bei Koordinaten ausserhalb des Wertebereichs', () => {
    expect(() =>
      parseGpx(
        '<gpx version="1.1"><trk><trkseg><trkpt lat="91" lon="0"/><trkpt lat="0" lon="0"/></trkseg></trk></gpx>'
      )
    ).toThrow(GpxParseError)
  })
})

describe('serializeGpx / Roundtrip', () => {
  it('Import→Export→Import ist verlustfrei bzgl. Geometrie und Name', () => {
    for (const file of ['track-with-ele.gpx', 'track-no-ele.gpx', 'route-only.gpx']) {
      const first = parseGpx(fixture(file))
      const xml = serializeGpx(first.name ?? 'Tour', first.line)
      const second = parseGpx(xml)
      expect(second.line.coordinates).toEqual(first.line.coordinates)
      expect(second.name).toBe(first.name ?? 'Tour')
    }
  })

  it('schreibt gültiges GPX 1.1 mit ele nur wo vorhanden', () => {
    const xml = serializeGpx('Mix', {
      type: 'LineString',
      coordinates: [
        [7.5, 47.5, 300],
        [7.6, 47.6],
      ],
    })
    expect(xml).toContain('http://www.topografix.com/GPX/1/1')
    expect(xml).toContain('<ele>300</ele>')
    expect(xml.match(/<ele>/g)).toHaveLength(1)
  })
})

describe('geo', () => {
  it('haversineM: Basel SBB → Bern HB ≈ 69.5 km', () => {
    const d = haversineM([7.5891, 47.5476], [7.4391, 46.949])
    expect(d).toBeGreaterThan(66_000)
    expect(d).toBeLessThan(68_500)
  })

  it('lineDistanceM summiert Segmentlängen', () => {
    const { line } = parseGpx(fixture('track-with-ele.gpx'))
    const d = lineDistanceM(line)
    // Luftlinie der Fixture-Punkte Basel–Chrischona: grob 7–8 km
    expect(d).toBeGreaterThan(6_500)
    expect(d).toBeLessThan(8_500)
  })

  it('lineBbox liefert [minLon, minLat, maxLon, maxLat]', () => {
    const { line } = parseGpx(fixture('track-with-ele.gpx'))
    expect(lineBbox(line)).toEqual([7.5906, 47.5566, 7.687, 47.5721])
  })

  it('elevationGainLoss zählt nur Differenzen über der Schwelle', () => {
    const { line } = parseGpx(fixture('track-with-ele.gpx'))
    const gl = elevationGainLoss(line)
    expect(gl).not.toBeNull()
    // monoton steigend 260.5 → 493 ⇒ Aufstieg ≈ 232, kein Abstieg
    expect(gl!.ascent_m).toBeGreaterThan(225)
    expect(gl!.ascent_m).toBeLessThan(240)
    expect(gl!.descent_m).toBe(0)
  })

  it('elevationGainLoss ist null ohne Höhen', () => {
    const { line } = parseGpx(fixture('track-no-ele.gpx'))
    expect(elevationGainLoss(line)).toBeNull()
  })
})
