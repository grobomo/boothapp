/**
 * BoothApp Admin Console — Management Logic
 *
 * Provides session management (list, delete, re-analyze), system status
 * (watcher health, S3 usage), and an activity log.
 *
 * Depends on: AWS SDK (loaded via script tag), BoothAuth (auth.js)
 */
var AdminConsole = (function () {
  var BUCKET = "boothapp-sessions-752266476357";
  var REGION = "us-east-1";
  var WATCHER_HEALTH_URL = null; // Set dynamically or via env
  var REFRESH_MS = 15000;
  var LOG_MAX = 50;

  var s3 = null;
  var cw = null;
  var lambda = null;

  // ── State ───────────────────────────────────────────────────────────────────
  var sessions = [];
  var activityLog = [];
  var sortCol = "date";
  var sortAsc = false;
  var refreshTimer = null;

  // ── DOM refs (set by init) ──────────────────────────────────────────────────
  var els = {};

  // ── Init ────────────────────────────────────────────────────────────────────

  function init(elements) {
    els = elements;
    var ak = localStorage.getItem("boothapp_aws_ak");
    var sk = localStorage.getItem("boothapp_aws_sk");
    if (!ak || !sk) return false;

    AWS.config.update({ accessKeyId: ak, secretAccessKey: sk, region: REGION });
    s3 = new AWS.S3({ params: { Bucket: BUCKET } });
    cw = new AWS.CloudWatch({ region: REGION });
    lambda = new AWS.Lambda({ region: REGION });
    return true;
  }

  function start() {
    loadAll();
    refreshTimer = setInterval(loadAll, REFRESH_MS);
  }

  function stop() {
    if (refreshTimer) clearInterval(refreshTimer);
  }

  // ── Load everything ─────────────────────────────────────────────────────────

  function loadAll() {
    loadSessions();
    loadSystemStatus();
    loadActivityLog();
  }

  // ── Sessions ────────────────────────────────────────────────────────────────

  function loadSessions() {
    s3.listObjectsV2({ Prefix: "sessions/", Delimiter: "/" }, function (err, data) {
      if (err) {
        showError("S3 error: " + (err.message || err.code));
        return;
      }

      var prefixes = (data.CommonPrefixes || []).map(function (p) {
        return p.Prefix.replace("sessions/", "").replace("/", "");
      }).filter(Boolean);

      if (prefixes.length === 0) {
        sessions = [];
        renderSessions();
        return;
      }

      var pending = prefixes.length;
      var results = [];

      prefixes.forEach(function (sid) {
        s3.getObject({ Key: "sessions/" + sid + "/metadata.json" }, function (err2, mdata) {
          var meta = null;
          if (!err2) {
            try { meta = JSON.parse(mdata.Body.toString()); } catch (e) { /* skip */ }
          }
          results.push(buildRow(sid, meta));
          pending--;
          if (pending === 0) {
            sessions = results;
            renderSessions();
          }
        });
      });
    });
  }

  function buildRow(sid, meta) {
    meta = meta || {};
    var status = meta.status || (meta.ended_at ? "completed" : meta.started_at ? "recording" : "waiting");
    var score = computeScore(meta);
    var hasOutput = false;
    return {
      id: sid,
      name: meta.visitor_name || "Unknown",
      date: meta.started_at || meta.created_at || "",
      endedAt: meta.ended_at || "",
      status: status.toLowerCase(),
      score: score,
      se: meta.se_name || "",
      company: meta.visitor_company || "",
      clicks: meta.click_count != null ? meta.click_count : "--",
      raw: meta
    };
  }

  function computeScore(meta) {
    var clicks = meta.click_count || 0;
    var dur = 0;
    if (meta.started_at) {
      var end = meta.ended_at ? new Date(meta.ended_at).getTime() : Date.now();
      dur = Math.max(0, (end - new Date(meta.started_at).getTime()) / 60000);
    }
    return Math.min(100, Math.round(Math.sqrt(clicks * dur) * 5));
  }

  function sortSessions(list) {
    var copy = list.slice();
    copy.sort(function (a, b) {
      var va, vb;
      switch (sortCol) {
        case "id":     va = a.id;     vb = b.id;     break;
        case "name":   va = a.name;   vb = b.name;   break;
        case "date":   va = a.date;   vb = b.date;   break;
        case "status": va = a.status; vb = b.status;  break;
        case "score":  va = a.score;  vb = b.score;   break;
        default:       va = a.date;   vb = b.date;
      }
      if (typeof va === "number") return sortAsc ? va - vb : vb - va;
      va = (va || "").toString().toLowerCase();
      vb = (vb || "").toString().toLowerCase();
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
    return copy;
  }

  function setSort(col) {
    if (sortCol === col) {
      sortAsc = !sortAsc;
    } else {
      sortCol = col;
      sortAsc = col === "score" ? false : true;
    }
    renderSessions();
  }

  function renderSessions() {
    var sorted = sortSessions(sessions);
    els.sessionCount.textContent = sorted.length + " session" + (sorted.length !== 1 ? "s" : "");

    // Update sort arrows
    if (els.sessionTable) {
      els.sessionTable.querySelectorAll("thead th[data-col]").forEach(function (th) {
        var arrow = th.querySelector(".sort-arrow");
        if (!arrow) return;
        if (th.getAttribute("data-col") === sortCol) {
          arrow.textContent = sortAsc ? " ^" : " v";
        } else {
          arrow.textContent = "";
        }
      });
    }

    if (sorted.length === 0) {
      els.sessionBody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:#484f58;">No sessions found.</td></tr>';
      return;
    }

    var html = "";
    sorted.forEach(function (s) {
      html += "<tr>";
      html += '<td class="mono accent">' + esc(s.id) + "</td>";
      html += "<td>" + esc(s.name) + "</td>";
      html += "<td>" + esc(formatDate(s.date)) + "</td>";
      html += '<td><span class="badge badge-' + badgeType(s.status) + '">' + esc(s.status) + "</span></td>";
      html += "<td>" + renderScoreBar(s.score) + "</td>";
      html += '<td class="action-cell">';
      html += '<button class="btn btn-sm btn-accent retrigger-btn" data-sid="' + esc(s.id) + '" title="Re-trigger analysis">Re-analyze</button>';
      html += '<button class="btn btn-sm btn-danger delete-btn" data-sid="' + esc(s.id) + '" title="Delete session">Delete</button>';
      html += "</td>";
      html += "</tr>";
    });
    els.sessionBody.innerHTML = html;

    // Bind buttons
    els.sessionBody.querySelectorAll(".retrigger-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        retriggerAnalysis(btn.getAttribute("data-sid"), btn);
      });
    });
    els.sessionBody.querySelectorAll(".delete-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        deleteSession(btn.getAttribute("data-sid"), btn);
      });
    });
  }

  // ── Delete session ──────────────────────────────────────────────────────────

  function deleteSession(sid, btn) {
    if (!confirm("Delete session '" + sid + "' and ALL its data from S3? This cannot be undone.")) return;
    btn.disabled = true;
    btn.textContent = "Deleting...";
    addLog("info", "Deleting session " + sid);

    // List all objects under this session prefix then delete them
    s3.listObjectsV2({ Prefix: "sessions/" + sid + "/" }, function (err, data) {
      if (err) {
        showError("Failed to list session objects: " + err.message);
        btn.disabled = false;
        btn.textContent = "Delete";
        addLog("error", "Delete failed for " + sid + ": " + err.message);
        return;
      }

      var objects = (data.Contents || []).map(function (o) { return { Key: o.Key }; });
      if (objects.length === 0) {
        showSuccess("Session " + sid + " already empty");
        btn.disabled = false;
        btn.textContent = "Delete";
        loadSessions();
        return;
      }

      s3.deleteObjects({
        Delete: { Objects: objects, Quiet: true }
      }, function (err2) {
        if (err2) {
          showError("Delete failed: " + err2.message);
          btn.disabled = false;
          btn.textContent = "Delete";
          addLog("error", "Delete failed for " + sid + ": " + err2.message);
          return;
        }
        showSuccess("Deleted session " + sid + " (" + objects.length + " objects)");
        addLog("success", "Deleted session " + sid + " (" + objects.length + " objects)");
        loadSessions();
      });
    });
  }

  // ── Re-trigger analysis ─────────────────────────────────────────────────────

  function retriggerAnalysis(sid, btn) {
    if (!confirm("Re-trigger analysis pipeline for session '" + sid + "'?")) return;
    btn.disabled = true;
    btn.textContent = "Triggering...";
    addLog("info", "Re-triggering analysis for " + sid);

    // Remove the .analysis-claimed marker so watcher picks it up again
    var claimedKey = "sessions/" + sid + "/output/.analysis-claimed";
    s3.deleteObject({ Key: claimedKey }, function (err) {
      if (err && err.code !== "NoSuchKey") {
        showError("Failed to clear analysis marker: " + err.message);
        btn.disabled = false;
        btn.textContent = "Re-analyze";
        addLog("error", "Re-trigger failed for " + sid + ": " + err.message);
        return;
      }

      // Also update metadata status to 'ended' to ensure watcher picks it up
      s3.getObject({ Key: "sessions/" + sid + "/metadata.json" }, function (err2, data) {
        if (err2) {
          showSuccess("Cleared analysis marker for " + sid + " (metadata update skipped)");
          btn.disabled = false;
          btn.textContent = "Re-analyze";
          addLog("success", "Re-trigger: cleared marker for " + sid);
          loadSessions();
          return;
        }

        var meta;
        try { meta = JSON.parse(data.Body.toString()); } catch (e) { meta = {}; }
        meta.status = "ended";
        delete meta.analysis_started_at;
        delete meta.analysis_completed_at;

        s3.putObject({
          Key: "sessions/" + sid + "/metadata.json",
          Body: JSON.stringify(meta, null, 2),
          ContentType: "application/json"
        }, function (err3) {
          btn.disabled = false;
          btn.textContent = "Re-analyze";
          if (err3) {
            showError("Marker cleared but metadata update failed: " + err3.message);
            addLog("warning", "Re-trigger partial for " + sid);
          } else {
            showSuccess("Re-triggered analysis for " + sid + " — watcher will pick it up next cycle");
            addLog("success", "Re-triggered analysis for " + sid);
          }
          loadSessions();
        });
      });
    });
  }

  // ── System status ───────────────────────────────────────────────────────────

  function loadSystemStatus() {
    loadWatcherHealth();
    loadS3Usage();
    loadLambdaMetrics();
  }

  function loadWatcherHealth() {
    // Try to read the watcher health file from S3 (watcher writes to /tmp, but
    // we can also check if sessions are being processed by looking at recent timestamps)
    var statusEl = els.watcherStatus;
    if (!statusEl) return;

    // Check the most recent session's analysis timestamp as a proxy for watcher health
    var recentSession = null;
    var recentTime = 0;
    sessions.forEach(function (s) {
      if (s.raw && s.raw.analysis_completed_at) {
        var t = new Date(s.raw.analysis_completed_at).getTime();
        if (t > recentTime) {
          recentTime = t;
          recentSession = s;
        }
      }
    });

    var now = Date.now();
    if (recentTime > 0) {
      var ageSec = Math.floor((now - recentTime) / 1000);
      if (ageSec < 300) {
        statusEl.innerHTML = '<span class="status-dot active"></span> Active <span class="dim">(last analysis ' + formatAgo(ageSec) + ')</span>';
      } else {
        statusEl.innerHTML = '<span class="status-dot stale"></span> Stale <span class="dim">(last analysis ' + formatAgo(ageSec) + ')</span>';
      }
    } else {
      statusEl.innerHTML = '<span class="status-dot unknown"></span> Unknown <span class="dim">(no recent analysis)</span>';
    }
  }

  function loadS3Usage() {
    if (!els.s3Objects || !els.s3Size) return;

    s3.listObjectsV2({ Prefix: "sessions/" }, function (err, data) {
      if (err) {
        els.s3Objects.textContent = "Error";
        els.s3Size.textContent = "--";
        return;
      }

      var totalSize = 0;
      var count = (data.Contents || []).length;
      (data.Contents || []).forEach(function (obj) {
        totalSize += obj.Size || 0;
      });

      // If truncated, note it
      var suffix = data.IsTruncated ? "+" : "";
      els.s3Objects.textContent = count + suffix;
      els.s3Size.textContent = formatBytes(totalSize) + suffix;
    });
  }

  function loadLambdaMetrics() {
    if (!els.lambdaInvocations) return;

    var now = new Date();
    var start = new Date(now.getTime() - 24 * 60 * 60 * 1000); // last 24h

    cw.getMetricStatistics({
      Namespace: "AWS/Lambda",
      MetricName: "Invocations",
      Dimensions: [{ Name: "FunctionName", Value: "boothapp-session-watcher" }],
      StartTime: start,
      EndTime: now,
      Period: 86400,
      Statistics: ["Sum"]
    }, function (err, data) {
      if (err) {
        els.lambdaInvocations.textContent = "--";
        return;
      }
      var sum = 0;
      (data.Datapoints || []).forEach(function (dp) { sum += dp.Sum || 0; });
      els.lambdaInvocations.textContent = Math.round(sum);
    });
  }

  // ── Activity log ────────────────────────────────────────────────────────────

  function loadActivityLog() {
    // Build log from session metadata analysis timestamps + errors
    var events = [];

    sessions.forEach(function (s) {
      if (s.raw && s.raw.created_at) {
        events.push({
          time: s.raw.created_at,
          type: "info",
          msg: "Session created: " + s.id + " (" + (s.name || "Unknown") + ")"
        });
      }
      if (s.raw && s.raw.analysis_completed_at) {
        events.push({
          time: s.raw.analysis_completed_at,
          type: "success",
          msg: "Analysis completed: " + s.id
        });
      }
      if (s.raw && s.raw.analysis_error) {
        events.push({
          time: s.raw.analysis_error_at || s.raw.ended_at || "",
          type: "error",
          msg: "Analysis error: " + s.id + " — " + s.raw.analysis_error
        });
      }
      if (s.raw && s.raw.ended_at) {
        events.push({
          time: s.raw.ended_at,
          type: "info",
          msg: "Session ended: " + s.id
        });
      }
    });

    // Add manual log entries
    activityLog.forEach(function (entry) {
      events.push(entry);
    });

    // Sort descending by time
    events.sort(function (a, b) {
      return (b.time || "").localeCompare(a.time || "");
    });

    // Trim to LOG_MAX
    events = events.slice(0, LOG_MAX);

    renderActivityLog(events);
  }

  function addLog(type, msg) {
    activityLog.push({
      time: new Date().toISOString(),
      type: type,
      msg: msg
    });
    // Keep manual log trimmed
    if (activityLog.length > LOG_MAX) {
      activityLog = activityLog.slice(-LOG_MAX);
    }
  }

  function renderActivityLog(events) {
    if (!els.logBody) return;

    if (events.length === 0) {
      els.logBody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:1.5rem;color:#484f58;">No events yet.</td></tr>';
      return;
    }

    var html = "";
    events.forEach(function (ev) {
      var typeClass = "log-" + (ev.type || "info");
      html += "<tr>";
      html += '<td class="mono dim">' + esc(formatDate(ev.time)) + "</td>";
      html += '<td><span class="log-badge ' + typeClass + '">' + esc(ev.type || "info") + "</span></td>";
      html += "<td>" + esc(ev.msg) + "</td>";
      html += "</tr>";
    });
    els.logBody.innerHTML = html;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function esc(str) {
    var d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  function formatDate(iso) {
    if (!iso) return "--";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "--";
    var mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return mon[d.getMonth()] + " " + d.getDate() + ", " +
      (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" +
      (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
  }

  function formatAgo(seconds) {
    if (seconds < 60) return seconds + "s ago";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
    if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
    return Math.floor(seconds / 86400) + "d ago";
  }

  function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    var units = ["B", "KB", "MB", "GB"];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    i = Math.min(i, units.length - 1);
    return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
  }

  function badgeType(status) {
    if (status === "recording" || status === "in_progress") return "recording";
    if (status === "completed" || status === "ended") return "completed";
    if (status === "analyzing") return "analyzing";
    if (status === "waiting") return "waiting";
    return "unknown";
  }

  function renderScoreBar(score) {
    var cls = score >= 60 ? "high" : score >= 25 ? "mid" : "low";
    return '<div class="score-bar">' +
      '<div class="score-track"><div class="score-fill ' + cls + '" style="width:' + score + '%"></div></div>' +
      '<span class="score-label">' + score + '</span></div>';
  }

  function showError(msg) {
    if (!els.errorMsg) return;
    els.errorMsg.textContent = msg;
    els.errorMsg.style.display = "block";
    if (els.successMsg) els.successMsg.style.display = "none";
  }

  function showSuccess(msg) {
    if (!els.successMsg) return;
    els.successMsg.textContent = msg;
    els.successMsg.style.display = "block";
    if (els.errorMsg) els.errorMsg.style.display = "none";
    setTimeout(function () { els.successMsg.style.display = "none"; }, 4000);
  }

  return {
    init: init,
    start: start,
    stop: stop,
    setSort: setSort,
    loadAll: loadAll
  };
})();
