/**
 * Masks an identifier such as an NIC or passport number, keeping only the
 * last 4 characters visible. Used on list/search endpoints so full numbers
 * are never exposed outside a caregiver's own detail view.
 */
export function maskIdentifier(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 4) return '*'.repeat(value.length);
  return '*'.repeat(value.length - 4) + value.slice(-4);
}

export function maskPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 4) return '*'.repeat(value.length);
  return value.slice(0, 3) + '*'.repeat(value.length - 6) + value.slice(-3);
}
