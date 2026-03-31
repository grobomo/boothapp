# Error Boundary for Presenter Pages

## Goal
Prevent blank screens during demo by catching all JS errors, showing user-friendly fallback UI, and logging errors to an API endpoint. Add subtle error indicator in the nav bar.

## Success Criteria
- [ ] Global error handler (window.onerror + unhandledrejection) catches all uncaught errors
- [ ] User-friendly error overlay with Retry and Report Bug buttons instead of blank screen
- [ ] Errors POST to /api/errors with error details, page URL, timestamp
- [ ] Nav bar shows subtle error indicator when errors have been logged
- [ ] All presenter HTML pages include the error-boundary.js component
- [ ] Server has /api/errors POST endpoint

## Files
1. `presenter/components/error-boundary.js` - client-side error handler + overlay UI
2. `presenter/server.js` - add POST /api/errors endpoint
3. `presenter/components/nav.js` - add error indicator dot
4. All `presenter/*.html` - add `<script src="components/error-boundary.js"></script>`
