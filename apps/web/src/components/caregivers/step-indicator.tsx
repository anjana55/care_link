'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function StepIndicator({ steps, currentIndex }: { steps: string[]; currentIndex: number }) {
  return (
    <ol className="space-y-1">
      {steps.map((label, i) => {
        const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming';
        return (
          <li key={label} className="flex items-center gap-3 py-1.5">
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                state === 'done' && 'bg-brand text-white',
                state === 'current' && 'border-2 border-brand text-brand-dark',
                state === 'upcoming' && 'border border-border text-ink/40',
              )}
            >
              {state === 'done' ? <Check size={13} /> : i + 1}
            </span>
            <span className={cn('text-sm', state === 'current' ? 'font-medium text-ink' : 'text-ink/60')}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
