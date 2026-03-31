/* compare.js -- Session comparison logic for BoothApp
   Loads summary.json from session folders, renders side-by-side comparison grid.
   No external dependencies. */

(function () {
  'use strict';

  var MAX_SESSIONS = 3;
  var sessions = [];
  var sessionPaths = [];

  // ---- DOM refs ----
  var dropZone = document.getElementById('drop-zone');
  var fileInput = document.getElementById('file-input');
  var sessionList = document.getElementById('session-list');
  var compareBtn = document.getElementById('compare-btn');
  var comparisonArea = document.getElementById('comparison-area');
  var emptyState = document.getElementById('empty-state');

  // ---- File handling ----
  function handleFiles(fileList) {
    var dominated = [];
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      if (f.name === 'summary.json' || f.name.endsWith('/summary.json')) {
        dominated.push(f);
      }
    }
    if (dominated.length === 0) {
      showToast('No summary.json found in selected files');
      return;
    }
    dominated.forEach(function (f) {
      if (sessionPaths.length >= MAX_SESSIONS) {
        showToast('Maximum ' + MAX_SESSIONS + ' sessions allowed');
        return;
      }
      var path = f.webkitRelativePath || f.name;
      if (sessionPaths.indexOf(path) !== -1) return;
      sessionPaths.push(path);
      readJsonFile(f, path);
    });
  }

  function readJsonFile(file, path) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        sessions.push({ path: path, data: data });
        renderSessionList();
      } catch (err) {
        showToast('Invalid JSON: ' + path);
      }
    };
    reader.readAsText(file);
  }

  // ---- Drag & drop ----
  if (dropZone) {
    dropZone.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', function () {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer.items) {
        var files = [];
        for (var i = 0; i < e.dataTransfer.items.length; i++) {
          if (e.dataTransfer.items[i].kind === 'file') {
            files.push(e.dataTransfer.items[i].getAsFile());
          }
        }
        handleFiles(files);
      } else {
        handleFiles(e.dataTransfer.files);
      }
    });
    dropZone.addEventListener('click', function () {
      fileInput.click();
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', function () {
      handleFiles(fileInput.files);
      fileInput.value = '';
    });
  }

  // ---- Paste JSON directly ----
  var pasteArea = document.getElementById('paste-area');
  var pasteInput = document.getElementById('paste-input');
  var pasteBtn = document.getElementById('paste-btn');

  if (pasteBtn) {
    pasteBtn.addEventListener('click', function () {
      var raw = pasteInput.value.trim();
      if (!raw) return;
      try {
        var data = JSON.parse(raw);
        if (sessionPaths.length >= MAX_SESSIONS) {
          showToast('Maximum ' + MAX_SESSIONS + ' sessions allowed');
          return;
        }
        var label = (data.visitor && data.visitor.name) || ('Session ' + (sessions.length + 1));
        var path = label + ' (pasted)';
        if (sessionPaths.indexOf(path) !== -1) {
          showToast('Session already added');
          return;
        }
        sessionPaths.push(path);
        sessions.push({ path: path, data: data });
        pasteInput.value = '';
        renderSessionList();
      } catch (err) {
        showToast('Invalid JSON -- check the format');
      }
    });
  }

  // ---- Session list ----
  function renderSessionList() {
    sessionList.innerHTML = '';
    sessions.forEach(function (s, idx) {
      var name = (s.data.visitor && s.data.visitor.name) || 'Unknown';
      var company = (s.data.visitor && s.data.visitor.company) || '';
      var el = document.createElement('div');
      el.className = 'session-chip';
      el.innerHTML =
        '<span class="chip-name">' + esc(name) + '</span>' +
        (company ? '<span class="chip-company">' + esc(company) + '</span>' : '') +
        '<button class="chip-remove" data-idx="' + idx + '" title="Remove">&times;</button>';
      sessionList.appendChild(el);
    });
    compareBtn.disabled = sessions.length < 2;
    if (sessions.length >= 2) {
      compareBtn.classList.add('ready');
    } else {
      compareBtn.classList.remove('ready');
    }
  }

  sessionList.addEventListener('click', function (e) {
    if (e.target.classList.contains('chip-remove')) {
      var idx = parseInt(e.target.getAttribute('data-idx'), 10);
      sessions.splice(idx, 1);
      sessionPaths.splice(idx, 1);
      renderSessionList();
      comparisonArea.innerHTML = '';
      emptyState.style.display = 'block';
    }
  });

  // ---- Compare button ----
  if (compareBtn) {
    compareBtn.addEventListener('click', function () {
      if (sessions.length < 2) return;
      renderComparison();
    });
  }

  // ---- Render comparison ----
  function renderComparison() {
    emptyState.style.display = 'none';
    var cols = sessions.length;
    var colClass = cols === 2 ? 'cols-2' : 'cols-3';

    var html = '<div class="compare-grid ' + colClass + '">';

    // Header row
    html += '<div class="compare-row compare-header">';
    sessions.forEach(function (s) {
      var v = s.data.visitor || {};
      html += '<div class="compare-cell header-cell">' +
        '<div class="visitor-name">' + esc(v.name || 'Unknown') + '</div>' +
        '<div class="visitor-title">' + esc(v.title || '') + '</div>' +
        '<div class="visitor-company">' + esc(v.company || '') + '</div>' +
        '</div>';
    });
    html += '</div>';

    // Engagement score row
    html += sectionRow('Engagement Score');
    html += '<div class="compare-row">';
    sessions.forEach(function (s) {
      var score = extractScore(s.data);
      var color = scoreColor(score);
      html += '<div class="compare-cell">' +
        '<div class="score-ring" style="--score-color:' + color + ';--score-pct:' + (score * 10) + '%">' +
        '<span class="score-value" style="color:' + color + '">' + (score !== null ? score.toFixed(1) : 'N/A') + '</span>' +
        '</div>' +
        '</div>';
    });
    html += '</div>';

    // Product count row
    html += sectionRow('Products Demonstrated');
    html += '<div class="compare-row">';
    sessions.forEach(function (s) {
      var products = s.data.products_demonstrated || [];
      html += '<div class="compare-cell">' +
        '<div class="metric-big">' + products.length + '</div>' +
        '<div class="product-list">' +
        products.map(function (p) {
          return '<div class="product-tag">' + esc(p.name) + '</div>';
        }).join('') +
        '</div></div>';
    });
    html += '</div>';

    // Key interests row
    html += sectionRow('Key Interests');
    html += '<div class="compare-row">';
    sessions.forEach(function (s) {
      var interests = s.data.interests || [];
      html += '<div class="compare-cell"><div class="interest-list">';
      interests.forEach(function (i) {
        var conf = (i.confidence || '').toLowerCase();
        var badge = conf === 'high' ? 'badge-high' : conf === 'medium' ? 'badge-med' : 'badge-low';
        html += '<div class="interest-item">' +
          '<span class="interest-badge ' + badge + '">' + esc(conf) + '</span>' +
          '<span class="interest-topic">' + esc(i.topic) + '</span>' +
          '</div>';
      });
      html += '</div></div>';
    });
    html += '</div>';

    // Top recommendations row
    html += sectionRow('Top Recommendations');
    html += '<div class="compare-row">';
    sessions.forEach(function (s) {
      var recs = (s.data.recommendations || []).slice(0, 4);
      html += '<div class="compare-cell"><div class="rec-list">';
      recs.forEach(function (r) {
        var pri = (r.priority || '').toLowerCase();
        var badge = pri === 'high' ? 'badge-high' : pri === 'medium' ? 'badge-med' : 'badge-low';
        html += '<div class="rec-item">' +
          '<span class="rec-badge ' + badge + '">' + esc(pri) + '</span>' +
          '<span class="rec-text">' + esc(r.action) + '</span>' +
          '</div>';
      });
      html += '</div></div>';
    });
    html += '</div>';

    // Visit details row
    html += sectionRow('Visit Details');
    html += '<div class="compare-row">';
    sessions.forEach(function (s) {
      var v = s.data.visitor || {};
      html += '<div class="compare-cell"><div class="detail-grid">' +
        detailRow('Industry', v.industry) +
        detailRow('Company Size', v.company_size) +
        detailRow('Duration', v.visit_duration) +
        detailRow('Email', v.email) +
        '</div></div>';
    });
    html += '</div>';

    html += '</div>';
    comparisonArea.innerHTML = html;
  }

  function sectionRow(title) {
    return '<div class="compare-row section-label-row"><div class="section-label">' + esc(title) + '</div></div>';
  }

  function detailRow(label, value) {
    return '<div class="detail-item">' +
      '<span class="detail-label">' + esc(label) + '</span>' +
      '<span class="detail-value">' + esc(value || 'N/A') + '</span>' +
      '</div>';
  }

  function extractScore(data) {
    if (data.engagement_score !== undefined) return parseFloat(data.engagement_score);
    if (data.score !== undefined) return parseFloat(data.score);
    // Try to find in nested structure
    if (data.visitor && data.visitor.engagement_score !== undefined) return parseFloat(data.visitor.engagement_score);
    // Derive from interests confidence if no explicit score
    var interests = data.interests || [];
    if (interests.length === 0) return null;
    var total = 0;
    interests.forEach(function (i) {
      var c = (i.confidence || '').toLowerCase();
      total += c === 'high' ? 9 : c === 'medium' ? 6 : 3;
    });
    return Math.min(10, Math.round((total / interests.length) * 10) / 10);
  }

  function scoreColor(score) {
    if (score === null) return '#6B7385';
    if (score >= 7) return '#00E676';
    if (score >= 4) return '#FFAB00';
    return '#FF5252';
  }

  function esc(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
  }

  // ---- Toast ----
  function showToast(msg) {
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function () { toast.classList.add('show'); }, 10);
    setTimeout(function () {
      toast.classList.remove('show');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
  }

  // ---- Demo data loader ----
  var demoBtn = document.getElementById('demo-btn');
  if (demoBtn) {
    demoBtn.addEventListener('click', loadDemoData);
  }

  function loadDemoData() {
    sessions = [];
    sessionPaths = [];

    var demos = [
      {
        visitor: { name: 'Sarah Chen', title: 'VP of Information Security', company: 'Acme Financial Corp', email: 'schen@acmefin.example.com', industry: 'Financial Services', company_size: '5,000 - 10,000 employees', visit_duration: '28 minutes' },
        engagement_score: 8.2,
        products_demonstrated: [
          { name: 'Vision One XDR', timestamp: '14:02', note: 'Asked about SOC integration' },
          { name: 'Cloud Security', timestamp: '14:10', note: 'Running K8s in AWS EKS' },
          { name: 'Zero Trust Secure Access', timestamp: '14:18', note: 'Evaluating ZTNA solutions' },
          { name: 'Email Security', timestamp: '14:24', note: 'Recent BEC incidents' }
        ],
        interests: [
          { topic: 'XDR / SOC Modernization', confidence: 'high' },
          { topic: 'Cloud Workload Security', confidence: 'high' },
          { topic: 'Zero Trust Network Access', confidence: 'medium' },
          { topic: 'Email Threat Protection', confidence: 'medium' }
        ],
        recommendations: [
          { action: 'Schedule XDR deep-dive with SOC team', priority: 'high' },
          { action: 'Send container protection datasheet', priority: 'high' },
          { action: 'Connect with ZTNA SE for PoC', priority: 'medium' },
          { action: 'Share BEC case study', priority: 'medium' }
        ]
      },
      {
        visitor: { name: 'Marcus Rivera', title: 'CISO', company: 'NovaTech Industries', email: 'mrivera@novatech.example.com', industry: 'Manufacturing', company_size: '10,000 - 50,000 employees', visit_duration: '35 minutes' },
        engagement_score: 9.1,
        products_demonstrated: [
          { name: 'Vision One XDR', timestamp: '10:05', note: 'Full platform demo requested' },
          { name: 'Server & Workload Protection', timestamp: '10:15', note: 'OT/IT convergence' },
          { name: 'Network Defense', timestamp: '10:25', note: 'ICS/SCADA visibility' }
        ],
        interests: [
          { topic: 'OT/IT Convergence Security', confidence: 'high' },
          { topic: 'XDR Platform Consolidation', confidence: 'high' },
          { topic: 'Network Segmentation', confidence: 'high' },
          { topic: 'Managed XDR', confidence: 'medium' }
        ],
        recommendations: [
          { action: 'Arrange OT security workshop', priority: 'high' },
          { action: 'Executive briefing with CTO', priority: 'high' },
          { action: 'Network Defense PoC for ICS', priority: 'high' },
          { action: 'Share manufacturing case studies', priority: 'medium' }
        ]
      },
      {
        visitor: { name: 'Priya Patel', title: 'Director of IT Security', company: 'HealthFirst Systems', email: 'ppatel@healthfirst.example.com', industry: 'Healthcare', company_size: '1,000 - 5,000 employees', visit_duration: '22 minutes' },
        engagement_score: 6.5,
        products_demonstrated: [
          { name: 'Email Security', timestamp: '15:30', note: 'Phishing is top concern' },
          { name: 'Endpoint Security', timestamp: '15:40', note: 'HIPAA compliance focus' }
        ],
        interests: [
          { topic: 'Email Threat Protection', confidence: 'high' },
          { topic: 'Endpoint Compliance', confidence: 'medium' },
          { topic: 'Data Loss Prevention', confidence: 'low' }
        ],
        recommendations: [
          { action: 'Send healthcare compliance whitepaper', priority: 'high' },
          { action: 'Email Security trial setup', priority: 'high' },
          { action: 'Follow up after RSA with pricing', priority: 'medium' }
        ]
      }
    ];

    demos.forEach(function (d, i) {
      var label = d.visitor.name + ' (demo)';
      sessionPaths.push(label);
      sessions.push({ path: label, data: d });
    });

    renderSessionList();
    showToast('Loaded 3 demo sessions');
  }
})();
