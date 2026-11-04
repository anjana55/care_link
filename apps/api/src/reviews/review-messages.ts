import type { ReviewBadge, ReviewImprovementTag } from '@care-platform/shared';
import type { CareRequestLanguage } from '../database/schema';

/**
 * Rating notices in English, Sinhala and Tamil. Like the booking notices they
 * carry no health details; the client's message names the booking reference
 * only, never the caregiver (who isn't named on the public site). Sinhala and
 * Tamil are machine-drafted and want a native speaker's review.
 */
type Lang = CareRequestLanguage;
const LANGS: readonly Lang[] = ['en', 'si', 'ta'];

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);

/** Badge names as they appear in messages (the websites and the app carry their own copies). */
export const BADGE_LABELS: Record<ReviewBadge, Record<Lang, string>> = {
  PUNCTUAL: { en: 'Always on time', si: 'සැමවිටම නියමිත වේලාවට', ta: 'எப்போதும் நேரம் தவறாதவர்' },
  KIND_PATIENT: { en: 'Kind and patient', si: 'කාරුණික හා ඉවසිලිවන්ත', ta: 'அன்பும் பொறுமையும் உள்ளவர்' },
  CLEAN_TIDY: { en: 'Clean and hygienic', si: 'පිරිසිදු හා සනීපාරක්ෂක', ta: 'சுத்தமும் சுகாதாரமும் பேணுபவர்' },
  SKILLED_CARE: { en: 'Skilled with care tasks', si: 'රැකවරණ කාර්යයන්හි දක්ෂ', ta: 'பராமரிப்புப் பணிகளில் திறமையானவர்' },
  SAFE_HANDLING: { en: 'Safe lifting and moving', si: 'ආරක්ෂිතව ඔසවයි, චලනය කරයි', ta: 'பாதுகாப்பாகத் தூக்கி நகர்த்துபவர்' },
  GOOD_COMMUNICATION: { en: 'Keeps the family informed', si: 'පවුලට නිතර දැනුම් දෙයි', ta: 'குடும்பத்துக்குத் தகவல் தருபவர்' },
  RESPECTFUL: { en: 'Respectful, protects dignity', si: 'ගෞරවනීය, අභිමානය රකියි', ta: 'மரியாதையுடன் கண்ணியம் காப்பவர்' },
  TRUSTWORTHY: { en: 'Honest and trustworthy', si: 'අවංක හා විශ්වාසවන්ත', ta: 'நேர்மையும் நம்பிக்கையும் உள்ளவர்' },
  GOOD_COOK: { en: 'Good with meals', si: 'ආහාර පිළියෙළ කිරීමට දක්ෂ', ta: 'உணவு தயாரிப்பில் சிறந்தவர்' },
  EXTRA_MILE: { en: 'Goes the extra mile', si: 'අමතර උත්සාහයක් ගනී', ta: 'கூடுதல் முயற்சி எடுப்பவர்' },
};

/** For the staff alert, which is English only. */
export const IMPROVEMENT_LABELS_EN: Record<ReviewImprovementTag, string> = {
  TIMEKEEPING: 'Timekeeping',
  COMMUNICATION: 'Communication',
  HYGIENE: 'Hygiene and cleanliness',
  CARE_QUALITY: 'Quality of care',
  ATTITUDE: 'Attitude',
  OTHER: 'Something else',
};

export interface ClientNotice {
  subject: string;
  heading: string;
  body: string;
  cta: string;
}

