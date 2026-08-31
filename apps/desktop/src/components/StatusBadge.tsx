import type { TourStatus } from '@tourenbuch/shared'

export function StatusBadge({ status }: { status: TourStatus }) {
  const styles =
    status === 'gemacht'
      ? 'bg-green-100 text-green-800'
      : 'bg-amber-100 text-amber-800'
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>
      {status}
    </span>
  )
}
