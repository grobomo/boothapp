# Dark/Light Mode Toggle

## Goal
Add a dark/light mode toggle to all presenter pages (demo.html, sessions.html). Store preference in localStorage. Default to dark mode.

## Success Criteria
1. Toggle button visible in top-right corner of both pages
2. Clicking toggle switches between dark and light themes
3. Preference persists across page reloads via localStorage
4. CSS custom properties (--bg, --text, --surface, --border, etc.) drive theming
5. Default is dark mode when no preference stored
6. Light mode is visually clean and readable
7. No flash of wrong theme on page load (preference applied before render)

## Approach
- Add `[data-theme="light"]` CSS rules overriding :root custom properties
- Create shared `theme-toggle.js` inline snippet (included in both pages)
- Toggle button: sun/moon SVG icon, positioned fixed top-right
- localStorage key: `boothapp-theme`
