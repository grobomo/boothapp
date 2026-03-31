# WebSocket Real-Time Update System

## Goal
Add WebSocket-based real-time updates to BoothApp so presenter pages receive instant session events instead of polling.

## Success Criteria
1. `infra/ws-server.js` exists and starts a WebSocket server on port 3001 using `ws` package
2. Server broadcasts events: `session.started`, `session.ended`, `analysis.completed`
3. Heartbeat ping/pong every 30s with dead client cleanup
4. `infra/ws-client.js` browser utility with auto-reconnect for presenter pages
5. Watcher integration: `analysis/watcher.js` sends events to WS server on session changes
6. All connected clients receive broadcast events
7. Tests pass for server and client functionality

## Implementation
1. Add `ws` dependency to root package.json
2. Create `infra/ws-server.js` - standalone WS server with broadcast + heartbeat
3. Create `infra/ws-client.js` - browser-side auto-reconnecting client
4. Create `analysis/watcher.js` - watcher that detects session changes and notifies WS
5. Add tests
