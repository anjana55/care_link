import type { CareRequestLanguage } from '../database/schema';

/**
 * What booking notices say, in English, Sinhala and Tamil. Like the request
 * notices they carry only the booking reference and a start date - no names,
 * numbers or addresses; staff share those on the phone. Sinhala and Tamil are
 * machine-drafted and want a native speaker's review.
 */
type Lang = CareRequestLanguage;
type Notice = 'CONFIRMED' | 'CANCELLED' | 'CHANGED';

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);

const CLIENT: Record<Notice, Record<Lang, { subject: string; heading: string; body: string }>> = {
  CONFIRMED: {
    en: {
      subject: 'Your booking {ref} is confirmed',
      heading: 'Your booking is confirmed',
      body: 'Booking {ref} is confirmed and care starts on {date}. You can see every scheduled shift in your {brand} account.',
    },
    si: {
      subject: 'ඔබගේ වෙන්කිරීම {ref} තහවුරු කර ඇත',
      heading: 'ඔබගේ වෙන්කිරීම තහවුරු කර ඇත',
      body: 'වෙන්කිරීම {ref} තහවුරු කර ඇති අතර රැකවරණය {date} දින ආරම්භ වේ. සැලසුම් කළ සෑම වාරයක්ම ඔබගේ {brand} ගිණුමෙන් බලන්න.',
    },
    ta: {
      subject: 'உங்கள் முன்பதிவு {ref} உறுதிசெய்யப்பட்டது',
      heading: 'உங்கள் முன்பதிவு உறுதிசெய்யப்பட்டது',
      body: 'முன்பதிவு {ref} உறுதிசெய்யப்பட்டது; பராமரிப்பு {date} அன்று தொடங்கும். திட்டமிடப்பட்ட ஒவ்வொரு பணிநேரத்தையும் உங்கள் {brand} கணக்கில் பார்க்கலாம்.',
    },
  },
  CANCELLED: {
    en: {
      subject: 'Your booking {ref} has been cancelled',
      heading: 'Your booking has been cancelled',
      body: 'Booking {ref} has been cancelled and its remaining shifts will not go ahead. Our team will contact you about what happens next.',
    },
    si: {
      subject: 'ඔබගේ වෙන්කිරීම {ref} අවලංගු කර ඇත',
      heading: 'ඔබගේ වෙන්කිරීම අවලංගු කර ඇත',
      body: 'වෙන්කිරීම {ref} අවලංගු කර ඇති අතර එහි ඉතිරි වාර සිදු නොවේ. ඊළඟට කුමක් සිදුවේද යන්න ගැන අපගේ කණ්ඩායම ඔබව සම්බන්ධ කර ගනු ඇත.',
    },
    ta: {
      subject: 'உங்கள் முன்பதிவு {ref} ரத்து செய்யப்பட்டது',
      heading: 'உங்கள் முன்பதிவு ரத்து செய்யப்பட்டது',
      body: 'முன்பதிவு {ref} ரத்து செய்யப்பட்டது; மீதமுள்ள பணிநேரங்கள் நடைபெறாது. அடுத்து என்ன என்பது பற்றி எங்கள் குழு உங்களைத் தொடர்புகொள்ளும்.',
    },
  },
  // A confirmed booking's schedule or caregiver changed from {date} on.
  CHANGED: {
  en: {
    subject: 'Your booking {ref} has changed',
    heading: 'Your booking has changed',
    body: 'The shifts for booking {ref} have changed from {date}. You can see the updated shifts in your {brand} account.',
  },
  si: {
    subject: 'ඔබගේ වෙන්කිරීම {ref} වෙනස් කර ඇත',
    heading: 'ඔබගේ වෙන්කිරීම වෙනස් කර ඇත',
    body: 'වෙන්කිරීම {ref} හි වාර {date} සිට වෙනස් කර ඇත. යාවත්කාලීන වාර ඔබගේ {brand} ගිණුමෙන් බලන්න.',
  },
  ta: {
    subject: 'உங்கள் முன்பதிவு {ref} மாற்றப்பட்டது',
    heading: 'உங்கள் முன்பதிவு மாற்றப்பட்டது',
    body: 'முன்பதிவு {ref} இன் பணிநேரங்கள் {date} முதல் மாற்றப்பட்டுள்ளன. புதுப்பிக்கப்பட்ட பணிநேரங்களை உங்கள் {brand} கணக்கில் பார்க்கலாம்.',
  },
  },
};

