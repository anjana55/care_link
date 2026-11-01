import { SocialCallback } from '@/components/social/social-callback';

/** Where Google, Microsoft or Facebook sends a caregiver back to (see SocialCallback). */
export default function CaregiverSocialCallbackPage() {
  return <SocialCallback side="caregiver" />;
}
