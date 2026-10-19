/** @type {import('tailwindcss').Config} */
// NOTE: this file is duplicated verbatim in apps/web (the staff portal).
// Change both together, or the two apps drift apart visually.
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      // White-label palette. The brand, accent, page and hairline colours are
      // CSS variables set from Settings > Branding (see `paletteCss` in
      // packages/shared branding.ts and the root layout), held as bare "R G B"
      // channels so opacity modifiers such as `border-brand/30` keep working.
      //
      // The fallbacks below - and the values an untouched deployment gets - are
      // the CareLink palette drawn from the reference site (caregivers.lk): a
      // muted olive primary and a teal secondary, darkened from the site's own
      // hexes (#757E6A / #65ABB4, which fail WCAG AA as text) to accessible
      // points. Settings > Branding refuses colours that fail AA with white text.
      colors: {
        paper: 'rgb(var(--color-paper, 246 248 242) / <alpha-value>)', // #F6F8F2, 9.89:1 with ink
        ink: '#374046', //    10.58:1 on white
        border: 'rgb(var(--color-border, 220 224 214) / <alpha-value>)', // #DCE0D6, decorative hairline
        brand: {
          DEFAULT: 'rgb(var(--color-brand, 95 105 82) / <alpha-value>)', // #5F6952 olive, 5.79:1 with white text
          dark: 'rgb(var(--color-brand-dark, 79 87 69) / <alpha-value>)', // #4F5745, 7.55:1
          light: 'rgb(var(--color-brand-light, 228 232 222) / <alpha-value>)', // #E4E8DE, tint behind brand content
        },
        accent: {
          DEFAULT: 'rgb(var(--color-accent, 47 122 132) / <alpha-value>)', // #2F7A84 teal, 4.96:1 with white text
          dark: 'rgb(var(--color-accent-dark, 42 107 116) / <alpha-value>)', // #2A6B74, 6.08:1
          light: 'rgb(var(--color-accent-light, 220 232 234) / <alpha-value>)', // #DCE8EA, tint behind accent content
        },
        danger: {
          DEFAULT: '#A6402F', // 6.18:1 with white text
          light: '#F3DDD8',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        sinhala: ['var(--font-noto-si)', 'sans-serif'],
        tamil: ['var(--font-noto-ta)', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '6px',
        lg: '10px',
      },
      // Focus rings are used on every interactive control across both apps, so
      // they take the brand colour unless a component overrides them.
      ringColor: {
        DEFAULT: 'rgb(var(--color-brand, 95 105 82) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
