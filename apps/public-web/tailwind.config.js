/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        paper: '#FBF9F4',
        ink: '#1F2A24',
        border: '#E4DFD3',
        brand: {
          DEFAULT: '#2F6B5E',
          dark: '#225046',
          light: '#DCEAE6',
        },
        accent: {
          DEFAULT: '#C68A2E',
          light: '#F5E7CB',
        },
        danger: {
          DEFAULT: '#A6402F',
          light: '#F3DAD5',
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
    },
  },
  plugins: [],
};
