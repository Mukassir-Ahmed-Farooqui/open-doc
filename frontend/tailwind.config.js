/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#185FA5',
          light: '#E6F1FB',
          border: '#B5D4F4',
        }
      }
    },
  },
  plugins: [],
}
