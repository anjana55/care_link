import { SocialCallback } from '@/components/social/social-callback';

/** Where Google, Microsoft or Facebook sends a client back to (see SocialCallback). */
export default function ClientSocialCallbackPage() {
  return <SocialCallback side="client" />;
}