const ASK: Record<Lang, ClientNotice> = {
  en: {
    subject: 'How was your caregiver? (booking {ref})',
    heading: 'How was your caregiver?',
    body: 'Please rate the care you received on booking {ref}. It takes a minute: choose the stars and, if you like, say what they did well. It helps other families choose, and helps good caregivers get more work.',
    cta: 'Rate your caregiver',
  },
  si: {
    subject: 'ඔබේ රැකබලා ගන්නා කෙසේද? (වෙන්කිරීම {ref})',
    heading: 'ඔබේ රැකබලා ගන්නා කෙසේද?',
    body: 'කරුණාකර {ref} වෙන්කිරීමේදී ඔබට ලැබුණු රැකවරණය ශ්‍රේණිගත කරන්න. මිනිත්තුවක් පමණි: තරු තෝරා, ඔබ කැමති නම් ඔවුන් හොඳින් කළ දේ කියන්න. එය අනෙක් පවුල්වලට තෝරා ගැනීමට සහ හොඳ රැකබලා ගන්නන්ට වැඩි වැඩ ලබා ගැනීමට උපකාරී වේ.',
    cta: 'රැකබලා ගන්නා ශ්‍රේණිගත කරන්න',
  },
  ta: {
    subject: 'உங்கள் பராமரிப்பாளர் எப்படி? (முன்பதிவு {ref})',
    heading: 'உங்கள் பராமரிப்பாளர் எப்படி?',
    body: '{ref} முன்பதிவில் நீங்கள் பெற்ற பராமரிப்பை மதிப்பிடவும். ஒரு நிமிடம் போதும்: நட்சத்திரங்களைத் தேர்ந்தெடுத்து, விரும்பினால் அவர்கள் சிறப்பாகச் செய்ததைக் கூறுங்கள். இது மற்ற குடும்பங்கள் தேர்வு செய்யவும், நல்ல பராமரிப்பாளர்களுக்கு அதிக வேலை கிடைக்கவும் உதவுகிறது.',
    cta: 'பராமரிப்பாளரை மதிப்பிடவும்',
  },
};

const REMINDER: Record<Lang, ClientNotice> = {
  en: {
    subject: 'A minute to rate your caregiver? (booking {ref})',
    heading: 'Would you rate your caregiver?',
    body: 'You haven\'t rated the care on booking {ref} yet. Your rating helps other families, and we read every one. This is the only reminder we will send.',
    cta: 'Rate your caregiver',
  },
  si: {
    subject: 'ඔබේ රැකබලා ගන්නා ශ්‍රේණිගත කිරීමට මිනිත්තුවක්? (වෙන්කිරීම {ref})',
    heading: 'ඔබේ රැකබලා ගන්නා ශ්‍රේණිගත කරනවාද?',
    body: 'ඔබ තවම {ref} වෙන්කිරීමේ රැකවරණය ශ්‍රේණිගත කර නැත. ඔබේ ශ්‍රේණිගත කිරීම අනෙක් පවුල්වලට උපකාරී වන අතර අපි සෑම එකක්ම කියවමු. අප එවන එකම සිහිකැඳවීම මෙයයි.',
    cta: 'රැකබලා ගන්නා ශ්‍රේණිගත කරන්න',
  },
  ta: {
    subject: 'உங்கள் பராமரிப்பாளரை மதிப்பிட ஒரு நிமிடம்? (முன்பதிவு {ref})',
    heading: 'உங்கள் பராமரிப்பாளரை மதிப்பிடுவீர்களா?',
    body: '{ref} முன்பதிவின் பராமரிப்பை நீங்கள் இன்னும் மதிப்பிடவில்லை. உங்கள் மதிப்பீடு மற்ற குடும்பங்களுக்கு உதவும்; ஒவ்வொன்றையும் நாங்கள் படிக்கிறோம். இதுவே நாங்கள் அனுப்பும் ஒரே நினைவூட்டல்.',
    cta: 'பராமரிப்பாளரை மதிப்பிடவும்',
  },
};

