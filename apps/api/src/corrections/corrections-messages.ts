import type { CareRequestLanguage, IssueReportCategory } from '../database/schema';

/**
 * What correction and issue-report notices say, in English, Sinhala and
 * Tamil. Like the booking notices they carry references and amounts, never
 * names or addresses. Sinhala and Tamil are machine-drafted and want a native
 * speaker's review.
 */
type Lang = CareRequestLanguage;
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);

// --- the client: their invoice changed ------------------------------------------------

const CLIENT_HEAD: Record<Lang, { subject: string; heading: string; intro: string }> = {
  en: { subject: 'A correction to your booking {ref}', heading: 'We corrected your booking', intro: 'We found something to put right on booking {ref} and corrected it.' },
  si: { subject: 'ඔබගේ වෙන්කිරීම {ref} හි නිවැරදි කිරීමක්', heading: 'අපි ඔබගේ වෙන්කිරීම නිවැරදි කළෙමු', intro: 'වෙන්කිරීම {ref} හි නිවැරදි කළ යුතු දෙයක් අපට හමු වූ අතර අපි එය නිවැරදි කළෙමු.' },
  ta: { subject: 'உங்கள் முன்பதிவு {ref} இல் ஒரு திருத்தம்', heading: 'உங்கள் முன்பதிவைத் திருத்தினோம்', intro: 'முன்பதிவு {ref} இல் சரிசெய்ய வேண்டிய ஒன்றைக் கண்டறிந்து திருத்தினோம்.' },
};

const CLIENT_LINE: Record<'REPLACE' | 'OWE' | 'CREDIT', Record<Lang, string>> = {
  REPLACE: {
    en: 'Invoice {label} has been cancelled and a corrected invoice will be sent to you shortly. Please do not pay {label}.',
    si: 'ඉන්වොයිසිය {label} අවලංගු කර ඇති අතර නිවැරදි කළ ඉන්වොයිසියක් ඉක්මනින් ඔබට එවනු ලැබේ. කරුණාකර {label} ගෙවන්න එපා.',
    ta: 'விலைப்பட்டியல் {label} ரத்து செய்யப்பட்டது; திருத்திய விலைப்பட்டியல் விரைவில் உங்களுக்கு அனுப்பப்படும். தயவுசெய்து {label} ஐச் செலுத்த வேண்டாம்.',
  },
  OWE: {
    en: '{amount} more is due for invoice {label}. It will be added to your next invoice.',
    si: 'ඉන්වොයිසිය {label} සඳහා තවත් {amount}ක් ගෙවිය යුතුය. එය ඔබගේ ඊළඟ ඉන්වොයිසියට එක් කෙරේ.',
    ta: 'விலைப்பட்டியல் {label} க்கு மேலும் {amount} செலுத்த வேண்டும். அது உங்கள் அடுத்த விலைப்பட்டியலில் சேர்க்கப்படும்.',
  },
  CREDIT: {
    en: 'You were charged {amount} too much on invoice {label}. It will come off your next invoice, or our team will contact you to refund it.',
    si: 'ඉන්වොයිසිය {label} හි ඔබෙන් {amount}ක් වැඩිපුර අය කර ඇත. එය ඔබගේ ඊළඟ ඉන්වොයිසියෙන් අඩු කෙරේ, නැතහොත් එය ආපසු ගෙවීමට අපගේ කණ්ඩායම ඔබව සම්බන්ධ කර ගනු ඇත.',
    ta: 'விலைப்பட்டியல் {label} இல் உங்களிடம் {amount} அதிகமாக வசூலிக்கப்பட்டது. அது உங்கள் அடுத்த விலைப்பட்டியலில் கழிக்கப்படும், அல்லது அதைத் திருப்பித் தர எங்கள் குழு உங்களைத் தொடர்புகொள்ளும்.',
  },
};

export function correctionClientNotice(lang: Lang, ref: string, items: { kind: 'REPLACE' | 'OWE' | 'CREDIT'; label: string; amount: string }[]) {
  const head = CLIENT_HEAD[lang] ?? CLIENT_HEAD.en;
  const lines = items.map((i) => fill((CLIENT_LINE[i.kind][lang] ?? CLIENT_LINE[i.kind].en), { label: i.label, amount: i.amount }));
  return { subject: fill(head.subject, { ref }), heading: head.heading, paragraphs: [fill(head.intro, { ref }), ...lines] };
}

