# i18n Multi-Language Support

## Goal
Add English/Japanese language support to the BoothApp presenter UI for Trend Micro Japan colleagues.

## Success Criteria
1. Translation JSON files for `en` and `ja` at `infra/i18n/`
2. Translator function at `infra/i18n/translations.js` with key lookup
3. Language switcher dropdown with flag icons in presenter nav (demo.html, sessions.html)
4. Selected language persisted in localStorage
5. Key UI strings translated: page titles, button labels, status messages, table headers
6. Simple object lookup -- no heavy framework dependency
