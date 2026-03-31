/**
 * gallery.js -- Demo Results Gallery logic
 * Fetches sessions.json manifest from S3, renders session cards,
 * and auto-refreshes every 30 seconds.
 */
(function (window) {
  'use strict';

  var REFRESH_INTERVAL = 30000;
  var refreshTimer = null;
  var currentConfig = null;

  function formatDate(dateStr) {
    if (!dateStr) return '--';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() +
      ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function scoreColor(score) {
    if (score == null) return '#8b949e';
    var n = typeof score === 'string' ? parseFloat(score) : score;
    if (n >= 70) return '#3fb950';
    if (n >= 40) return '#d29922';
    return '#f85149';
  }

  function buildCard(session) {
    var card = document.createElement('div');
    card.className = 'gallery-card';

    var name = session.visitor_name || session.visitorName || session.name || 'Unknown Visitor';
    var date = session.date || session.created_at || session.timestamp || '';
    var score = session.engagement_score != null ? session.engagement_score :
                (session.engagementScore != null ? session.engagementScore : null);
    var products = session.product_count != null ? session.product_count :
                   (session.productCount != null ? session.productCount :
                   (session.products_demonstrated != null ? session.products_demonstrated : '--'));
    var sessionId = session.session_id || session.sessionId || session.id || '';
    var reportUrl = session.report_url || session.reportUrl || '';

    var scoreVal = score != null ? Math.round(score) : '--';
    var sColor = scoreColor(score);

    card.innerHTML =
      '<div class="card-header">' +
        '<span class="card-name">' + escapeHtml(name) + '</span>' +
        '<span class="card-id">' + escapeHtml(sessionId) + '</span>' +
      '</div>' +
      '<div class="card-date">' + escapeHtml(formatDate(date)) + '</div>' +
      '<div class="card-metrics">' +
        '<div class="metric">' +
          '<span class="metric-value" style="color:' + sColor + '">' + scoreVal + '</span>' +
          '<span class="metric-label">Engagement</span>' +
        '</div>' +
        '<div class="metric">' +
          '<span class="metric-value">' + escapeHtml(String(products)) + '</span>' +
          '<span class="metric-label">Products</span>' +
        '</div>' +
      '</div>' +
      '<div class="card-footer">' +
        '<span class="card-status">Completed</span>' +
        '<span class="card-arrow">&#8594;</span>' +
      '</div>';

    card.addEventListener('click', function () {
      if (reportUrl) {
        window.open(reportUrl, '_blank');
      } else if (sessionId && currentConfig && currentConfig.baseUrl) {
        var url = currentConfig.baseUrl.replace(/\/$/, '') + '/' + sessionId + '/report.html';
        window.open(url, '_blank');
      }
    });

    return card;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function renderSessions(sessions, container) {
    container.innerHTML = '';

    if (!sessions || sessions.length === 0) {
      container.innerHTML =
        '<div class="gallery-empty">' +
          '<div class="empty-icon">[ ]</div>' +
          '<div class="empty-text">No completed sessions found</div>' +
          '<div class="empty-hint">Sessions will appear here once analysis is complete</div>' +
        '</div>';
      return;
    }

    // Sort by date descending
    sessions.sort(function (a, b) {
      var da = new Date(a.date || a.created_at || a.timestamp || 0);
      var db = new Date(b.date || b.created_at || b.timestamp || 0);
      return db - da;
    });

    var grid = document.createElement('div');
    grid.className = 'gallery-grid';

    sessions.forEach(function (session) {
      grid.appendChild(buildCard(session));
    });

    container.appendChild(grid);
  }

  function fetchSessions(manifestUrl, container, countEl, lastUpdateEl) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', manifestUrl + '?t=' + Date.now(), true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;

      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          var sessions = Array.isArray(data) ? data : (data.sessions || []);
          renderSessions(sessions, container);
          if (countEl) countEl.textContent = sessions.length + ' session' + (sessions.length !== 1 ? 's' : '');
        } catch (e) {
          container.innerHTML =
            '<div class="gallery-empty">' +
              '<div class="empty-icon">[!]</div>' +
              '<div class="empty-text">Error parsing sessions.json</div>' +
              '<div class="empty-hint">' + escapeHtml(e.message) + '</div>' +
            '</div>';
        }
      } else {
        container.innerHTML =
          '<div class="gallery-empty">' +
            '<div class="empty-icon">[x]</div>' +
            '<div class="empty-text">Failed to load sessions</div>' +
            '<div class="empty-hint">HTTP ' + xhr.status + ' -- check the manifest URL</div>' +
          '</div>';
      }

      if (lastUpdateEl) {
        var now = new Date();
        lastUpdateEl.textContent = 'Updated ' +
          String(now.getHours()).padStart(2, '0') + ':' +
          String(now.getMinutes()).padStart(2, '0') + ':' +
          String(now.getSeconds()).padStart(2, '0');
      }
    };
    xhr.send();
  }

  function startAutoRefresh(manifestUrl, container, countEl, lastUpdateEl) {
    stopAutoRefresh();
    refreshTimer = setInterval(function () {
      fetchSessions(manifestUrl, container, countEl, lastUpdateEl);
    }, REFRESH_INTERVAL);
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  window.ResultsGallery = {
    init: function (config) {
      currentConfig = config;
      var container = document.getElementById(config.containerId || 'gallery-grid');
      var countEl = document.getElementById(config.countId || 'session-count');
      var lastUpdateEl = document.getElementById(config.lastUpdateId || 'last-update');

      if (!config.manifestUrl) {
        container.innerHTML =
          '<div class="gallery-empty">' +
            '<div class="empty-icon">[?]</div>' +
            '<div class="empty-text">No manifest URL configured</div>' +
            '<div class="empty-hint">Enter the S3 sessions.json URL to get started</div>' +
          '</div>';
        return;
      }

      fetchSessions(config.manifestUrl, container, countEl, lastUpdateEl);
      startAutoRefresh(config.manifestUrl, container, countEl, lastUpdateEl);
    },

    refresh: function () {
      if (!currentConfig) return;
      var container = document.getElementById(currentConfig.containerId || 'gallery-grid');
      var countEl = document.getElementById(currentConfig.countId || 'session-count');
      var lastUpdateEl = document.getElementById(currentConfig.lastUpdateId || 'last-update');
      fetchSessions(currentConfig.manifestUrl, container, countEl, lastUpdateEl);
    },

    stop: function () {
      stopAutoRefresh();
    }
  };

})(window);
