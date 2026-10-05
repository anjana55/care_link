import { MessageCircle } from 'lucide-react';

/**
 * A number staff can act on: tap to call, plus a WhatsApp shortcut.
 *
 * Phone numbers are stored as the client typed them ("0771234567",
 * "+94 77 123 4567"), so wa.me needs them turned into country-code digits.
 * A leading 0 is read as a Sri Lankan national number - this platform serves
 * Sri Lanka only; an international number is expected to carry its "+".
 */
export function toWhatsappDigits(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return `94${digits.slice(1)}`;
  return digits;
}

export function PhoneLink({ phone, whatsapp = false }: { phone: string; whatsapp?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="tabular-nums text-brand-dark hover:underline">
        {phone}
      </a>
      {whatsapp && (
        <a
          href={`https://wa.me/${toWhatsappDigits(phone)}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="WhatsApp"
          className="text-brand hover:text-brand-dark"
        >
          <MessageCircle size={14} />
        </a>
      )}
    </span>
  );
}
