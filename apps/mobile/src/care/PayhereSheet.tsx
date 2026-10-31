import { Modal, StyleSheet, UIManager, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PayhereCheckout } from '@care-platform/shared';
import { config } from '@/config';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';

/** Only PayHere's own checkout is ever posted to (live or sandbox). */
const PAYHERE = /^https:\/\/(www\.|sandbox\.)?payhere\.lk\//;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * PayHere's checkout expects a form POST, as the website sends it. The app
 * renders that form in a page of its own and submits it straight away.
 */
export function checkoutHtml({ action, fields }: PayhereCheckout, opening: string): string {
  if (!PAYHERE.test(action)) throw new Error('Not a PayHere checkout');
  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`)
    .join('');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body onload="document.forms[0].submit()" style="font-family:sans-serif;padding:24px"><p>${escape(opening)}</p><form method="post" action="${escape(action)}">${inputs}</form></body></html>`;
}

/** Where PayHere sends the person back: paid (or at least finished) or cancelled - or neither yet. */
export function outcomeOf(url: string, checkout: PayhereCheckout): 'return' | 'cancelled' | null {
  const { return_url: back, cancel_url: cancel } = checkout.fields;
  if (cancel && url.startsWith(cancel)) return 'cancelled';
  if (back && url.startsWith(back)) return 'return';
  return null;
}

/**
 * The WebView is a native module: a development build made before it was
 * added doesn't have it. Then the website takes the payment instead.
 */
export function webViewAvailable(): boolean {
  try {
    return Boolean(UIManager.hasViewManagerConfig?.('RNCWebView'));
  } catch {
    return false;
  }
}

/**
 * PayHere's checkout inside the app. When PayHere sends the person back, the
 * sheet closes and says which way: `return` means they finished, and the
 * invoice then waits for PayHere's own confirmation; `cancelled` means
 * nothing was charged. Closing it by hand is `closed`: they may have paid
 * just before, so the invoice is checked again without claiming either.
 */
export type PayhereOutcome = 'return' | 'cancelled' | 'closed';

export function PayhereSheet({ checkout, onFinish }: { checkout: PayhereCheckout | null; onFinish: (outcome: PayhereOutcome) => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  if (!checkout) return null;
  // Loaded only here, so a build without the native module never touches it.
  const { WebView } = require('react-native-webview') as typeof import('react-native-webview');

  const watch = (url: string) => {
    const outcome = outcomeOf(url, checkout);
    if (outcome) onFinish(outcome);
    return outcome === null;
  };

  return (
    <Modal visible animationType="slide" onRequestClose={() => onFinish('closed')}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={styles.bar}>
          <Button variant="link" label={t('care.dialog.close')} onPress={() => onFinish('closed')} />
        </View>
        <WebView
          testID="payhere"
          originWhitelist={['https://*', 'about:*']}
          // PayHere ties the merchant to the website's domain: the form comes from there, as on the website.
          source={{ html: checkoutHtml(checkout, t('invoices.pay.redirecting')), baseUrl: config.siteUrl }}
          onShouldStartLoadWithRequest={(req) => watch(req.url)}
          onNavigationStateChange={(nav) => void watch(nav.url)}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          style={{ flex: 1 }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 16, alignItems: 'flex-end' },
});
