import { redirect } from 'next/navigation';

/**
 * Kept only so old links and bookmarks still land somewhere useful.
 *
 * This used to be a chooser between email and WhatsApp sign-up. Caregiver
 * registration is now one form at /caregiver/signup, so there is nothing left
 * to choose; the sign-in pages and the dashboard still link here, and they
 * all end up on the form.
 */
export default function CaregiverJoinPage() {
  redirect('/caregiver/signup');
}