const CAREGIVER: Record<Notice, Record<Lang, { heading: string; body: string }>> = {
  CONFIRMED: {
    en: { heading: 'You have a confirmed booking', body: 'Booking {ref} is confirmed, starting on {date}. Your shifts are in your {brand} account.' },
    si: { heading: 'ඔබට තහවුරු කළ වෙන්කිරීමක් ඇත', body: 'වෙන්කිරීම {ref} තහවුරු කර ඇත, {date} දින ආරම්භ වේ. ඔබගේ වාර ඔබගේ {brand} ගිණුමේ ඇත.' },
    ta: { heading: 'உங்களுக்கு உறுதிசெய்யப்பட்ட முன்பதிவு உள்ளது', body: 'முன்பதிவு {ref} உறுதிசெய்யப்பட்டது, {date} அன்று தொடங்குகிறது. உங்கள் பணிநேரங்கள் உங்கள் {brand} கணக்கில் உள்ளன.' },
  },
  CANCELLED: {
    en: { heading: 'A booking has been cancelled', body: 'Booking {ref} has been cancelled and your remaining shifts for it are cancelled too.' },
    si: { heading: 'වෙන්කිරීමක් අවලංගු කර ඇත', body: 'වෙන්කිරීම {ref} අවලංගු කර ඇති අතර ඒ සඳහා ඔබගේ ඉතිරි වාරද අවලංගු කර ඇත.' },
    ta: { heading: 'ஒரு முன்பதிவு ரத்து செய்யப்பட்டது', body: 'முன்பதிவு {ref} ரத்து செய்யப்பட்டது; அதற்கான உங்கள் மீதமுள்ள பணிநேரங்களும் ரத்து செய்யப்பட்டன.' },
  },
  CHANGED: {
    en: { heading: 'A booking has changed', body: 'Your shifts for booking {ref} have changed from {date}. Check your updated shifts in your {brand} account.' },
    si: { heading: 'වෙන්කිරීමක් වෙනස් කර ඇත', body: 'වෙන්කිරීම {ref} සඳහා ඔබගේ වාර {date} සිට වෙනස් කර ඇත. යාවත්කාලීන වාර ඔබගේ {brand} ගිණුමෙන් බලන්න.' },
    ta: { heading: 'ஒரு முன்பதிவு மாற்றப்பட்டது', body: 'முன்பதிவு {ref} க்கான உங்கள் பணிநேரங்கள் {date} முதல் மாற்றப்பட்டுள்ளன. புதுப்பிக்கப்பட்ட பணிநேரங்களை உங்கள் {brand} கணக்கில் பார்க்கவும்.' },
  },
};

export function bookingClientNotice(notice: Notice, lang: Lang, vars: { ref: string; date: string }) {
  const t = CLIENT[notice][lang] ?? CLIENT[notice].en;
  return { subject: fill(t.subject, vars), heading: fill(t.heading, vars), body: fill(t.body, vars) };
}

export function bookingCaregiverNotice(notice: Notice, vars: { ref: string; date: string }) {
  const blocks = (['en', 'si', 'ta'] as const).map((lang) => ({
    lang,
    heading: fill(CAREGIVER[notice][lang].heading, vars),
    body: fill(CAREGIVER[notice][lang].body, vars),
  }));
  return { subject: `{brand} - ${blocks[0].heading} (${vars.ref})`, blocks, whatsappText: blocks.map((b) => b.body).join(' / ') };
}
