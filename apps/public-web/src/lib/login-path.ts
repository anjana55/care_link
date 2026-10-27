/** The sign-in page for a kind of account: 'caregiver'/'CAREGIVER', 'employer'/'EMPLOYER', otherwise clients. */
export function loginPathFor(who: string | null | undefined): string {
  if (who === 'caregiver' || who === 'CAREGIVER') return '/caregiver/login';
  if (who === 'employer' || who === 'EMPLOYER') return '/employer/login';
  return '/login';
}
