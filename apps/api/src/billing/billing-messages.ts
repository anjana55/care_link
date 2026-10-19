import type { CareRequestLanguage } from '../database/schema';

/**
 * What billing notices say, in English, Sinhala and Tamil. Like the booking
 * notices they carry only a reference, an amount and a date - the invoice
 * itself is read in the CareLink account. Sinhala and Tamil are
 * machine-drafted and want a native speaker's review.
 */
type Lang = CareRequestLanguage;
type ClientNotice = 'ISSUED' | 'PAID';

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');

const CLIENT: Record<ClientNotice, Record<Lang, { subject: string; heading: string; body: string }>> = {
  ISSUED: {
    en: {
      subject: 'Invoice {number} from CareLink',
      heading: 'Your invoice is ready',
      body: 'Invoice {number} for {amount} is ready and due on {date}. You can view, print and pay it in your CareLink account.',
    },
    si: {
      subject: 'CareLink වෙතින් ඉන්වොයිසිය {number}',
      heading: 'ඔබගේ ඉන්වොයිසිය සූදානම්',
      body: '{amount} ක ඉන්වොයිසිය {number} සූදානම් වන අතර එය {date} දිනට ගෙවිය යුතුය. ඔබගේ CareLink ගිණුමෙන් එය බලා, මුද්‍රණය කර ගෙවිය හැක.',
    },
    ta: {
      subject: 'CareLink இலிருந்து விலைப்பட்டியல் {number}',
      heading: 'உங்கள் விலைப்பட்டியல் தயார்',
      body: '{amount} க்கான விலைப்பட்டியல் {number} தயாராக உள்ளது; {date} க்குள் செலுத்த வேண்டும். உங்கள் CareLink கணக்கில் அதைப் பார்க்கவும், அச்சிடவும், செலுத்தவும் முடியும்.',
    },
  },
  PAID: {
    en: {
      subject: 'Payment received for invoice {number}',
      heading: 'Thank you - your invoice is paid',
      body: 'We have received your payment and invoice {number} ({amount}) is now paid in full.',
    },
    si: {
      subject: 'ඉන්වොයිසිය {number} සඳහා ගෙවීම ලැබුණි',
      heading: 'ස්තූතියි - ඔබගේ ඉන්වොයිසිය ගෙවා ඇත',
      body: 'ඔබගේ ගෙවීම අපට ලැබුණු අතර ඉන්වොයිසිය {number} ({amount}) දැන් සම්පූර්ණයෙන් ගෙවා ඇත.',
    },
    ta: {
      subject: 'விலைப்பட்டியல் {number} க்கான கட்டணம் பெறப்பட்டது',
      heading: 'நன்றி - உங்கள் விலைப்பட்டியல் செலுத்தப்பட்டது',
      body: 'உங்கள் கட்டணம் எங்களுக்குக் கிடைத்தது; விலைப்பட்டியல் {number} ({amount}) இப்போது முழுமையாகச் செலுத்தப்பட்டது.',
    },
  },
};

export const BILLING_CTA: Record<Lang, string> = {
  en: 'View your invoices',
  si: 'ඔබගේ ඉන්වොයිසි බලන්න',
  ta: 'உங்கள் விலைப்பட்டியல்களைப் பாருங்கள்',
};

export const BILLING_FOOTER: Record<Lang, string> = {
  en: 'You are receiving this because you have a care booking with CareLink.',
  si: 'ඔබට CareLink සමඟ රැකවරණ වෙන්කිරීමක් ඇති නිසා ඔබට මෙය ලැබේ.',
  ta: 'CareLink உடன் உங்களுக்குப் பராமரிப்பு முன்பதிவு இருப்பதால் இதைப் பெறுகிறீர்கள்.',
};

const PAYOUT_PAID: Record<Lang, { heading: string; body: string }> = {
  en: { heading: 'Your payment has been sent', body: 'Payment {ref} of {amount} for {from} to {to} was made on {date}. The details are in your CareLink account.' },
  si: { heading: 'ඔබගේ ගෙවීම යවා ඇත', body: '{from} සිට {to} දක්වා කාලය සඳහා {amount} ක ගෙවීම {ref}, {date} දින සිදු කරන ලදී. විස්තර ඔබගේ CareLink ගිණුමේ ඇත.' },
  ta: { heading: 'உங்கள் கொடுப்பனவு அனுப்பப்பட்டது', body: '{from} முதல் {to} வரையிலான காலத்துக்கான {amount} கொடுப்பனவு {ref}, {date} அன்று செலுத்தப்பட்டது. விவரங்கள் உங்கள் CareLink கணக்கில் உள்ளன.' },
};

export function invoiceClientNotice(notice: ClientNotice, lang: Lang, vars: { number: string; amount: string; date: string }) {
  const t = CLIENT[notice][lang] ?? CLIENT[notice].en;
  return { subject: fill(t.subject, vars), heading: fill(t.heading, vars), body: fill(t.body, vars) };
}

export function payoutPaidNotice(vars: { ref: string; amount: string; from: string; to: string; date: string }) {
  const blocks = (['en', 'si', 'ta'] as const).map((lang) => ({
    lang,
    heading: fill(PAYOUT_PAID[lang].heading, vars),
    body: fill(PAYOUT_PAID[lang].body, vars),
  }));
  return { subject: `CareLink - ${blocks[0].heading} (${vars.ref})`, blocks, whatsappText: blocks.map((b) => b.body).join(' / ') };
}
