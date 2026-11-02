import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Screen } from '@/ui/controls';

/**
 * Where Google, Microsoft or Facebook sign-in returns to (carelink://auth/callback).
 * The sign-in screen that opened the browser reads the result itself; on
 * Android the same address also arrives as a link and is routed here, so this
 * only steps back to that screen - which is still waiting for the result.
 */
export default function AuthCallback() {
  const router = useRouter();
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);
  return <Screen header={false}>{null}</Screen>;
}
