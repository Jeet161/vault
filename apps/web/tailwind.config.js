/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        vault: {
          bg:      '#080C1C',   // deep navy
          card:    '#0D1530',   // dark blue card
          border:  '#1E2D5A',   // blue-tinted border
          accent:  '#3B82F6',   // bright blue
          emerald: '#10B981',
          rose:    '#EF4444',
          amber:   '#F59E0B',
        }
      }
    },
  },
  plugins: [],
};
