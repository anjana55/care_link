import { redirect } from 'next/navigation';

/** Moved into Settings > Import & export; kept so bookmarks and old links (with ?type=) still land in the right place. */
export default async function Moved({ searchParams }: { searchParams: Promise<{ type?: string | string[] }> }) {
  const { type } = await searchParams;
  redirect(type === 'clients' ? '/settings/import-export?type=clients' : '/settings/import-export');
}
