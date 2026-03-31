# Presenter Server - CORS & Security

## Goal
Add an Express server to presenter/ with CORS, security headers, rate limiting, request logging, and a health endpoint.

## Success Criteria
1. CORS allows boothapp.trendcyberrange.com, localhost, chrome-extension:// origins
2. helmet.js adds security headers
3. Rate limiting at 100 req/min per IP
4. Request logging with timestamp, method, path, status, response time
5. GET /api/health returns {status: "ok", uptime, sessions_count, version}
6. Static files in presenter/ are served
7. All dependencies in presenter/package.json

## Tasks
- [ ] Create presenter/package.json with express, cors, helmet, express-rate-limit
- [ ] Create presenter/server.js with all middleware and health endpoint
- [ ] Test the server starts and health endpoint works
