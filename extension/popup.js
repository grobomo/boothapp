/**
 * Booth Session Tracker -- Popup Controller
 *
 * Polls S3 for session status updates, persists session history
 * in chrome.storage.local, and drives the popup UI.
 */

(function () {
  "use strict";

  // -- DOM refs --
  var statusBadge   = document.getElementById("statusBadge");
  var statusText    = document.getElementById("statusText");
  var sessionInfo   = document.getElementById("sessionInfo");
  var visitorName   = document.getElementById("visitorName");
  var sessionIdEl   = document.getElementById("sessionId");
  var sessionDur    = document.getElementById("sessionDuration");
  var completionPanel = document.getElementById("completionPanel");
  var engagementScore = document.getElementById("engagementScore");
  var scoreBarFill  = document.getElementById("scoreBarFill");
  var btnViewReport = document.getElementById("btnViewReport");
  var historyList   = document.getElementById("historyList");
  var historyEmpty  = document.getElementById("historyEmpty");
  var s3BucketInput = document.getElementById("s3Bucket");
  var s3RegionInput = document.getElementById("s3Region");
  var btnSave       = document.getElementById("btnSaveSettings");

  var POLL_INTERVAL_MS = 5000;
  var MAX_HISTORY = 5;
  var pollTimer = null;

  // -- State labels --
  var STATE_LABELS = {
    idle:       "Idle",
    recording:  "Recording",
    uploading:  "Uploading",
    processing: "Processing",
    complete:   "Complete"
  };

  // -------------------------------------------------------
  // Storage helpers (chrome.storage with localStorage fallback)
  // -------------------------------------------------------

  function storageGet(keys, cb) {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(keys, cb);
    } else {
      // Fallback for dev/testing outside extension context
      var result = {};
      keys.forEach(function (k) {
        var v = localStorage.getItem(k);
        if (v !== null) {
          try { result[k] = JSON.parse(v); } catch (_) { result[k] = v; }
        }
      });
      cb(result);
    }
  }

  function storageSet(obj, cb) {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(obj, cb || function () {});
    } else {
      Object.keys(obj).forEach(function (k) {
        localStorage.setItem(k, JSON.stringify(obj[k]));
      });
      if (cb) cb();
    }
  }

  // -------------------------------------------------------
  // UI updates
  // -------------------------------------------------------

  function setStatus(state) {
    statusBadge.setAttribute("data-state", state);
    statusText.textContent = STATE_LABELS[state] || state;
  }

  function showSessionInfo(session) {
    sessionInfo.style.display = "block";
    visitorName.textContent = session.visitor_name || "--";
    sessionIdEl.textContent = truncateId(session.session_id || "--");
    sessionDur.textContent = formatDuration(session.started_at);
  }

  function hideSessionInfo() {
    sessionInfo.style.display = "none";
  }

  function showCompletion(score, reportUrl) {
    completionPanel.style.display = "block";
    engagementScore.textContent = score;
    var pct = Math.min(Math.max(score, 0), 100);
    scoreBarFill.style.width = pct + "%";

    btnViewReport.onclick = function () {
      if (typeof chrome !== "undefined" && chrome.tabs) {
        chrome.tabs.create({ url: reportUrl });
      } else {
        window.open(reportUrl, "_blank");
      }
    };
  }

  function hideCompletion() {
    completionPanel.style.display = "none";
  }

  function renderHistory(sessions) {
    // Clear existing items (keep the empty placeholder)
    var items = historyList.querySelectorAll(".history-item");
    for (var i = 0; i < items.length; i++) {
      items[i].remove();
    }

    if (!sessions || sessions.length === 0) {
      historyEmpty.style.display = "block";
      return;
    }

    historyEmpty.style.display = "none";

    sessions.slice(0, MAX_HISTORY).forEach(function (s) {
      var item = document.createElement("div");
      item.className = "history-item";

      var reportUrl = s.report_url || "";
      if (reportUrl) {
        item.onclick = function () {
          if (typeof chrome !== "undefined" && chrome.tabs) {
            chrome.tabs.create({ url: reportUrl });
          } else {
            window.open(reportUrl, "_blank");
          }
        };
      }

      item.innerHTML =
        '<div class="history-item-left">' +
          '<span class="history-item-name">' + escHtml(s.visitor_name || "Unknown") + '</span>' +
          '<span class="history-item-date">' + formatTimestamp(s.completed_at || s.started_at) + '</span>' +
        '</div>' +
        '<span class="history-item-score">' + (s.score != null ? s.score : "--") + '</span>';

      historyList.appendChild(item);
    });
  }

  // -------------------------------------------------------
  // S3 polling
  // -------------------------------------------------------

  function buildStatusUrl(bucket, region, sessionId) {
    return "https://" + bucket + ".s3." + region + ".amazonaws.com/sessions/" +
           sessionId + "/status.json";
  }

  function buildReportUrl(bucket, region, sessionId) {
    return "https://" + bucket + ".s3." + region + ".amazonaws.com/sessions/" +
           sessionId + "/summary.html";
  }

  function pollStatus() {
    storageGet(["currentSession", "s3Bucket", "s3Region"], function (data) {
      var session = data.currentSession;
      var bucket  = data.s3Bucket;
      var region  = data.s3Region || "us-east-1";

      if (!session || !bucket || !session.session_id) {
        return; // nothing to poll
      }

      var url = buildStatusUrl(bucket, region, session.session_id);

      fetch(url, { cache: "no-store" })
        .then(function (res) {
          if (!res.ok) return null;
          return res.json();
        })
        .then(function (status) {
          if (!status) return;

          var state = status.state || "idle";
          setStatus(state);

          if (state === "recording" || state === "uploading" || state === "processing") {
            showSessionInfo(session);
            hideCompletion();
          }

          if (state === "complete") {
            showSessionInfo(session);
            var score = status.engagement_score != null ? status.engagement_score : "--";
            var reportUrl = status.report_url ||
                            buildReportUrl(bucket, region, session.session_id);
            showCompletion(score, reportUrl);

            // Save to history
            addToHistory({
              session_id:   session.session_id,
              visitor_name: session.visitor_name || status.visitor_name || "Unknown",
              score:        score,
              report_url:   reportUrl,
              completed_at: status.completed_at || new Date().toISOString(),
              started_at:   session.started_at
            });

            // Clear current session
            storageSet({ currentSession: null });
            stopPolling();
          }
        })
        .catch(function () {
          // Network error -- keep polling silently
        });
    });
  }

  function startPolling() {
    if (pollTimer) return;
    pollStatus(); // immediate first check
    pollTimer = setInterval(pollStatus, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // -------------------------------------------------------
  // History management
  // -------------------------------------------------------

  function addToHistory(entry) {
    storageGet(["sessionHistory"], function (data) {
      var history = data.sessionHistory || [];

      // Deduplicate by session_id
      history = history.filter(function (h) {
        return h.session_id !== entry.session_id;
      });

      history.unshift(entry);
      history = history.slice(0, MAX_HISTORY);

      storageSet({ sessionHistory: history }, function () {
        renderHistory(history);
      });
    });
  }

  // -------------------------------------------------------
  // Helpers
  // -------------------------------------------------------

  function truncateId(id) {
    if (!id || id.length <= 12) return id;
    return id.substring(0, 8) + "...";
  }

  function formatDuration(startedAt) {
    if (!startedAt) return "--";
    var start = new Date(startedAt).getTime();
    var now = Date.now();
    var sec = Math.floor((now - start) / 1000);
    if (sec < 0) return "--";
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function formatTimestamp(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months[d.getMonth()] + " " + d.getDate() + ", " +
           d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
  }

  function escHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // -------------------------------------------------------
  // Settings
  // -------------------------------------------------------

  function loadSettings() {
    storageGet(["s3Bucket", "s3Region"], function (data) {
      if (data.s3Bucket) s3BucketInput.value = data.s3Bucket;
      if (data.s3Region) s3RegionInput.value = data.s3Region;
    });
  }

  btnSave.addEventListener("click", function () {
    var bucket = s3BucketInput.value.trim();
    var region = s3RegionInput.value.trim() || "us-east-1";
    storageSet({ s3Bucket: bucket, s3Region: region }, function () {
      btnSave.textContent = "Saved!";
      setTimeout(function () { btnSave.textContent = "Save"; }, 1200);
    });
  });

  // -------------------------------------------------------
  // Init
  // -------------------------------------------------------

  function init() {
    loadSettings();

    // Load current session state
    storageGet(["currentSession", "sessionHistory"], function (data) {
      var session = data.currentSession;
      var history = data.sessionHistory || [];

      renderHistory(history);

      if (session && session.session_id) {
        setStatus(session.state || "recording");
        showSessionInfo(session);
        startPolling();
      } else {
        setStatus("idle");
        hideSessionInfo();
        hideCompletion();

        // If most recent history item exists, show its completion
        if (history.length > 0) {
          var latest = history[0];
          if (latest.score != null && latest.report_url) {
            showCompletion(latest.score, latest.report_url);
          }
        }
      }
    });

    // Listen for storage changes from background/content scripts
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes) {
        if (changes.currentSession) {
          var session = changes.currentSession.newValue;
          if (session && session.session_id) {
            setStatus(session.state || "recording");
            showSessionInfo(session);
            hideCompletion();
            startPolling();
          } else {
            setStatus("idle");
            hideSessionInfo();
          }
        }
        if (changes.sessionHistory) {
          renderHistory(changes.sessionHistory.newValue || []);
        }
      });
    }
  }

  init();
})();
