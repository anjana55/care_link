import type { CareRequestLanguage } from '../database/schema';

/**
 * The evening care-plan reminder, in English, Sinhala and Tamil. Like the
 * booking notices it carries no names or health details - only a count, and
 * a link to the account. Sinhala and Tamil are machine-drafted and want a
 * native speaker's review.
 */
type Lang = CareRequestLanguage;

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);

const REMINDER: Record<Lang, { subject: string; heading: string; body: string; cta: string }> = {
  en: {
    subject: '{count} care activities to review today',
    heading: 'Please review today\'s care',
    body: '{count} activities from today\'s care plan are not marked yet. Mark each one Done or Not done in your {brand} account before midnight - anything left unmarked is counted as done.',
    cta: 'Review today\'s care',
  },
  si: {
    subject: 'අද සමාලෝචනය කිරීමට රැකවරණ ක්‍රියාකාරකම් {count}ක්',
    heading: 'කරුණාකර අද රැකවරණය සමාලෝචනය කරන්න',
    body: 'අද රැකවරණ සැලැස්මේ ක්‍රියාකාරකම් {count}ක් තවම සලකුණු කර නැත. මධ්‍යම රාත්‍රියට පෙර ඔබගේ {brand} ගිණුමෙන් එක් එක් ක්‍රියාකාරකම "කළා" හෝ "නොකළා" ලෙස සලකුණු කරන්න - සලකුණු නොකළ ඒවා කළා ලෙස සැලකේ.',
    cta: 'අද රැකවරණය සමාලෝචනය කරන්න',
  },
  ta: {
    subject: 'இன்று சரிபார்க்க {count} பராமரிப்புச் செயல்கள்',
    heading: 'இன்றைய பராமரிப்பைச் சரிபார்க்கவும்',
    body: 'இன்றைய பராமரிப்புத் திட்டத்தில் {count} செயல்கள் இன்னும் குறிக்கப்படவில்லை. நள்ளிரவுக்கு முன் உங்கள் {brand} கணக்கில் ஒவ்வொன்றையும் "செய்யப்பட்டது" அல்லது "செய்யப்படவில்லை" எனக் குறிக்கவும் - குறிக்காதவை செய்யப்பட்டதாகக் கணக்கிடப்படும்.',
    cta: 'இன்றைய பராமரிப்பைச் சரிபார்க்கவும்',
  },
};

export function careReminderNotice(lang: Lang, count: number) {
  const t = REMINDER[lang] ?? REMINDER.en;
  const vars = { count: String(count) };
  return { subject: fill(t.subject, vars), heading: t.heading, body: fill(t.body, vars), cta: t.cta };
}