// --- caregivers: their pay changed (all three languages, like every caregiver notice) ----

const CG_HEAD: Record<Lang, { heading: string; intro: string }> = {
  en: { heading: 'A correction to your pay', intro: 'Your pay for booking {ref} has been corrected.' },
  si: { heading: 'ඔබගේ ගෙවීමට නිවැරදි කිරීමක්', intro: 'වෙන්කිරීම {ref} සඳහා ඔබගේ ගෙවීම නිවැරදි කර ඇත.' },
  ta: { heading: 'உங்கள் ஊதியத்தில் ஒரு திருத்தம்', intro: 'முன்பதிவு {ref} க்கான உங்கள் ஊதியம் திருத்தப்பட்டது.' },
};

const CG_LINE: Record<'REOPEN' | 'MORE' | 'LESS', Record<Lang, string>> = {
  REOPEN: {
    en: 'Pay statement {label} is being corrected and will be approved again before it is paid.',
    si: 'ගෙවීම් ප්‍රකාශය {label} නිවැරදි කරමින් පවතින අතර ගෙවීමට පෙර එය නැවත අනුමත කෙරේ.',
    ta: 'கொடுப்பனவு அறிக்கை {label} திருத்தப்படுகிறது; செலுத்தும் முன் மீண்டும் அங்கீகரிக்கப்படும்.',
  },
  MORE: {
    en: 'You are owed {amount} more. It will be added to your next pay statement.',
    si: 'ඔබට තවත් {amount}ක් ලැබිය යුතුය. එය ඔබගේ ඊළඟ ගෙවීම් ප්‍රකාශයට එක් කෙරේ.',
    ta: 'உங்களுக்கு மேலும் {amount} வர வேண்டும். அது உங்கள் அடுத்த கொடுப்பனவு அறிக்கையில் சேர்க்கப்படும்.',
  },
  LESS: {
    en: 'You were paid {amount} too much. It will come off your next pay statement.',
    si: 'ඔබට {amount}ක් වැඩිපුර ගෙවා ඇත. එය ඔබගේ ඊළඟ ගෙවීම් ප්‍රකාශයෙන් අඩු කෙරේ.',
    ta: 'உங்களுக்கு {amount} அதிகமாகச் செலுத்தப்பட்டது. அது உங்கள் அடுத்த கொடுப்பனவு அறிக்கையில் கழிக்கப்படும்.',
  },
};

export function correctionCaregiverNotice(ref: string, items: { kind: 'REOPEN' | 'MORE' | 'LESS'; label: string; amount: string }[]) {
  const blocks = (['en', 'si', 'ta'] as const).map((lang) => ({
    lang,
    heading: CG_HEAD[lang].heading,
    paragraphs: [fill(CG_HEAD[lang].intro, { ref }), ...items.map((i) => fill(CG_LINE[i.kind][lang], { label: i.label, amount: i.amount }))],
  }));
  return { subject: `{brand} - ${blocks[0].heading} (${ref})`, blocks, whatsappText: blocks.map((b) => b.paragraphs.join(' ')).join(' / ') };
}

// --- issue reports --------------------------------------------------------------------

const RECEIVED: Record<Lang, { subject: string; heading: string; body: string }> = {
  en: { subject: 'We received your report on booking {ref}', heading: 'Thanks - we are looking into it', body: 'Our team has your report about booking {ref} and will check it against the records. We will let you know what we find.' },
  si: { subject: 'වෙන්කිරීම {ref} පිළිබඳ ඔබගේ වාර්තාව අපට ලැබුණා', heading: 'ස්තූතියි - අපි එය සොයා බලමින් සිටිමු', body: 'වෙන්කිරීම {ref} පිළිබඳ ඔබගේ වාර්තාව අපගේ කණ්ඩායමට ලැබී ඇති අතර ඔවුන් එය වාර්තා සමඟ පරීක්ෂා කරනු ඇත. අපට හමු වන දේ අපි ඔබට දන්වන්නෙමු.' },
  ta: { subject: 'முன்பதிவு {ref} பற்றிய உங்கள் புகாரைப் பெற்றோம்', heading: 'நன்றி - நாங்கள் இதைப் பார்க்கிறோம்', body: 'முன்பதிவு {ref} பற்றிய உங்கள் புகார் எங்கள் குழுவிடம் உள்ளது; அவர்கள் பதிவுகளுடன் ஒப்பிட்டுப் பார்ப்பார்கள். கண்டறிவதை உங்களுக்குத் தெரிவிப்போம்.' },
};

