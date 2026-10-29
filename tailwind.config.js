/** @type {import('tailwindcss').Config} */
// Los colores apuntan a variables CSS: el tema claro/oscuro se cambia en :root (src/tailwind.css).
module.exports = {
  content: ['./*.html', './app.js', './stock.js', './cloud.js'],
  corePlugins: { preflight: false }, // la app trae su propio reset; así no cambia el aspecto de los controles
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', panel: 'var(--panel)', wash: 'var(--wash)', ink: 'var(--ink)', muted: 'var(--muted)',
        line: 'var(--line)', accent: 'var(--accent)', 'accent-ink': 'var(--accent-ink)', danger: 'var(--danger)', good: 'var(--good)'
      },
      fontFamily: { display: 'var(--display)', body: 'var(--body)', mono: 'var(--mono)' },
      screens: { md: '900px' }
    }
  }
};
