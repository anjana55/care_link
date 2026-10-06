import { CATALOGUE_TEMPLATES, translateMessage, translateMessages } from './messages';

describe('translateMessage', () => {
  it('returns English untouched', () => {
    expect(translateMessage('Invalid credentials', 'en')).toBe('Invalid credentials');
  });

  it('translates a known message', () => {
    expect(translateMessage('Invalid credentials', 'si')).toBe('පිවිසුම් අක්තපත්‍ර වලංගු නැත');
    expect(translateMessage('Invalid credentials', 'ta')).toBe('உள்நுழைவுச் சான்றுகள் தவறானவை');
  });

  it('falls back to the English text when there is no translation', () => {
    expect(translateMessage('A message nobody has translated', 'si')).toBe('A message nobody has translated');
  });

  it('carries the variable part of a message into the translation', () => {
    expect(translateMessage('Please wait 12 seconds before requesting another code', 'si')).toContain('12');
    expect(translateMessage('Please wait 12 seconds before requesting another code', 'ta')).toContain('12');
    expect(translateMessage('Cannot transition caregiver from DRAFT to VERIFIED. Allowed next states: REGISTERED', 'si')).toMatch(/DRAFT.*VERIFIED.*REGISTERED/);
    expect(translateMessage('You can keep at most 20 documents. Remove one first.', 'ta')).toContain('20');
  });

  it('still translates when the variable part is empty or has punctuation', () => {
    expect(translateMessage('Cannot change status from NEW to DONE. Allowed: none', 'si')).toContain('none');
    expect(translateMessage('Cannot change status from A to B. Allowed: x, y', 'si')).toContain('x, y');
  });

  it('translates field names in validation messages where it knows them', () => {
    expect(translateMessage('Full name must be text', 'si')).toBe('සම්පූර්ණ නම පෙළක් විය යුතුය');
    expect(translateMessage('Notes must be 2000 characters or fewer', 'ta')).toBe('குறிப்புகள் 2000 எழுத்துகளுக்கு மிகாமல் இருக்க வேண்டும்');
    // An unknown field name is kept as written rather than dropped.
    expect(translateMessage('Mystery field must be text', 'si')).toBe('Mystery field පෙළක් විය යුතුය');
  });

  it('translates class-validator\'s own wording, leaving the property name as sent', () => {
    expect(translateMessage('email must be an email', 'si')).toBe('email වලංගු විද්‍යුත් ලිපිනයක් විය යුතුය');
    expect(translateMessage('password must be longer than or equal to 8 characters', 'ta')).toBe('password குறைந்தது 8 எழுத்துகள் இருக்க வேண்டும்');
    expect(translateMessage('purpose must be one of the following values: REGISTER, LOGIN', 'si')).toContain('REGISTER, LOGIN');
  });

  it('prefers the more specific template when two could match', () => {
    // "must be a number string" must not be read as "{label} must be a number".
    expect(translateMessage('phone must be a number string', 'si')).toBe('phone ඉලක්කම් පමණක් අඩංගු පෙළක් විය යුතුය');
    expect(translateMessage('District id must be a number', 'si')).toBe('දිස්ත්‍රික්ක හැඳුනුම ඉලක්කමක් විය යුතුය');
  });

  it('does not treat a longer message that merely contains a known one as that message', () => {
    expect(translateMessage('Prefix: Invalid credentials', 'si')).toBe('Prefix: Invalid credentials');
  });
});

describe('translateMessages', () => {
  it('translates each entry of a validation error list and leaves non-strings alone', () => {
    expect(translateMessages(['email must be an email', 'Enter a valid email address'], 'si')).toEqual([
      'email වලංගු විද්‍යුත් ලිපිනයක් විය යුතුය',
      'වලංගු විද්‍යුත් ලිපිනයක් ඇතුළත් කරන්න',
    ]);
    expect(translateMessages({ a: 1 }, 'si')).toEqual({ a: 1 });
    expect(translateMessages(undefined, 'si')).toBeUndefined();
  });
});

describe('the catalogue', () => {
  it('has a distinct Sinhala and Tamil text for every message', () => {
    for (const template of CATALOGUE_TEMPLATES) {
      const sample = template.replace(/\{\w+\}/g, (m) => (m === '{label}' ? 'Full name' : '7'));
      const si = translateMessage(sample, 'si');
      const ta = translateMessage(sample, 'ta');
      expect({ template, translated: si !== sample }).toEqual({ template, translated: true });
      expect({ template, translated: ta !== sample }).toEqual({ template, translated: true });
      expect({ template, same: si === ta }).toEqual({ template, same: false });
    }
  });

  it('keeps every placeholder of the English text in both translations', () => {
    for (const template of CATALOGUE_TEMPLATES) {
      const placeholders = template.match(/\{\w+\}/g) ?? [];
      const sample = template.replace(/\{\w+\}/g, (m) => `<<${m.slice(1, -1)}>>`).replace('<<label>>', 'Full name');
      for (const lang of ['si', 'ta'] as const) {
        const out = translateMessage(sample, lang);
        for (const p of placeholders) {
          if (p === '{label}') continue; // replaced by the translated field name
          expect({ template, lang, kept: out.includes(`<<${p.slice(1, -1)}>>`) }).toEqual({ template, lang, kept: true });
        }
      }
    }
  });
});