const CLOSED: Record<'RESOLVED' | 'DISMISSED', Record<Lang, { subject: string; heading: string; body: string }>> = {
  RESOLVED: {
    en: { subject: 'Your report on booking {ref} has been resolved', heading: 'We have dealt with your report', body: 'Thank you for telling us. We have looked into your report about booking {ref} and put it right.' },
    si: { subject: 'වෙන්කිරීම {ref} පිළිබඳ ඔබගේ වාර්තාව විසඳා ඇත', heading: 'අපි ඔබගේ වාර්තාව විසඳුවෙමු', body: 'අපට දැන්වීම ගැන ස්තූතියි. වෙන්කිරීම {ref} පිළිබඳ ඔබගේ වාර්තාව අපි සොයා බලා එය නිවැරදි කළෙමු.' },
    ta: { subject: 'முன்பதிவு {ref} பற்றிய உங்கள் புகார் தீர்க்கப்பட்டது', heading: 'உங்கள் புகாரைக் கவனித்தோம்', body: 'எங்களுக்குத் தெரிவித்ததற்கு நன்றி. முன்பதிவு {ref} பற்றிய உங்கள் புகாரைப் பார்த்துச் சரிசெய்தோம்.' },
  },
  DISMISSED: {
    en: { subject: 'About your report on booking {ref}', heading: 'We checked your report', body: 'Thank you for telling us. We checked your report about booking {ref} against our records and found nothing that needs changing.' },
    si: { subject: 'වෙන්කිරීම {ref} පිළිබඳ ඔබගේ වාර්තාව ගැන', heading: 'අපි ඔබගේ වාර්තාව පරීක්ෂා කළෙමු', body: 'අපට දැන්වීම ගැන ස්තූතියි. වෙන්කිරීම {ref} පිළිබඳ ඔබගේ වාර්තාව අපි අපගේ වාර්තා සමඟ පරීක්ෂා කළ අතර වෙනස් කළ යුතු කිසිවක් හමු නොවීය.' },
    ta: { subject: 'முன்பதிவு {ref} பற்றிய உங்கள் புகார் குறித்து', heading: 'உங்கள் புகாரைச் சரிபார்த்தோம்', body: 'எங்களுக்குத் தெரிவித்ததற்கு நன்றி. முன்பதிவு {ref} பற்றிய உங்கள் புகாரை எங்கள் பதிவுகளுடன் சரிபார்த்தோம்; மாற்ற வேண்டியது எதுவும் இல்லை.' },
  },
};

const NOTE_LABEL: Record<Lang, string> = { en: 'Our note: {note}', si: 'අපගේ සටහන: {note}', ta: 'எங்கள் குறிப்பு: {note}' };

/** The reporter's acknowledgement or answer: clients in their language, caregivers in all three. */
export function issueNotice(kind: 'RECEIVED' | 'RESOLVED' | 'DISMISSED', lang: Lang, ref: string, note: string | null, trilingual: boolean) {
  const pick = (l: Lang) => (kind === 'RECEIVED' ? RECEIVED[l] : CLOSED[kind][l]);
  const langs: Lang[] = trilingual ? ['en', 'si', 'ta'] : [lang];
  const blocks = langs.map((l) => ({
    lang: l,
    heading: pick(l).heading,
    paragraphs: [fill(pick(l).body, { ref }), ...(note ? [fill(NOTE_LABEL[l], { note })] : [])],
  }));
  const subject = fill(pick(trilingual ? 'en' : lang).subject, { ref });
  return { subject: trilingual ? `{brand} - ${subject}` : subject, blocks, whatsappText: blocks.map((b) => `${b.heading}. ${b.paragraphs.join(' ')}`).join(' / ') };
}

/** For the staff alert (English, like every staff email). */
export const CATEGORY_EN: Record<IssueReportCategory, string> = {
  TIMES: 'Times were wrong',
  DID_NOT_HAPPEN: 'A shift did not happen',
  WRONG_CAREGIVER: 'A different caregiver came',
  CHARGE: 'The charge is wrong',
  PAY: 'The pay is wrong',
  OTHER: 'Something else',
};

export const CORRECTION_CTA: Record<Lang, string> = { en: 'View your account', si: 'ඔබගේ ගිණුම බලන්න', ta: 'உங்கள் கணக்கைப் பாருங்கள்' };