const REJECTED: Record<Lang, ClientNotice> = {
  en: {
    subject: 'Your review on booking {ref} was not published',
    heading: 'Your written review was not published',
    body: 'Thank you for rating your caregiver - your stars and badges count. Our team did not publish the written part of your review: {reason} You can edit it and send it again from your bookings.',
    cta: 'Edit your review',
  },
  si: {
    subject: '{ref} වෙන්කිරීමේ ඔබේ සමාලෝචනය පළ නොකළා',
    heading: 'ඔබේ ලිඛිත සමාලෝචනය පළ නොකළා',
    body: 'ඔබේ රැකබලා ගන්නා ශ්‍රේණිගත කළාට ස්තූතියි - ඔබේ තරු සහ ලාංඡන ගණන් වේ. අපේ කණ්ඩායම ඔබේ සමාලෝචනයේ ලිඛිත කොටස පළ කළේ නැත: {reason} ඔබේ වෙන්කිරීම් වලින් එය සංස්කරණය කර නැවත එවිය හැක.',
    cta: 'සමාලෝචනය සංස්කරණය කරන්න',
  },
  ta: {
    subject: '{ref} முன்பதிவில் உங்கள் மதிப்புரை வெளியிடப்படவில்லை',
    heading: 'உங்கள் எழுத்து மதிப்புரை வெளியிடப்படவில்லை',
    body: 'உங்கள் பராமரிப்பாளரை மதிப்பிட்டதற்கு நன்றி - உங்கள் நட்சத்திரங்களும் பதக்கங்களும் கணக்கில் கொள்ளப்படும். உங்கள் மதிப்புரையின் எழுத்துப் பகுதியை எங்கள் குழு வெளியிடவில்லை: {reason} உங்கள் முன்பதிவுகளில் அதைத் திருத்தி மீண்டும் அனுப்பலாம்.',
    cta: 'மதிப்புரையைத் திருத்தவும்',
  },
};

export function reviewAskNotice(stage: 'ASK' | 'REMINDER', lang: Lang, ref: string): ClientNotice {
  const t = (stage === 'ASK' ? ASK : REMINDER)[lang] ?? ASK.en;
  const v = { ref };
  return { subject: fill(t.subject, v), heading: t.heading, body: fill(t.body, v), cta: t.cta };
}

export function reviewRejectedNotice(lang: Lang, ref: string, reason: string): ClientNotice {
  const t = REJECTED[lang] ?? REJECTED.en;
  const r = reason.trim().replace(/([^.!?])$/, '$1.');
  const v = { ref, reason: r };
  return { subject: fill(t.subject, v), heading: t.heading, body: fill(t.body, v), cta: t.cta };
}

const PRAISE: Record<Lang, { heading: string; body: string }> = {
  en: { heading: 'A client praised your care', body: 'A client gave you {stars} stars and said you are: {badges}. Well done - thank you for the care you give.' },
  si: { heading: 'සේවාදායකයෙක් ඔබේ රැකවරණයට ප්‍රශංසා කළා', body: 'සේවාදායකයෙක් ඔබට තරු {stars}ක් ලබා දී ඔබ ගැන කීවේ: {badges}. ඉතා හොඳයි - ඔබ දෙන රැකවරණයට ස්තූතියි.' },
  ta: { heading: 'ஒரு வாடிக்கையாளர் உங்கள் பராமரிப்பைப் பாராட்டினார்', body: 'ஒரு வாடிக்கையாளர் உங்களுக்கு {stars} நட்சத்திரங்கள் வழங்கி, நீங்கள்: {badges} என்று கூறினார். சிறப்பு - நீங்கள் வழங்கும் பராமரிப்புக்கு நன்றி.' },
};

/** To the caregiver, in all three languages (caregiver notices are), for 4-5 stars with badges. */
export function praiseNotice(stars: number, badges: readonly ReviewBadge[]) {
  const blocks = LANGS.map((lang) => {
    const t = PRAISE[lang];
    const v = { stars: String(stars), badges: badges.map((b) => BADGE_LABELS[b][lang]).join(', ') };
    return { lang, heading: t.heading, body: fill(t.body, v) };
  });
  return {
    subject: PRAISE.en.heading,
    blocks: blocks.map((b) => ({ lang: b.lang, heading: b.heading, paragraphs: [b.body] })),
    pushBlocks: blocks,
    whatsappText: blocks.map((b) => `${b.heading}. ${b.body}`).join('\n\n'),
  };
}
