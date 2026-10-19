import { redirect } from 'next/navigation';

/** Moved into Settings; kept so bookmarks and old links still land in the right place. */
export default function Moved() {
  redirect('/settings/languages');
}
