import type { CareRequestLanguage, CareRequestStatus } from '../database/schema';

/**
 * Every word a care request notification says, in English, Sinhala and Tamil.
 *
 * Deliberately generic: no names, phone numbers, places or care details ever
 * appear in a notification, because they travel over email and WhatsApp and
 * because the whole point of staff-mediated contact is that neither side
 * learns the other's details through the app. The reference number is enough
 * for anyone to quote on a call.
 *
 * Sinhala and Tamil are machine-drafted, like the rest of the platform's
 * strings, and want a native speaker's review (see i18n-review/).
 */
type Lang = CareRequestLanguage;

export interface NoticeText {
  subject: string;
  heading: string;
  body: string;
}

const fill = (template: string, ref: string) => template.replace(/\{ref\}/g, ref);

/** Client-facing notices: the client's own language, chosen when they sent the request. */
type ClientNotice = 'RECEIVED' | 'IN_PROGRESS' | 'INTRODUCED' | 'CLOSED';

const CLIENT: Record<ClientNotice, Record<Lang, NoticeText>> = {
  RECEIVED: {
    en: {
      subject: "We've received your request {ref}",
      heading: 'Thank you - your request has reached our team',
      body: 'Our team will call you to talk about your care needs and the caregiver you chose. Your reference is {ref}.',
    },
    si: {
      subject: 'ඔබගේ ඉල්ලීම {ref} අපට ලැබුණි',
      heading: 'ස්තූතියි - ඔබගේ ඉල්ලීම අපගේ කණ්ඩායමට ලැබී ඇත',
      body: 'ඔබගේ රැකවරණ අවශ්‍යතා සහ ඔබ තෝරාගත් රැකවරණ සේවකයා ගැන කතා කිරීමට අපගේ කණ්ඩායම ඔබ අමතනු ඇත. ඔබගේ යොමු අංකය {ref}.',
    },
    ta: {
      subject: 'உங்கள் கோரிக்கை {ref} எங்களுக்குக் கிடைத்தது',
      heading: 'நன்றி - உங்கள் கோரிக்கை எங்கள் குழுவை அடைந்துள்ளது',
      body: 'உங்கள் பராமரிப்புத் தேவைகள் மற்றும் நீங்கள் தேர்ந்தெடுத்த பராமரிப்பாளர் பற்றிப் பேச எங்கள் குழு உங்களை அழைக்கும். உங்கள் குறிப்பு எண் {ref}.',
    },
  },
  IN_PROGRESS: {
    en: {
      subject: 'Update on your request {ref}',
      heading: 'Our team is working on your request',
      body: 'We are arranging the next steps for request {ref} and will be in touch shortly using your preferred contact method.',
    },
    si: {
      subject: 'ඔබගේ ඉල්ලීම {ref} පිළිබඳ යාවත්කාලීන කිරීමක්',
      heading: 'අපගේ කණ්ඩායම ඔබගේ ඉල්ලීම මත කටයුතු කරමින් සිටී',
      body: 'ඉල්ලීම {ref} සඳහා ඊළඟ පියවර අපි සූදානම් කරමින් සිටිමු. ඔබ කැමති සම්බන්ධතා ක්‍රමය හරහා අපි ඉක්මනින් ඔබව සම්බන්ධ කර ගන්නෙමු.',
    },
    ta: {
      subject: 'உங்கள் கோரிக்கை {ref} பற்றிய புதுப்பிப்பு',
      heading: 'எங்கள் குழு உங்கள் கோரிக்கையில் பணியாற்றி வருகிறது',
      body: 'கோரிக்கை {ref} க்கான அடுத்த படிகளை ஏற்பாடு செய்து வருகிறோம். நீங்கள் விரும்பிய தொடர்பு முறையில் விரைவில் உங்களைத் தொடர்புகொள்வோம்.',
    },
  },
  INTRODUCED: {
    en: {
      subject: "You've been introduced - request {ref}",
      heading: 'Good news - we have introduced you to the caregiver',
      body: 'For request {ref}, our team has put you in touch with the caregiver and shared what you need to get started.',
    },
    si: {
      subject: 'ඔබව හඳුන්වා දී ඇත - ඉල්ලීම {ref}',
      heading: 'ශුභ ආරංචියක් - අපි ඔබව රැකවරණ සේවකයාට හඳුන්වා දී ඇත',
      body: 'ඉල්ලීම {ref} සඳහා, අපගේ කණ්ඩායම ඔබව රැකවරණ සේවකයා සමඟ සම්බන්ධ කර, ආරම්භ කිරීමට අවශ්‍ය තොරතුරු ඔබ සමඟ බෙදාගෙන ඇත.',
    },
    ta: {
      subject: 'உங்களை அறிமுகப்படுத்தியுள்ளோம் - கோரிக்கை {ref}',
      heading: 'நல்ல செய்தி - உங்களைப் பராமரிப்பாளரிடம் அறிமுகப்படுத்தியுள்ளோம்',
      body: 'கோரிக்கை {ref} க்காக, எங்கள் குழு உங்களைப் பராமரிப்பாளருடன் இணைத்து, தொடங்குவதற்குத் தேவையானவற்றைப் பகிர்ந்துள்ளது.',
    },
  },
  CLOSED: {
    en: {
      subject: 'Your request {ref} has been closed',
      heading: 'Your request has been closed',
      body: 'Request {ref} is now closed. If you still need care, you can search for another caregiver at any time or contact us.',
    },
    si: {
      subject: 'ඔබගේ ඉල්ලීම {ref} වසා දමා ඇත',
      heading: 'ඔබගේ ඉල්ලීම වසා දමා ඇත',
      body: 'ඉල්ලීම {ref} දැන් වසා ඇත. ඔබට තවමත් රැකවරණය අවශ්‍ය නම්, ඕනෑම වේලාවක වෙනත් රැකවරණ සේවකයෙකු සොයන්න හෝ අප හා සම්බන්ධ වන්න.',
    },
    ta: {
      subject: 'உங்கள் கோரிக்கை {ref} மூடப்பட்டது',
      heading: 'உங்கள் கோரிக்கை மூடப்பட்டது',
      body: 'கோரிக்கை {ref} இப்போது மூடப்பட்டுள்ளது. உங்களுக்கு இன்னும் பராமரிப்பு தேவைப்பட்டால், எப்போது வேண்டுமானாலும் வேறு பராமரிப்பாளரைத் தேடலாம் அல்லது எங்களைத் தொடர்புகொள்ளலாம்.',
    },
  },
};

