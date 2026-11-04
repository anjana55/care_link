import type { TodoItem } from '@care-platform/shared';
import type { PushText } from '../push/push.service';

/**
 * Texts for the notices this module sends itself: reminders and digests, and
 * a caregiver's document being checked. In English, Sinhala and Tamil; the
 * company is named {brand}, filled in when sent.
 *
 * Sinhala and Tamil are drafts for review, like the other message files.
 */
export type Lang = 'en' | 'si' | 'ta';

/** Document names as a caregiver reads them, by document type and by the core labels on To do. */
const DOCUMENTS: Record<string, Record<Lang, string>> = {
  identity: { en: 'proof of identity', si: 'අනන්‍යතා සාධනය', ta: 'அடையாளச் சான்று' },
  police: { en: 'police clearance certificate', si: 'පොලිස් නිෂ්කාශන සහතිකය', ta: 'பொலிஸ் அனுமதிச் சான்றிதழ்' },
  gn: { en: 'Grama Niladhari certificate', si: 'ග්‍රාම නිලධාරී සහතිකය', ta: 'கிராம சேவகர் சான்றிதழ்' },
  NIC: { en: 'national identity card', si: 'ජාතික හැඳුනුම්පත', ta: 'தேசிய அடையாள அட்டை' },
  PASSPORT: { en: 'passport', si: 'විදේශ ගමන් බලපත්‍රය', ta: 'கடவுச்சீட்டு' },
  GRAMA_NILADHARI_CERTIFICATE: { en: 'Grama Niladhari certificate', si: 'ග්‍රාම නිලධාරී සහතිකය', ta: 'கிராம சேவகர் சான்றிதழ்' },
  POLICE_CLEARANCE: { en: 'police clearance certificate', si: 'පොලිස් නිෂ්කාශන සහතිකය', ta: 'பொலிஸ் அனுமதிச் சான்றிதழ்' },
  CAREGIVER_CERTIFICATE: { en: 'caregiver certificate', si: 'සත්කාරක සහතිකය', ta: 'பராமரிப்பாளர் சான்றிதழ்' },
  NVQ_CERTIFICATE: { en: 'NVQ certificate', si: 'NVQ සහතිකය', ta: 'NVQ சான்றிதழ்' },
  NURSING_CERTIFICATE: { en: 'nursing certificate', si: 'හෙද සහතිකය', ta: 'தாதியர் சான்றிதழ்' },
  CV: { en: 'CV', si: 'CV', ta: 'CV' },
  OTHER: { en: 'document', si: 'ලේඛනය', ta: 'ஆவணம்' },
};

export const documentName = (key: string | number | null | undefined, lang: Lang) => (DOCUMENTS[String(key)] ?? DOCUMENTS.OTHER)[lang];

const fill = (s: string, vars: Record<string, string | number | null | undefined>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k === 'brand' ? m : String(vars[k] ?? '')));

// --- a caregiver's document was checked ------------------------------------------------

const DOCUMENT_CHECKED: Record<'VERIFIED' | 'REJECTED', Record<Lang, PushText>> = {
  VERIFIED: {
    en: { title: 'Document accepted', body: 'Your {document} has been checked and accepted.' },
    si: { title: 'ලේඛනය පිළිගත්තා', body: 'ඔබගේ {document} පරීක්ෂා කර පිළිගෙන ඇත.' },
    ta: { title: 'ஆவணம் ஏற்றுக்கொள்ளப்பட்டது', body: 'உங்கள் {document} சரிபார்க்கப்பட்டு ஏற்றுக்கொள்ளப்பட்டது.' },
  },
  REJECTED: {
    en: { title: 'Please upload your document again', body: 'Your {document} could not be accepted. Please upload a clear copy.' },
    si: { title: 'කරුණාකර ලේඛනය නැවත උඩුගත කරන්න', body: 'ඔබගේ {document} පිළිගත නොහැකි විය. කරුණාකර පැහැදිලි පිටපතක් උඩුගත කරන්න.' },
    ta: { title: 'தயவுசெய்து ஆவணத்தை மீண்டும் பதிவேற்றவும்', body: 'உங்கள் {document} ஏற்றுக்கொள்ள முடியவில்லை. தெளிவான நகலைப் பதிவேற்றவும்.' },
  },
};

export function documentCheckedNotice(status: 'VERIFIED' | 'REJECTED', documentType: string, lang: Lang): PushText {
  const t = DOCUMENT_CHECKED[status][lang];
  return { title: t.title, body: fill(t.body, { document: documentName(documentType, lang) }) };
}

// --- a dated document running out (Work abroad) ----------------------------------------

