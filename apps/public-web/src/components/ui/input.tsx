import { InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * The control language for the public site, mirroring apps/web's ui/input.tsx.
 *
 * These existed as three hand-written class strings that had drifted apart: a
 * plain form input (`rounded-DEFAULT border border-border px-3 py-2`), the AI
 * search textarea (`rounded-lg px-4 py-3`) and the AI chip input (`px-2 py-1`),
 * plus two different label styles - so the same product showed visibly different
 * fields depending on which page you landed on.
 *
 * The base class keeps public-web's proportions (px-3 py-2, no fixed height) and
 * adds the focus ring the public site was missing entirely: a keyboard user had
 * no visible indication of which field they were on.
 */
const CONTROL_CLASS =
  'w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand';

/** Exported for the few places that still need a raw <input>/<textarea>. */
export const INPUT_CLASS = `${CONTROL_CLASS} placeholder:text-ink/40`;
export const LABEL_CLASS = 'mb-1 block text-xs font-medium text-ink/60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(INPUT_CLASS, className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(INPUT_CLASS, className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(CONTROL_CLASS, className)} {...props} />
  ),
);
Select.displayName = 'Select';

/**
 * `required` is a hand-rolled prop, not a passthrough: `required` is not a
 * valid attribute on <label>, so spreading it would put an unknown attribute in
 * the DOM. It renders the marker only - the input itself still gets the native
 * `required` attribute where that is wanted.
 */
export function Label({
  className,
  required,
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn(LABEL_CLASS, className)} {...props}>
      {children}
      {required && (
        <span aria-hidden="true" className="ml-0.5 text-danger">
          *
        </span>
      )}
    </label>
  );
}

/** Explains the `*` marker once per form. Pair with Label's `required`. */
export function RequiredLegend({ label }: { label: string }) {
  return (
    <p className="mb-3 text-xs text-ink/50">
      <span aria-hidden="true" className="text-danger">
        *
      </span>{' '}
      {label}
    </p>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-danger">{message}</p>;
}