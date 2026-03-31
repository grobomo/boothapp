'use strict';

var VALID_STATUSES = ['pending', 'processing', 'complete', 'error'];

/**
 * Validate a session object. Returns { valid, errors, warnings }.
 */
function validateSession(session) {
    var errors = [];
    var warnings = [];

    if (!session || typeof session !== 'object') {
        return { valid: false, errors: ['Session must be a non-null object'], warnings: [] };
    }

    // Metadata
    if (!session.metadata || typeof session.metadata !== 'object') {
        errors.push('Missing or invalid metadata');
    } else {
        if (!session.metadata.sessionId) errors.push('metadata.sessionId is required');
        if (!session.metadata.visitorName) errors.push('metadata.visitorName is required');
        if (!session.metadata.company) errors.push('metadata.company is required');
    }

    // Status
    if (!session.status) {
        errors.push('Missing status');
    } else if (VALID_STATUSES.indexOf(session.status) === -1) {
        errors.push('Invalid status: ' + session.status + '. Must be one of: ' + VALID_STATUSES.join(', '));
    }

    // Events
    if (!Array.isArray(session.events)) {
        errors.push('events must be an array');
    } else if (session.events.length === 0) {
        errors.push('events array must not be empty');
    } else {
        // Check timestamps on events
        var prevTs = -Infinity;
        for (var i = 0; i < session.events.length; i++) {
            var evt = session.events[i];
            if (!evt.timestamp && evt.timestamp !== 0) {
                errors.push('Event at index ' + i + ' is missing a timestamp');
            } else {
                if (evt.timestamp < prevTs) {
                    warnings.push('Events are not in chronological order at index ' + i);
                }
                prevTs = evt.timestamp;
            }
        }
    }

    return { valid: errors.length === 0, errors: errors, warnings: warnings };
}

/**
 * Validate a transcript object. Returns { valid, errors, warnings }.
 */
function validateTranscript(transcript) {
    var errors = [];
    var warnings = [];

    if (!transcript || typeof transcript !== 'object') {
        return { valid: false, errors: ['Transcript must be a non-null object'], warnings: [] };
    }

    if (!transcript.sessionId) {
        errors.push('sessionId is required');
    }

    if (!Array.isArray(transcript.entries)) {
        errors.push('entries must be an array');
    } else if (transcript.entries.length === 0) {
        errors.push('entries array must not be empty');
    } else {
        for (var i = 0; i < transcript.entries.length; i++) {
            var entry = transcript.entries[i];
            if (!entry.timestamp && entry.timestamp !== 0) {
                errors.push('Entry at index ' + i + ' is missing a timestamp');
            }
            if (!entry.text && entry.text !== '') {
                errors.push('Entry at index ' + i + ' is missing text');
            }
        }
    }

    return { valid: errors.length === 0, errors: errors, warnings: warnings };
}

module.exports = { validateSession: validateSession, validateTranscript: validateTranscript, VALID_STATUSES: VALID_STATUSES };
