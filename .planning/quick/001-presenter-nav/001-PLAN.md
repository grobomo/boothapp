# Presenter Navigation Bar Component

## Goal
Create a reusable nav bar component (`presenter/components/nav.js`) that injects a consistent navigation bar into all presenter pages via a single `<script>` include.

## Success Criteria
1. nav.js creates and injects a nav bar at the top of every page that includes it
2. Logo text "BoothApp" on the left
3. Links: Home (/), Sessions (/sessions.html), Analytics (/analytics.html), Live Monitor (/live-dashboard.html), Admin (/admin.html)
4. Active page highlighting based on current URL pathname
5. Hamburger menu for mobile (< 768px)
6. System health dot (green/red) polling /api/health every 10s
7. Dark theme with glassmorphism effect (backdrop-filter blur + semi-transparent bg)
8. All presenter HTML pages include `<script src="components/nav.js"></script>`
