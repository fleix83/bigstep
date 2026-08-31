export function formatDistance(m: number | null): string {
  if (m === null) return '–'
  return `${(m / 1000).toLocaleString('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`
}

export function formatMeters(m: number | null): string {
  if (m === null) return '–'
  return `${Math.round(m).toLocaleString('de-CH')} m`
}

export function formatDuration(min: number | null): string {
  if (min === null) return '–'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h === 0) return `${m} min`
  return `${h} h ${m.toString().padStart(2, '0')} min`
}
