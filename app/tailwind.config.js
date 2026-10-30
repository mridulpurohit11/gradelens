/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        subtle: v('subtle'),
        line: v('line'),
        ink: v('ink'),
        muted: v('muted'),
        primary: { DEFAULT: v('primary'), hover: v('primary-hover'), tint: v('primary-tint'), on: v('on-primary') },
        accent: v('accent'),
        success: { DEFAULT: v('success'), tint: v('success-tint') },
        warning: { DEFAULT: v('warning'), tint: v('warning-tint') },
        danger: { DEFAULT: v('danger'), tint: v('danger-tint') },
        info: { DEFAULT: v('info'), tint: v('info-tint') },
      },
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'] },
      fontSize: {
        stat: ['28px', { lineHeight: '34px', fontWeight: '600', letterSpacing: '-0.01em' }],
        h1: ['24px', { lineHeight: '32px', fontWeight: '600', letterSpacing: '-0.01em' }],
        h2: ['20px', { lineHeight: '28px', fontWeight: '600', letterSpacing: '-0.005em' }],
        h3: ['16px', { lineHeight: '24px', fontWeight: '600' }],
        body: ['14px', { lineHeight: '20px' }],
        small: ['13px', { lineHeight: '18px' }],
        caption: ['12px', { lineHeight: '16px', letterSpacing: '0.01em' }],
      },
      borderRadius: { card: '12px', ctl: '8px' },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.06)',
        pop: '0 4px 12px rgba(0,0,0,0.08)',
        modal: '0 8px 24px rgba(0,0,0,0.12)',
      },
      maxWidth: { content: '1200px' },
    },
  },
  plugins: [],
};
