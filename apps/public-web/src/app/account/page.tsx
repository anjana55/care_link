import { redirect } from 'next/navigation';

/** /account has no page of its own - requests are the useful landing. */
export default function AccountIndex() {
  redirect('/account/requests');
}
