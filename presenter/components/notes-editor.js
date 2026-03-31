/**
 * Notes Editor Component
 *
 * A self-contained notes editor that loads/saves session notes via the
 * presenter API. Notes are stored in S3 at sessions/<id>/notes.json.
 *
 * Usage:
 *   <div id="notes-container"></div>
 *   <script src="components/notes-editor.js"></script>
 *   <script>
 *     NotesEditor.init('notes-container', { sessionId: 'abc-123' });
 *   </script>
 */
var NotesEditor = (function () {
    'use strict';

    // ---- state ----
    var _container = null;
    var _sessionId = null;
    var _notes = [];
    var _statusEl = null;
    var _listEl = null;
    var _textareaEl = null;
    var _apiBase = '';

    // ---- helpers ----

    function getAuthor() {
        var author = localStorage.getItem('boothapp_author');
        if (!author) {
            author = 'Anonymous SE';
        }
        return author;
    }

    function setAuthor(name) {
        localStorage.setItem('boothapp_author', name);
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatTimestamp(iso) {
        var d = new Date(iso);
        return d.toLocaleString(undefined, {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    function setStatus(text, type) {
        if (!_statusEl) return;
        _statusEl.textContent = text;
        _statusEl.className = 'notes-status notes-status--' + (type || 'info');
    }

    // ---- API ----

    function loadNotes(callback) {
        var url = _apiBase + '/api/sessions/' + encodeURIComponent(_sessionId) + '/notes';
        fetch(url)
            .then(function (r) {
                if (r.status === 404) return { notes: [] };
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                _notes = data.notes || [];
                callback(null, _notes);
            })
            .catch(function (err) {
                callback(err, []);
            });
    }

    function saveNote(note, callback) {
        var url = _apiBase + '/api/sessions/' + encodeURIComponent(_sessionId) + '/notes';
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(note)
        })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                _notes = data.notes || [];
                callback(null, _notes);
            })
            .catch(function (err) {
                callback(err);
            });
    }

    // ---- rendering ----

    function renderNotesList() {
        if (!_listEl) return;
        if (_notes.length === 0) {
            _listEl.innerHTML = '<div class="notes-empty">No notes yet. Add context the AI analysis might miss.</div>';
            return;
        }
        // Sort chronologically (oldest first)
        var sorted = _notes.slice().sort(function (a, b) {
            return new Date(a.timestamp) - new Date(b.timestamp);
        });
        var html = '';
        for (var i = 0; i < sorted.length; i++) {
            var n = sorted[i];
            html += '<div class="notes-item">' +
                '<div class="notes-item-header">' +
                    '<span class="notes-item-author">' + escapeHtml(n.author || 'Unknown') + '</span>' +
                    '<span class="notes-item-time">' + escapeHtml(formatTimestamp(n.timestamp)) + '</span>' +
                '</div>' +
                '<div class="notes-item-content">' + escapeHtml(n.content) + '</div>' +
            '</div>';
        }
        _listEl.innerHTML = html;
        _listEl.scrollTop = _listEl.scrollHeight;
    }

    function buildUI(containerId) {
        _container = document.getElementById(containerId);
        if (!_container) return;

        var author = getAuthor();

        _container.innerHTML =
            '<div class="notes-editor">' +
                '<div class="notes-header">' +
                    '<div class="notes-title">Session Notes</div>' +
                    '<span class="notes-status notes-status--info" id="notesStatus"></span>' +
                '</div>' +
                '<div class="notes-author-row">' +
                    '<label class="notes-author-label">Your name:</label>' +
                    '<input type="text" class="notes-author-input" id="notesAuthor" ' +
                        'value="' + escapeHtml(author) + '" placeholder="Enter your name" />' +
                '</div>' +
                '<div class="notes-list" id="notesList"></div>' +
                '<div class="notes-input-row">' +
                    '<textarea class="notes-textarea" id="notesTextarea" ' +
                        'placeholder="Add a note... (context, observations, key takeaways)" rows="3"></textarea>' +
                    '<button class="notes-submit" id="notesSubmit">Add Note</button>' +
                '</div>' +
            '</div>';

        _statusEl = document.getElementById('notesStatus');
        _listEl = document.getElementById('notesList');
        _textareaEl = document.getElementById('notesTextarea');

        // Wire up author persistence
        var authorInput = document.getElementById('notesAuthor');
        authorInput.addEventListener('change', function () {
            setAuthor(authorInput.value.trim());
        });

        // Wire up submit
        document.getElementById('notesSubmit').addEventListener('click', submitNote);

        // Ctrl+Enter to submit
        _textareaEl.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submitNote();
            }
        });
    }

    function submitNote() {
        var content = _textareaEl.value.trim();
        if (!content) return;

        var authorInput = document.getElementById('notesAuthor');
        var author = authorInput.value.trim() || 'Anonymous SE';
        setAuthor(author);

        var note = {
            timestamp: new Date().toISOString(),
            author: author,
            content: content
        };

        setStatus('Saving...', 'saving');
        _textareaEl.value = '';

        saveNote(note, function (err) {
            if (err) {
                setStatus('Save failed', 'error');
                _textareaEl.value = content;
                return;
            }
            setStatus('Saved', 'success');
            renderNotesList();
            setTimeout(function () { setStatus('', 'info'); }, 2000);
        });
    }

    // ---- CSS injection ----

    function injectStyles() {
        if (document.getElementById('notes-editor-styles')) return;
        var style = document.createElement('style');
        style.id = 'notes-editor-styles';
        style.textContent =
            '.notes-editor {' +
                'background: var(--surface, #0E1118);' +
                'border: 1px solid var(--border, #1E2330);' +
                'border-radius: 12px;' +
                'padding: 20px;' +
                'margin-top: 24px;' +
            '}' +
            '.notes-header {' +
                'display: flex;' +
                'align-items: center;' +
                'justify-content: space-between;' +
                'margin-bottom: 16px;' +
            '}' +
            '.notes-title {' +
                'font-size: 14px;' +
                'font-weight: 700;' +
                'text-transform: uppercase;' +
                'letter-spacing: 2px;' +
                'color: var(--text-dim, #6B7385);' +
            '}' +
            '.notes-status { font-size: 12px; font-weight: 500; }' +
            '.notes-status--info { color: var(--text-dim, #6B7385); }' +
            '.notes-status--saving { color: var(--amber, #FFAB00); }' +
            '.notes-status--success { color: var(--success, #00E676); }' +
            '.notes-status--error { color: #FF5252; }' +
            '.notes-author-row {' +
                'display: flex; align-items: center; gap: 8px; margin-bottom: 16px;' +
            '}' +
            '.notes-author-label {' +
                'font-size: 13px; color: var(--text-dim, #6B7385); white-space: nowrap;' +
            '}' +
            '.notes-author-input {' +
                'background: var(--surface2, #151920); border: 1px solid var(--border, #1E2330);' +
                'border-radius: 6px; color: var(--text, #F0F2F5); padding: 6px 10px;' +
                'font-size: 13px; width: 200px;' +
            '}' +
            '.notes-list { max-height: 300px; overflow-y: auto; margin-bottom: 16px; }' +
            '.notes-list::-webkit-scrollbar { width: 4px; }' +
            '.notes-list::-webkit-scrollbar-track { background: transparent; }' +
            '.notes-list::-webkit-scrollbar-thumb { background: var(--border, #1E2330); border-radius: 2px; }' +
            '.notes-empty {' +
                'color: var(--text-dim, #6B7385); font-size: 13px; font-style: italic; padding: 12px 0;' +
            '}' +
            '.notes-item {' +
                'padding: 12px; background: var(--surface2, #151920); border-radius: 8px; margin-bottom: 8px;' +
            '}' +
            '.notes-item-header {' +
                'display: flex; justify-content: space-between; margin-bottom: 6px;' +
            '}' +
            '.notes-item-author { font-size: 12px; font-weight: 600; color: var(--blue, #448AFF); }' +
            '.notes-item-time { font-size: 11px; color: var(--text-dim, #6B7385); }' +
            '.notes-item-content {' +
                'font-size: 14px; color: var(--text, #F0F2F5); line-height: 1.5; white-space: pre-wrap;' +
            '}' +
            '.notes-input-row { display: flex; gap: 8px; align-items: flex-end; }' +
            '.notes-textarea {' +
                'flex: 1; background: var(--surface2, #151920); border: 1px solid var(--border, #1E2330);' +
                'border-radius: 8px; color: var(--text, #F0F2F5); padding: 10px 12px;' +
                'font-size: 14px; font-family: inherit; resize: vertical; min-height: 60px;' +
            '}' +
            '.notes-textarea:focus { outline: none; border-color: var(--blue, #448AFF); }' +
            '.notes-submit {' +
                'background: var(--red, #D71920); color: #FFF; border: none; border-radius: 8px;' +
                'padding: 10px 20px; font-size: 13px; font-weight: 600; cursor: pointer;' +
                'white-space: nowrap; transition: background 0.2s;' +
            '}' +
            '.notes-submit:hover { background: var(--red-dark, #A8131A); }';
        document.head.appendChild(style);
    }

    // ---- public API ----

    function init(containerId, options) {
        options = options || {};
        _sessionId = options.sessionId;
        _apiBase = options.apiBase || '';

        if (!_sessionId) {
            console.error('NotesEditor: sessionId is required');
            return;
        }

        injectStyles();
        buildUI(containerId);
        setStatus('Loading...', 'info');

        loadNotes(function (err) {
            if (err) {
                setStatus('Could not load notes', 'error');
            } else {
                setStatus('', 'info');
            }
            renderNotesList();
        });
    }

    function getNotes() {
        return _notes.slice();
    }

    return { init: init, getNotes: getNotes };
})();
