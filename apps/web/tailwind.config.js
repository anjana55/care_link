/** @type {import('tailwindcss').Config} */
// NOTE: this file is duplicated verbatim in apps/web (the staff portal).
// Change both together, or the two apps drift apart visually.
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      // Palette drawn from the CareLink reference site (caregivers.lk), whose
      // identity is a muted olive primary with a teal secondary. The exact hexes
      // it uses (#757E6A / #65ABB4) fail WCAG AA as text - 3.97:1 and 2.44:1
      // against the pale page background, and white-on-teal is 2.61:1 - so the
      // same hue families are kept but darkened to accessible points. Every
      // value below is contrast-checked; see the table in the design notes.
      colors: {
        paper: '#F6F8F2', //   9.89:1 with ink
        ink: '#374046', //    10.58:1 on white
        border: '#DCE0D6', // decorative hairline, 1.34:1 on white
        brand: {
          DEFAULT: '#5F6952', // olive, 5.79:1 with white text
          dark: '#4F5745', // 7.55:1
          light: '#E4E8DE', // tint behind brand content
        },
        accent: {
          DEFAULT: '#2F7A84', // teal, 4.96:1 with white text
          dark: '#2A6B74', // 6.08:1
          light: '#DCE8EA', // tint behind accent content
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
        DEFAULT: '#5F6952',
      },
    },
  },
  plugins: [],
};