const EXPIRY: Record<'SOON' | 'EXPIRED', Record<Lang, PushText>> = {
  SOON: {
    en: { title: 'A document is about to expire', body: 'Your {document} expires on {date}. Please upload the renewed one.' },
    si: { title: 'ලේඛනයක් ඉක්මනින් කල් ඉකුත් වේ', body: 'ඔබගේ {document} {date} දින කල් ඉකුත් වේ. කරුණාකර අලුත් කළ එක උඩුගත කරන්න.' },
    ta: { title: 'ஒரு ஆவணம் விரைவில் காலாவதியாகும்', body: 'உங்கள் {document} {date} அன்று காலாவதியாகும். புதுப்பித்ததைப் பதிவேற்றவும்.' },
  },
  EXPIRED: {
    en: { title: 'A document has expired', body: 'Your {document} expired on {date}. Please upload the renewed one.' },
    si: { title: 'ලේඛනයක් කල් ඉකුත් වී ඇත', body: 'ඔබගේ {document} {date} දින කල් ඉකුත් විය. කරුණාකර අලුත් කළ එක උඩුගත කරන්න.' },
    ta: { title: 'ஒரு ஆவணம் காலாவதியாகிவிட்டது', body: 'உங்கள் {document} {date} அன்று காலாவதியானது. புதுப்பித்ததைப் பதிவேற்றவும்.' },
  },
};

export function documentExpiryNotice(expired: boolean, documentType: string, date: string, lang: Lang): PushText {
  const t = EXPIRY[expired ? 'EXPIRED' : 'SOON'][lang];
  return { title: t.title, body: fill(t.body, { document: documentName(documentType, lang), date }) };
}

// --- reminders and digests ---------------------------------------------------------------

/** The reminder kinds the sweep sends, each a line in a digest. */
export type ReminderKind = 'INVOICE_DUE' | 'DOCUMENT_REJECTED' | 'SHIFT_TODAY';

export interface ReminderLine {
  kind: ReminderKind;
  /** The to-do it is about (the reminder lock's item key). */
  todo: TodoItem;
}

const LINE: Record<ReminderKind, Record<Lang, string>> = {
  INVOICE_DUE: {
    en: 'Pay invoice {number} ({amount}) by {date}.',
    si: '{date} ට පෙර ඉන්වොයිසිය {number} ({amount}) ගෙවන්න.',
    ta: '{date} க்குள் விலைப்பட்டியல் {number} ({amount}) செலுத்துங்கள்.',
  },
  DOCUMENT_REJECTED: {
    en: 'Upload your {document} again - the last one could not be accepted.',
    si: 'ඔබගේ {document} නැවත උඩුගත කරන්න - පෙර එක පිළිගත නොහැකි විය.',
    ta: 'உங்கள் {document} ஐ மீண்டும் பதிவேற்றவும் - முந்தையதை ஏற்க முடியவில்லை.',
  },
  SHIFT_TODAY: {
    en: 'You have a shift today at {time} ({reference}).',
    si: 'අද {time} ට ඔබට සේවා කාලයක් ඇත ({reference}).',
    ta: 'இன்று {time} மணிக்கு உங்களுக்கு ஒரு பணி உள்ளது ({reference}).',
  },
};

const TITLE: Record<Lang, { one: string; many: string }> = {
  en: { one: 'A reminder from {brand}', many: 'You have {n} things to do' },
  si: { one: '{brand} වෙතින් සිහිකැඳවීමක්', many: 'ඔබට කළ යුතු දේ {n}ක් ඇත' },
  ta: { one: '{brand} இடமிருந்து ஒரு நினைவூட்டல்', many: 'நீங்கள் செய்ய வேண்டியவை {n} உள்ளன' },
};

const SEE_ALL: Record<Lang, string> = {
  en: 'Open {brand} to see everything on your To do list.',
  si: 'ඔබගේ කළ යුතු දේ ලැයිස්තුව බැලීමට {brand} විවෘත කරන්න.',
  ta: 'உங்கள் செய்ய வேண்டியவை பட்டியலைப் பார்க்க {brand} ஐத் திறக்கவும்.',
};

export const OPEN_CTA: Record<Lang, string> = { en: 'Open my To do list', si: 'මගේ කළ යුතු දේ විවෘත කරන්න', ta: 'எனது செய்ய வேண்டியவை திறக்கவும்' };

export function reminderLine(line: ReminderLine, lang: Lang): string {
  const p = line.todo.params;
  return fill(LINE[line.kind][lang], { ...p, date: line.todo.dueOn, document: documentName(p.document, lang) });
}

/** One reminder or a digest of several: the push, and the lines for an email or WhatsApp message. */
export function digestNotice(lines: ReminderLine[], lang: Lang): PushText & { lines: string[]; footer: string } {
  const texts = lines.map((l) => reminderLine(l, lang));
  const title = lines.length === 1 ? TITLE[lang].one : fill(TITLE[lang].many, { n: lines.length });
  return { title, body: texts.join(' '), lines: texts, footer: SEE_ALL[lang] };
}
