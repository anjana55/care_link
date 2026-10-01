import { ImageIcon } from 'lucide-react';

/**
 * Placeholder for the marketing hero image/photography that a designer
 * will drop in later (a caregiver with a patient, a family at home, etc).
 * Deliberately built as a plain decorative block - not a broken <img> tag -
 * so the page renders correctly with no real asset wired up yet. Swap the
 * inner content for a real `<Image src="..." fill alt={alt} />` once art is
 * available; the surrounding aspect-ratio/rounded/border wrapper can stay.
 */
export function HeroBanner({ alt, className = '' }: { alt: string; className?: string }) {
  return (
    <div
      role="img"
      aria-label={alt}
      className={`flex aspect-[4/3] w-full items-center justify-center rounded-lg border border-dashed border-brand/40 bg-gradient-to-br from-brand-light via-white to-accent-light sm:aspect-square ${className}`}
    >
      <div className="flex flex-col items-center gap-2 px-6 text-center">
        <ImageIcon className="h-10 w-10 text-brand/50" aria-hidden />
        <p className="text-xs font-medium uppercase tracking-wide text-brand/60">Hero banner placeholder</p>
        <p className="max-w-[220px] text-xs text-ink/40">{alt}</p>
      </div>
    </div>
  );
}
