'use client';

import { X } from 'lucide-react';

/** A removable active-filter chip, shown above the Caregivers and Clients tables. */
export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-brand-light px-2.5 py-1 text-xs font-medium text-brand-dark">
      {label}
      <button type="button" onClick={onRemove} aria-label={label} className="text-brand-dark/60 hover:text-brand-dark">
        <X size={12} />
      </button>
    </span>
  );
}
