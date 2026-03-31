/**
 * ws-client.js -- Auto-reconnecting WebSocket client for presenter pages.
 *
 * Usage (browser):
 *   <script src="/ws-client.js"></script>
 *   <script>
 *     const client = new BoothAppWS('ws://localhost:3001');
 *     client.on('session.started', (data) => { console.log('New session:', data); });
 *     client.on('analysis.completed', (data) => { console.log('Analysis done:', data); });
 *   </script>
 *
 * Usage (Node.js):
 *   const { BoothAppWS } = require('./ws-client');
 *   const client = new BoothAppWS('ws://localhost:3001');
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    // Node.js / CommonJS
    const WebSocket = require('ws');
    module.exports = { BoothAppWS: factory(WebSocket) };
  } else {
    // Browser global
    root.BoothAppWS = factory(root.WebSocket);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (WebSocket) {

  var DEFAULT_RECONNECT_MS = 2000;
  var MAX_RECONNECT_MS = 30000;

  function BoothAppWS(url, options) {
    options = options || {};
    this._url = url;
    this._handlers = {};
    this._reconnectMs = options.reconnectMs || DEFAULT_RECONNECT_MS;
    this._maxReconnectMs = options.maxReconnectMs || MAX_RECONNECT_MS;
    this._currentDelay = this._reconnectMs;
    this._closed = false;
    this._ws = null;
    this._connect();
  }

  BoothAppWS.prototype._connect = function () {
    var self = this;
    if (self._closed) return;

    try {
      self._ws = new WebSocket(self._url);
    } catch (err) {
      self._scheduleReconnect();
      return;
    }

    self._ws.onopen = function () {
      self._currentDelay = self._reconnectMs; // reset backoff
      self._emit('_open', {});
    };

    self._ws.onclose = function () {
      self._emit('_close', {});
      self._scheduleReconnect();
    };

    self._ws.onerror = function () {
      // onclose will fire after onerror, triggering reconnect
    };

    self._ws.onmessage = function (event) {
      try {
        var msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
        if (msg.type) {
          self._emit(msg.type, msg.data || {}, msg.timestamp);
        }
      } catch (e) {
        // Ignore non-JSON messages
      }
    };
  };

  BoothAppWS.prototype._scheduleReconnect = function () {
    var self = this;
    if (self._closed) return;

    setTimeout(function () {
      self._connect();
    }, self._currentDelay);

    // Exponential backoff with cap
    self._currentDelay = Math.min(self._currentDelay * 1.5, self._maxReconnectMs);
  };

  /**
   * Register an event handler.
   * @param {string} eventType - e.g. 'session.started', 'analysis.completed', '_open', '_close'
   * @param {function} handler - called with (data, timestamp)
   */
  BoothAppWS.prototype.on = function (eventType, handler) {
    if (!this._handlers[eventType]) {
      this._handlers[eventType] = [];
    }
    this._handlers[eventType].push(handler);
    return this;
  };

  /**
   * Remove an event handler.
   */
  BoothAppWS.prototype.off = function (eventType, handler) {
    var list = this._handlers[eventType];
    if (!list) return this;
    this._handlers[eventType] = list.filter(function (h) { return h !== handler; });
    return this;
  };

  BoothAppWS.prototype._emit = function (eventType, data, timestamp) {
    var list = this._handlers[eventType];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](data, timestamp); } catch (e) { /* handler error */ }
    }
  };

  /**
   * Send a message to the server (e.g. watcher publishing events).
   */
  BoothAppWS.prototype.send = function (type, data) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ type: type, data: data || {} }));
    }
  };

  /**
   * Permanently close the connection (no reconnect).
   */
  BoothAppWS.prototype.close = function () {
    this._closed = true;
    if (this._ws) {
      this._ws.close();
    }
  };

  return BoothAppWS;
});
