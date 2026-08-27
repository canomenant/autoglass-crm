/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  // src/lib faltaba, y ahi viven las paletas de estado (quoteStatusColors, workOrderStatusColors):
  // una clase que solo aparezca en esos archivos se purgaba del CSS. Lo que la tapaba es que casi
  // todas coincidian por casualidad con alguna usada en app/ o components/ -bg-gray-100, bg-red-100-
  // asi que las que no coincidian salian sin fondo y parecia un problema de color, no de build.
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx}",
    "./src/components/**/*.{js,ts,jsx,tsx}",
    "./src/lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        fadeIn: "fadeIn 0.2s ease-out",
      },
    },
  },
  plugins: [],
};
