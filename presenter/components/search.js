/**
 * BoothApp Global Search
 * Searches across session data: visitor names, companies, session IDs,
 * transcript content, and follow-up actions.
 *
 * Usage: new BoothSearch({ container: '#search-mount' })
 */
(function (root) {
    'use strict';

    // ------------------------------------------------------------------
    // CONFIG
    // ------------------------------------------------------------------
    var DEBOUNCE_MS      = 300;
    var MAX_RESULTS      = 8;
    var MAX_RECENT       = 5;
    var STORAGE_KEY      = 'boothapp_recent_searches';
    var SNIPPET_LEN      = 80;

    // ------------------------------------------------------------------
    // MOCK SESSION DATA (used when /api/sessions is unavailable)
    // ------------------------------------------------------------------
    var MOCK_SESSIONS = [
        {
            session_id: 'SES-2026-0331-0042',
            visitor: { name: 'Sarah Chen', company: 'Acme Financial Corp', title: 'VP of Information Security' },
            transcript: 'Discussed Vision One XDR integration with existing SIEM. Looking for XDR platform that consolidates alerts. Asked about SOC automation and threat intelligence feeds. Interested in container security for Kubernetes workloads.',
            follow_up: ['Schedule technical deep-dive on Vision One XDR with SOC team', 'Send Cloud Security container protection datasheet and pricing'],
            products: ['Vision One XDR', 'Cloud Security'],
            timestamp: '2026-03-31T14:02:00Z'
        },
        {
            session_id: 'SES-2026-0331-0043',
            visitor: { name: 'James Rodriguez', company: 'TechVault Inc', title: 'CISO' },
            transcript: 'Primary concern is ransomware protection across endpoints. Currently using legacy AV solution. Wants unified endpoint protection with EDR capabilities. Mentioned recent phishing attempts targeting executives.',
            follow_up: ['Connect with Apex One SE for proof-of-concept', 'Share ransomware protection case study'],
            products: ['Apex One', 'Email Security'],
            timestamp: '2026-03-31T14:35:00Z'
        },
        {
            session_id: 'SES-2026-0331-0044',
            visitor: { name: 'Emily Nakamura', company: 'CloudNine Solutions', title: 'Cloud Architect' },
            transcript: 'Running multi-cloud environment across AWS and Azure. Needs workload protection and CSPM. Interested in container image scanning and runtime protection for EKS clusters. Asked about compliance reporting for SOC2.',
            follow_up: ['Send Cloud One Conformity trial invitation', 'Schedule demo of container security scanning'],
            products: ['Cloud One', 'Deep Security'],
            timestamp: '2026-03-31T15:10:00Z'
        },
        {
            session_id: 'SES-2026-0331-0045',
            visitor: { name: 'David Kim', company: 'SecureStack', title: 'Director of IT' },
            transcript: 'Evaluating Zero Trust solutions for remote workforce. Currently using traditional VPN which is slow and difficult to manage. Wants ZTNA with device posture checking. Also interested in email security after BEC incident last quarter.',
            follow_up: ['Provide ZTNA proof-of-concept setup guide', 'Share BEC case study and Email Security ROI calculator'],
            products: ['Zero Trust', 'Email Security'],
            timestamp: '2026-03-31T15:45:00Z'
        },
        {
            session_id: 'SES-2026-0331-0046',
            visitor: { name: 'Priya Sharma', company: 'Quantum Networks', title: 'Security Operations Manager' },
            transcript: 'Looking for managed detection and response service. Small SOC team overwhelmed with alerts. Wants 24/7 monitoring and incident response. Discussed XDR platform with managed service layer. Asked about integration with ServiceNow for ticketing.',
            follow_up: ['Send MDR service overview and SLA documentation', 'Schedule call with MDR team for scoping'],
            products: ['Vision One XDR', 'Network One'],
            timestamp: '2026-03-31T16:20:00Z'
        },
        {
            session_id: 'SES-2026-0331-0047',
            visitor: { name: 'Marcus Johnson', company: 'Atlas Financial', title: 'Head of Cybersecurity' },
            transcript: 'Needs network security solution for branch offices. Currently has fragmented firewall setup. Interested in IPS and network traffic analysis. Asked about integration with existing Palo Alto firewalls. Wants centralized management console.',
            follow_up: ['Send Network One deployment architecture for branch offices', 'Arrange technical workshop on network integration'],
            products: ['Network One', 'Vision One XDR'],
            timestamp: '2026-03-31T16:55:00Z'
        },
        {
            session_id: 'SES-2026-0331-0048',
            visitor: { name: 'Anna Petrov', company: 'Meridian Energy', title: 'IT Security Lead' },
            transcript: 'OT/IT convergence is top priority. Running SCADA systems that need protection without impacting availability. Interested in network segmentation and anomaly detection for industrial control systems. Compliance with NERC CIP is mandatory.',
            follow_up: ['Connect with OT security specialist', 'Send industrial security reference architecture'],
            products: ['Deep Security', 'Network One'],
            timestamp: '2026-03-31T17:30:00Z'
        },
        {
            session_id: 'SES-2026-0331-0049',
            visitor: { name: 'Lisa Wang', company: 'Pinnacle Health', title: 'VP Technology' },
            transcript: 'Healthcare organization with strict HIPAA requirements. Moving workloads to Azure. Needs data loss prevention and email security for PHI protection. Also interested in endpoint protection for medical devices running legacy Windows.',
            follow_up: ['Send HIPAA compliance whitepaper', 'Schedule healthcare-specific demo with vertical SE'],
            products: ['Email Security', 'Apex One', 'Cloud One'],
            timestamp: '2026-03-31T18:05:00Z'
        }
    ];

    // ------------------------------------------------------------------
    // SESSION DATA STORE
    // ------------------------------------------------------------------
    var sessions = [];
    var dataLoaded = false;

    function loadSessions(callback) {
        if (dataLoaded) { callback(sessions); return; }

        fetch('/api/sessions')
            .then(function (r) {
                if (!r.ok) throw new Error(r.status);
                return r.json();
            })
            .then(function (data) {
                sessions = Array.isArray(data) ? data : (data.sessions || []);
                dataLoaded = true;
                callback(sessions);
            })
            .catch(function () {
                sessions = MOCK_SESSIONS;
                dataLoaded = true;
                callback(sessions);
            });
    }

    // ------------------------------------------------------------------
    // SEARCH ENGINE
    // ------------------------------------------------------------------
    function searchSessions(query) {
        if (!query || query.length < 2) return [];
        var q = query.toLowerCase();
        var results = [];

        for (var i = 0; i < sessions.length; i++) {
            var s = sessions[i];
            var matches = [];

            // Session ID
            if (s.session_id && s.session_id.toLowerCase().indexOf(q) !== -1) {
                matches.push({ field: 'Session ID', snippet: s.session_id });
            }

            // Visitor name
            if (s.visitor && s.visitor.name && s.visitor.name.toLowerCase().indexOf(q) !== -1) {
                matches.push({ field: 'Visitor', snippet: s.visitor.name + (s.visitor.title ? ' -- ' + s.visitor.title : '') });
            }

            // Company
            if (s.visitor && s.visitor.company && s.visitor.company.toLowerCase().indexOf(q) !== -1) {
                matches.push({ field: 'Company', snippet: s.visitor.company });
            }

            // Transcript content
            if (s.transcript) {
                var tIdx = s.transcript.toLowerCase().indexOf(q);
                if (tIdx !== -1) {
                    var start = Math.max(0, tIdx - 20);
                    var end = Math.min(s.transcript.length, tIdx + q.length + SNIPPET_LEN - 20);
                    var snippet = (start > 0 ? '...' : '') +
                        s.transcript.substring(start, end) +
                        (end < s.transcript.length ? '...' : '');
                    matches.push({ field: 'Transcript', snippet: snippet });
                }
            }

            // Follow-up actions
            if (s.follow_up) {
                for (var j = 0; j < s.follow_up.length; j++) {
                    var action = typeof s.follow_up[j] === 'string' ? s.follow_up[j] : (s.follow_up[j].action || '');
                    if (action.toLowerCase().indexOf(q) !== -1) {
                        matches.push({ field: 'Follow-up', snippet: action });
                        break; // one match per session is enough
                    }
                }
            }

            // Products
            if (s.products) {
                for (var k = 0; k < s.products.length; k++) {
                    var prod = typeof s.products[k] === 'string' ? s.products[k] : (s.products[k].name || '');
                    if (prod.toLowerCase().indexOf(q) !== -1) {
                        matches.push({ field: 'Product', snippet: prod });
                        break;
                    }
                }
            }

            if (matches.length > 0) {
                results.push({
                    session: s,
                    matches: matches,
                    primaryMatch: matches[0]
                });
            }

            if (results.length >= MAX_RESULTS) break;
        }

        return results;
    }

    // ------------------------------------------------------------------
    // HIGHLIGHT HELPER
    // ------------------------------------------------------------------
    function highlight(text, query) {
        if (!query) return escapeHtml(text);
        var escaped = escapeHtml(text);
        var q = escapeHtml(query);
        var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
        return escaped.replace(re, '<mark class="search-highlight">$1</mark>');
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // ------------------------------------------------------------------
    // RECENT SEARCHES
    // ------------------------------------------------------------------
    function getRecentSearches() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) { return []; }
    }

    function addRecentSearch(query) {
        var recent = getRecentSearches();
        // Remove duplicates
        recent = recent.filter(function (r) { return r !== query; });
        recent.unshift(query);
        if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(recent)); } catch (e) { /* quota */ }
    }

    function clearRecentSearches() {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
    }

    // ------------------------------------------------------------------
    // CSS INJECTION
    // ------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('boothapp-search-styles')) return;
        var style = document.createElement('style');
        style.id = 'boothapp-search-styles';
        style.textContent = [
            '.search-container {',
            '  position: relative;',
            '  width: 100%;',
            '  max-width: 480px;',
            '  margin: 0 auto 20px;',
            '}',
            '.search-input-wrap {',
            '  position: relative;',
            '  display: flex;',
            '  align-items: center;',
            '}',
            '.search-input-wrap svg {',
            '  position: absolute;',
            '  left: 14px;',
            '  width: 18px; height: 18px;',
            '  fill: var(--text-dim, #6B7385);',
            '  pointer-events: none;',
            '  transition: fill .2s;',
            '}',
            '.search-input-wrap:focus-within svg {',
            '  fill: var(--red, #D71920);',
            '}',
            '.search-input {',
            '  width: 100%;',
            '  padding: 12px 70px 12px 42px;',
            '  background: var(--surface, #0E1118);',
            '  border: 1px solid var(--border, #1E2330);',
            '  border-radius: 12px;',
            '  color: var(--text, #F0F2F5);',
            '  font-size: 14px;',
            '  font-family: inherit;',
            '  outline: none;',
            '  transition: border-color .2s, box-shadow .2s;',
            '}',
            '.search-input::placeholder {',
            '  color: var(--text-dim, #6B7385);',
            '}',
            '.search-input:focus {',
            '  border-color: var(--red, #D71920);',
            '  box-shadow: 0 0 0 3px rgba(215,25,32,.15);',
            '}',
            '.search-shortcut {',
            '  position: absolute;',
            '  right: 14px;',
            '  display: flex;',
            '  align-items: center;',
            '  gap: 3px;',
            '  pointer-events: none;',
            '  opacity: .5;',
            '  transition: opacity .2s;',
            '}',
            '.search-input:focus ~ .search-shortcut {',
            '  opacity: 0;',
            '}',
            '.search-kbd {',
            '  display: inline-block;',
            '  padding: 2px 6px;',
            '  font-size: 11px;',
            '  font-family: monospace;',
            '  background: var(--surface2, #151920);',
            '  border: 1px solid var(--border, #1E2330);',
            '  border-radius: 4px;',
            '  color: var(--text-dim, #6B7385);',
            '  line-height: 1.4;',
            '}',
            '.search-dropdown {',
            '  position: absolute;',
            '  top: calc(100% + 6px);',
            '  left: 0; right: 0;',
            '  background: var(--surface, #0E1118);',
            '  border: 1px solid var(--border, #1E2330);',
            '  border-radius: 12px;',
            '  box-shadow: 0 16px 48px rgba(0,0,0,.5);',
            '  z-index: 1000;',
            '  max-height: 420px;',
            '  overflow-y: auto;',
            '  display: none;',
            '}',
            '.search-dropdown.visible { display: block; }',
            '.search-dropdown-header {',
            '  padding: 10px 16px 6px;',
            '  font-size: 11px;',
            '  text-transform: uppercase;',
            '  letter-spacing: .08em;',
            '  color: var(--text-dim, #6B7385);',
            '  display: flex;',
            '  justify-content: space-between;',
            '  align-items: center;',
            '}',
            '.search-clear-btn {',
            '  font-size: 11px;',
            '  color: var(--red, #D71920);',
            '  cursor: pointer;',
            '  background: none;',
            '  border: none;',
            '  text-transform: uppercase;',
            '  letter-spacing: .08em;',
            '  padding: 0;',
            '}',
            '.search-clear-btn:hover { text-decoration: underline; }',
            '.search-result {',
            '  display: block;',
            '  padding: 10px 16px;',
            '  cursor: pointer;',
            '  transition: background .15s;',
            '  border-bottom: 1px solid var(--border, #1E2330);',
            '  text-decoration: none;',
            '  color: inherit;',
            '}',
            '.search-result:last-child { border-bottom: none; }',
            '.search-result:hover, .search-result.active {',
            '  background: var(--surface2, #151920);',
            '}',
            '.search-result-title {',
            '  font-size: 14px;',
            '  font-weight: 600;',
            '  color: var(--text, #F0F2F5);',
            '  margin-bottom: 2px;',
            '}',
            '.search-result-meta {',
            '  font-size: 12px;',
            '  color: var(--text-dim, #6B7385);',
            '  margin-bottom: 4px;',
            '}',
            '.search-result-snippet {',
            '  font-size: 12px;',
            '  color: var(--text-dim, #6B7385);',
            '  line-height: 1.5;',
            '}',
            '.search-result-badge {',
            '  display: inline-block;',
            '  font-size: 10px;',
            '  padding: 1px 6px;',
            '  border-radius: 4px;',
            '  background: rgba(215,25,32,.15);',
            '  color: var(--red-light, #FF4D52);',
            '  margin-right: 6px;',
            '  vertical-align: middle;',
            '}',
            'mark.search-highlight {',
            '  background: rgba(215,25,32,.25);',
            '  color: var(--red-light, #FF4D52);',
            '  border-radius: 2px;',
            '  padding: 0 1px;',
            '}',
            '.search-empty {',
            '  padding: 24px 16px;',
            '  text-align: center;',
            '  color: var(--text-dim, #6B7385);',
            '  font-size: 13px;',
            '}',
            '.search-recent-item {',
            '  display: flex;',
            '  align-items: center;',
            '  gap: 10px;',
            '  padding: 8px 16px;',
            '  cursor: pointer;',
            '  transition: background .15s;',
            '  color: var(--text, #F0F2F5);',
            '  font-size: 13px;',
            '}',
            '.search-recent-item:hover, .search-recent-item.active {',
            '  background: var(--surface2, #151920);',
            '}',
            '.search-recent-icon {',
            '  width: 14px; height: 14px;',
            '  fill: var(--text-dim, #6B7385);',
            '  flex-shrink: 0;',
            '}'
        ].join('\n');
        document.head.appendChild(style);
    }

    // ------------------------------------------------------------------
    // DOM BUILDER
    // ------------------------------------------------------------------
    function buildSearchHTML() {
        return '<div class="search-container" id="boothSearchContainer">' +
            '<div class="search-input-wrap">' +
                '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>' +
                '<input type="text" class="search-input" id="boothSearchInput" ' +
                    'placeholder="Search sessions, visitors, transcripts..." ' +
                    'autocomplete="off" spellcheck="false" />' +
                '<span class="search-shortcut">' +
                    '<kbd class="search-kbd">Ctrl</kbd>' +
                    '<kbd class="search-kbd">K</kbd>' +
                '</span>' +
            '</div>' +
            '<div class="search-dropdown" id="boothSearchDropdown"></div>' +
        '</div>';
    }

    // ------------------------------------------------------------------
    // COMPONENT
    // ------------------------------------------------------------------
    function BoothSearch(opts) {
        opts = opts || {};
        this.containerSelector = opts.container || '#search-mount';
        this.onNavigate = opts.onNavigate || null;
        this._activeIndex = -1;
        this._items = [];
        this._debounceTimer = null;
        this._currentQuery = '';

        injectStyles();
        this._mount();
        this._bind();

        // Pre-load session data
        var self = this;
        loadSessions(function () { self._showInitial(); });
    }

    BoothSearch.prototype._mount = function () {
        var target = document.querySelector(this.containerSelector);
        if (!target) {
            // Create mount point after header if not found
            var header = document.querySelector('.header');
            if (header) {
                var mount = document.createElement('div');
                mount.id = 'search-mount';
                header.parentNode.insertBefore(mount, header.nextSibling);
                target = mount;
            }
        }
        if (!target) return;
        target.innerHTML = buildSearchHTML();
        this.input = document.getElementById('boothSearchInput');
        this.dropdown = document.getElementById('boothSearchDropdown');
    };

    BoothSearch.prototype._bind = function () {
        if (!this.input) return;
        var self = this;

        // Debounced input
        this.input.addEventListener('input', function () {
            clearTimeout(self._debounceTimer);
            self._debounceTimer = setTimeout(function () {
                self._onSearch();
            }, DEBOUNCE_MS);
        });

        // Focus: show recent or results
        this.input.addEventListener('focus', function () {
            if (self.input.value.length >= 2) {
                self._onSearch();
            } else {
                self._showRecent();
            }
        });

        // Keyboard navigation
        this.input.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                self._moveActive(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                self._moveActive(-1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                self._selectActive();
            } else if (e.key === 'Escape') {
                self._close();
                self.input.blur();
            }
        });

        // Click outside to close
        document.addEventListener('mousedown', function (e) {
            var container = document.getElementById('boothSearchContainer');
            if (container && !container.contains(e.target)) {
                self._close();
            }
        });

        // Ctrl+K shortcut
        document.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                self.input.focus();
                self.input.select();
            }
        });
    };

    BoothSearch.prototype._onSearch = function () {
        var query = this.input.value.trim();
        this._currentQuery = query;

        if (query.length < 2) {
            this._showRecent();
            return;
        }

        var results = searchSessions(query);
        this._renderResults(results, query);
    };

    BoothSearch.prototype._renderResults = function (results, query) {
        this._items = [];
        this._activeIndex = -1;

        if (results.length === 0) {
            this.dropdown.innerHTML =
                '<div class="search-empty">No sessions matching "' + escapeHtml(query) + '"</div>';
            this.dropdown.classList.add('visible');
            return;
        }

        var html = '<div class="search-dropdown-header">Results</div>';
        for (var i = 0; i < results.length; i++) {
            var r = results[i];
            var s = r.session;
            var name = s.visitor ? s.visitor.name : 'Unknown';
            var company = s.visitor ? s.visitor.company : '';
            var match = r.primaryMatch;

            html += '<div class="search-result" data-index="' + i + '" data-session-id="' + escapeHtml(s.session_id) + '">' +
                '<div class="search-result-title">' +
                    '<span class="search-result-badge">' + escapeHtml(match.field) + '</span>' +
                    highlight(name, query) +
                '</div>' +
                '<div class="search-result-meta">' + escapeHtml(company) + ' &middot; ' + escapeHtml(s.session_id) + '</div>' +
                '<div class="search-result-snippet">' + highlight(match.snippet, query) + '</div>' +
            '</div>';
        }

        this.dropdown.innerHTML = html;
        this.dropdown.classList.add('visible');

        // Bind click handlers
        var self = this;
        var items = this.dropdown.querySelectorAll('.search-result');
        this._items = items;
        for (var j = 0; j < items.length; j++) {
            (function (el, idx) {
                el.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    self._activeIndex = idx;
                    self._selectActive();
                });
                el.addEventListener('mouseenter', function () {
                    self._setActive(idx);
                });
            })(items[j], j);
        }
    };

    BoothSearch.prototype._showRecent = function () {
        var recent = getRecentSearches();
        this._items = [];
        this._activeIndex = -1;

        if (recent.length === 0) {
            this._close();
            return;
        }

        var html = '<div class="search-dropdown-header">' +
            'Recent Searches' +
            '<button class="search-clear-btn" id="searchClearRecent">Clear</button>' +
        '</div>';

        for (var i = 0; i < recent.length; i++) {
            html += '<div class="search-recent-item" data-index="' + i + '" data-query="' + escapeHtml(recent[i]) + '">' +
                '<svg class="search-recent-icon" viewBox="0 0 24 24"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>' +
                escapeHtml(recent[i]) +
            '</div>';
        }

        this.dropdown.innerHTML = html;
        this.dropdown.classList.add('visible');

        var self = this;
        var items = this.dropdown.querySelectorAll('.search-recent-item');
        this._items = items;
        for (var j = 0; j < items.length; j++) {
            (function (el, idx) {
                el.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    self.input.value = el.getAttribute('data-query');
                    self._onSearch();
                });
                el.addEventListener('mouseenter', function () {
                    self._setActive(idx);
                });
            })(items[j], j);
        }

        var clearBtn = document.getElementById('searchClearRecent');
        if (clearBtn) {
            clearBtn.addEventListener('mousedown', function (e) {
                e.preventDefault();
                e.stopPropagation();
                clearRecentSearches();
                self._close();
            });
        }
    };

    BoothSearch.prototype._showInitial = function () {
        // If input is focused and empty, show recent
        if (this.input && document.activeElement === this.input && this.input.value.length < 2) {
            this._showRecent();
        }
    };

    BoothSearch.prototype._moveActive = function (dir) {
        if (!this._items.length) return;
        var newIdx = this._activeIndex + dir;
        if (newIdx < 0) newIdx = this._items.length - 1;
        if (newIdx >= this._items.length) newIdx = 0;
        this._setActive(newIdx);
    };

    BoothSearch.prototype._setActive = function (idx) {
        for (var i = 0; i < this._items.length; i++) {
            this._items[i].classList.toggle('active', i === idx);
        }
        this._activeIndex = idx;
        // Scroll into view
        if (this._items[idx]) {
            this._items[idx].scrollIntoView({ block: 'nearest' });
        }
    };

    BoothSearch.prototype._selectActive = function () {
        if (this._activeIndex < 0 || !this._items.length) return;

        var el = this._items[this._activeIndex];

        // Recent search item
        var recentQuery = el.getAttribute('data-query');
        if (recentQuery) {
            this.input.value = recentQuery;
            this._onSearch();
            return;
        }

        // Result item
        var sessionId = el.getAttribute('data-session-id');
        if (sessionId) {
            // Save to recent
            if (this._currentQuery) addRecentSearch(this._currentQuery);

            this._close();
            this.input.blur();

            // Navigate to session viewer
            if (this.onNavigate) {
                this.onNavigate(sessionId);
            } else {
                // Default: update URL hash and dispatch event
                window.location.hash = '#/session/' + encodeURIComponent(sessionId);
                window.dispatchEvent(new CustomEvent('boothapp:navigate-session', {
                    detail: { sessionId: sessionId }
                }));
            }
        }
    };

    BoothSearch.prototype._close = function () {
        if (this.dropdown) this.dropdown.classList.remove('visible');
        this._activeIndex = -1;
    };

    // Public API
    BoothSearch.prototype.focus = function () {
        if (this.input) { this.input.focus(); this.input.select(); }
    };

    BoothSearch.prototype.refresh = function () {
        dataLoaded = false;
        var self = this;
        loadSessions(function () {
            if (self._currentQuery) self._onSearch();
        });
    };

    // ------------------------------------------------------------------
    // EXPORT
    // ------------------------------------------------------------------
    root.BoothSearch = BoothSearch;

})(window);
