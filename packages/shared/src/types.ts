/** Position [Längengrad, Breitengrad] in WGS84. */
export type LonLat = [lon: number, lat: number]

/** GeoJSON LineString; Positionen [lon, lat] oder [lon, lat, ele]. */
export interface LineString {
  type: 'LineString'
  coordinates: number[][]
}

/** [minLon, minLat, maxLon, maxLat] */
export type BBox = [number, number, number, number]

export type TourStatus = 'geplant' | 'gemacht'

export type UploadState = 'pending' | 'uploaded' | 'failed'
