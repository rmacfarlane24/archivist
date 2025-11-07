/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/index.html",
    "./app/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        midnight: {
          600: '#0f172a', // slate-900-ish
          500: '#111827',
          400: '#1f2937'
        },
        // Custom light/dark mode palette
        'custom-black': '#0A0A0A',     // RGB(10,10,10) - for text in light mode
        'custom-gray': '#282828',      // RGB(40,40,40) - for page background and accents
        'custom-white': '#fafafa',     // RGB(250,250,250) - for backgrounds in light mode
      }
    },
  },
  plugins: [],
} 