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
          bg: 'lightblue',
          card: '#e0f7fa',
          border: '#b2ebf2',
          accent: 'lightblue',
          emerald: '#10B981',
          rose: '#EF4444',
          amber: '#F59E0B'
        }
      }
    },
  },
  plugins: [],
};
