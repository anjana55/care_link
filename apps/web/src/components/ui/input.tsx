import { InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'h-10 w-full rounded border border-border bg-white px-3 text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-brand',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded border border-border bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-brand',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'h-10 w-full rounded border border-border bg-white px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand',
      className,
    )}
    {...props}
  />
));
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
    <label className={cn('mb-1.5 block text-sm font-medium text-ink', className)} {...props}>
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
