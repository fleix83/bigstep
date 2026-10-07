import type { TourStatus } from '@tourenbuch/shared'

export function StatusBadge({ status }: { status: TourStatus }) {
  // Farben nach Vorgabe (Screenshot): Gelb für geplant, Periwinkle für gemacht, Text schwarz.
  const styles = status === 'gemacht' ? 'bg-[#98a5ff] text-black' : 'bg-[#fff0aa] text-black'
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>
      {status}
    </span>
  )
}
