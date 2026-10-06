import { redirect } from 'next/navigation';

/** /settings is a container; its first section is the landing page. */
export default function SettingsIndexPage() {
  redirect('/settings/social-auth');
}
