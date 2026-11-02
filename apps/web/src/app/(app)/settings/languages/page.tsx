import { redirect } from 'next/navigation';

/** Languages now share a page with skills (Settings > Skills & languages). */
export default function LanguagesRedirect() {
  redirect('/settings/skills#languages');
}
