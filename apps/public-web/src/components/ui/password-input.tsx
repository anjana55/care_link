'use client';

import { InputHTMLAttributes, forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Input } from './input';

/**
 * A password field with a show/hide toggle. Use it wherever a user types a
 * password, and always for one they are choosing (paired with a confirmation
 * field) so they can check what they typed before submitting.
 *
 * forwardRef so react-hook-form's `register()` works exactly as it does on Input.
 * The toggle is type="button" so it never submits the surrounding form, and each
 * field toggles on its own: revealing the new password does not reveal the
 * confirmation, which keeps the confirmation a genuine re-typing check.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  ({ className, ...props }, ref) => {
    const { t } = useTranslation();
    const [visible, setVisible] = useState(false);
    const label = visible ? t('common.hidePassword') : t('common.showPassword');
    return (
      <div className="relative">
        <Input ref={ref} type={visible ? 'text' : 'password'} className={cn('pr-10', className)} {...props} />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={label}
          aria-pressed={visible}
          title={label}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-DEFAULT text-ink/50 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