/** The client notice for a status a request has just moved into, if that move warrants one. */
export function clientNoticeFor(status: CareRequestStatus): ClientNotice | null {
  if (status === 'IN_PROGRESS' || status === 'INTRODUCED' || status === 'CLOSED') return status;
  return null;
}

export function clientNotice(notice: ClientNotice, lang: Lang, ref: string): NoticeText {
  const t = CLIENT[notice][lang] ?? CLIENT[notice].en;
  return { subject: fill(t.subject, ref), heading: fill(t.heading, ref), body: fill(t.body, ref) };
}

export const CLIENT_CTA: Record<Lang, string> = {
  en: 'View your requests',
  si: 'ඔබගේ ඉල්ලීම් බලන්න',
  ta: 'உங்கள் கோரிக்கைகளைப் பாருங்கள்',
};

export const CLIENT_FOOTER: Record<Lang, string> = {
  en: 'You are receiving this because you asked CareLink to contact a caregiver for you.',
  si: 'ඔබ වෙනුවෙන් රැකවරණ සේවකයෙකු සම්බන්ධ කර ගැනීමට ඔබ CareLink වෙත ඉල්ලා සිටි නිසා ඔබට මෙය ලැබේ.',
  ta: 'உங்களுக்காக ஒரு பராமரிப்பாளரைத் தொடர்புகொள்ள CareLink இடம் நீங்கள் கேட்டதால் இதைப் பெறுகிறீர்கள்.',
};

/**
 * Caregiver-facing notices. The platform does not record a caregiver's
 * language, so these go out in all three, English first.
 */
type CaregiverNotice = 'IN_PROGRESS' | 'INTRODUCED';

const CAREGIVER: Record<CaregiverNotice, Record<Lang, { heading: string; body: string }>> = {
  IN_PROGRESS: {
    en: {
      heading: 'A family is interested in working with you',
      body: 'A family has asked CareLink about you. Our team will contact you soon to discuss it. Reference {ref}.',
    },
    si: {
      heading: 'පවුලක් ඔබ සමඟ වැඩ කිරීමට කැමැත්තක් දක්වයි',
      body: 'පවුලක් ඔබ ගැන CareLink වෙතින් විමසා ඇත. ඒ ගැන සාකච්ඡා කිරීමට අපගේ කණ්ඩායම ඉක්මනින් ඔබව සම්බන්ධ කර ගනු ඇත. යොමු අංකය {ref}.',
    },
    ta: {
      heading: 'ஒரு குடும்பம் உங்களுடன் பணியாற்ற ஆர்வம் காட்டுகிறது',
      body: 'ஒரு குடும்பம் உங்களைப் பற்றி CareLink இடம் கேட்டுள்ளது. இதுபற்றிப் பேச எங்கள் குழு விரைவில் உங்களைத் தொடர்புகொள்ளும். குறிப்பு எண் {ref}.',
    },
  },
  INTRODUCED: {
    en: {
      heading: 'You have been introduced to a family',
      body: 'Our team has introduced you to a family through CareLink (reference {ref}). Please follow the details our team shared with you.',
    },
    si: {
      heading: 'ඔබව පවුලකට හඳුන්වා දී ඇත',
      body: 'අපගේ කණ්ඩායම CareLink හරහා ඔබව පවුලකට හඳුන්වා දී ඇත (යොමු අංකය {ref}). කරුණාකර අපගේ කණ්ඩායම ඔබ සමඟ බෙදාගත් තොරතුරු අනුගමනය කරන්න.',
    },
    ta: {
      heading: 'உங்களை ஒரு குடும்பத்திடம் அறிமுகப்படுத்தியுள்ளோம்',
      body: 'எங்கள் குழு CareLink மூலம் உங்களை ஒரு குடும்பத்திடம் அறிமுகப்படுத்தியுள்ளது (குறிப்பு எண் {ref}). எங்கள் குழு பகிர்ந்த விவரங்களைப் பின்பற்றவும்.',
    },
  },
};

export function caregiverNoticeFor(status: CareRequestStatus): CaregiverNotice | null {
  return status === 'IN_PROGRESS' || status === 'INTRODUCED' ? status : null;
}

const LANGS: Lang[] = ['en', 'si', 'ta'];

export function caregiverNotice(notice: CaregiverNotice, ref: string) {
  const blocks = LANGS.map((lang) => ({
    lang,
    heading: fill(CAREGIVER[notice][lang].heading, ref),
    body: fill(CAREGIVER[notice][lang].body, ref),
  }));
  return {
    subject: `CareLink - ${blocks[0].heading} (${ref})`,
    blocks,
    // One WhatsApp template parameter cannot hold line breaks, so the three
    // languages are joined on one line.
    whatsappText: blocks.map((b) => b.body).join(' / '),
  };
}
