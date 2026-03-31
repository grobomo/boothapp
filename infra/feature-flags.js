/**
 * BoothApp Feature Flags
 *
 * Browser-compatible feature flag system. Flags load from localStorage
 * (persisted across reloads) with fallback to built-in defaults.
 * Optional S3 sync for multi-device flag coordination.
 */
(function (root) {
    'use strict';

    var STORAGE_KEY = 'boothapp_feature_flags';

    // Built-in defaults (mirrors flags.json)
    var DEFAULTS = {
        audio_recording: true,
        badge_ocr: true,
        competitive_analysis: true,
        email_drafts: true,
        cost_estimation: false
    };

    var _flags = null;

    // ---- Internal helpers ------------------------------------------------

    function _load() {
        if (_flags) return _flags;
        try {
            var stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                _flags = JSON.parse(stored);
                // Merge any new defaults that weren't in storage
                Object.keys(DEFAULTS).forEach(function (k) {
                    if (_flags[k] === undefined) _flags[k] = DEFAULTS[k];
                });
            } else {
                _flags = JSON.parse(JSON.stringify(DEFAULTS));
            }
        } catch (e) {
            _flags = JSON.parse(JSON.stringify(DEFAULTS));
        }
        return _flags;
    }

    function _save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_flags));
        } catch (e) {
            // localStorage unavailable -- flags still work in-memory
        }
    }

    // ---- Public API ------------------------------------------------------

    /** Get a single flag value. Returns false for unknown flags. */
    function getFlag(name) {
        var flags = _load();
        return flags[name] === true;
    }

    /** Set a single flag value. */
    function setFlag(name, value) {
        var flags = _load();
        flags[name] = !!value;
        _save();
        // Dispatch event so UI can react
        if (typeof CustomEvent !== 'undefined') {
            window.dispatchEvent(new CustomEvent('boothapp:flagchange', {
                detail: { name: name, value: !!value }
            }));
        }
    }

    /** Get all flags as a plain object (copy). */
    function getAllFlags() {
        var flags = _load();
        return JSON.parse(JSON.stringify(flags));
    }

    /** Reset all flags to defaults and clear localStorage. */
    function resetFlags() {
        _flags = JSON.parse(JSON.stringify(DEFAULTS));
        _save();
        if (typeof CustomEvent !== 'undefined') {
            window.dispatchEvent(new CustomEvent('boothapp:flagchange', {
                detail: { name: '*', value: null }
            }));
        }
    }

    /** Get the built-in defaults (read-only copy). */
    function getDefaults() {
        return JSON.parse(JSON.stringify(DEFAULTS));
    }

    /**
     * Sync flags to/from S3 via a presigned URL or API Gateway endpoint.
     * @param {string} endpoint - URL to PUT/GET flags JSON
     * @param {'push'|'pull'} direction - push local to S3, or pull S3 to local
     * @returns {Promise}
     */
    function syncS3(endpoint, direction) {
        if (!endpoint) return Promise.reject(new Error('No S3 endpoint configured'));

        if (direction === 'push') {
            return fetch(endpoint, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(_load())
            }).then(function (r) {
                if (!r.ok) throw new Error('S3 push failed: ' + r.status);
                return getAllFlags();
            });
        }

        // pull
        return fetch(endpoint)
            .then(function (r) {
                if (!r.ok) throw new Error('S3 pull failed: ' + r.status);
                return r.json();
            })
            .then(function (remote) {
                _flags = remote;
                // Ensure all defaults exist
                Object.keys(DEFAULTS).forEach(function (k) {
                    if (_flags[k] === undefined) _flags[k] = DEFAULTS[k];
                });
                _save();
                if (typeof CustomEvent !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('boothapp:flagchange', {
                        detail: { name: '*', value: null }
                    }));
                }
                return getAllFlags();
            });
    }

    // ---- Export -----------------------------------------------------------

    var FeatureFlags = {
        getFlag: getFlag,
        setFlag: setFlag,
        getAllFlags: getAllFlags,
        resetFlags: resetFlags,
        getDefaults: getDefaults,
        syncS3: syncS3,
        STORAGE_KEY: STORAGE_KEY
    };

    // Browser global
    root.FeatureFlags = FeatureFlags;

    // CommonJS / Node
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FeatureFlags;
    }

})(typeof window !== 'undefined' ? window : this);
