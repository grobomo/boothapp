'use strict';

/**
 * S3 Cache — in-memory LRU cache with batch listing and parallel fetches.
 *
 * Usage:
 *   const { S3Cache } = require('../infra/s3-cache');
 *   const cache = new S3Cache({ bucket: 'my-bucket', ttl: 60000, maxEntries: 500 });
 *   const sessions = await cache.listSessions();
 *   const detail = await cache.getSessionDetail('ABC123');
 */

const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SSE_PARAMS } = require('./lib/s3-encryption');

// ── LRU Cache ───────────────────────────────────────────────────────────────

class LRUCache {
  constructor(maxEntries) {
    this.max = maxEntries || 500;
    this.map = new Map(); // key -> { value, expiresAt }
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, ttl) {
    // Evict oldest if at capacity
    if (this.map.size >= this.max && !this.map.has(key)) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttl });
  }

  invalidate(key) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

// ── S3 Cache ────────────────────────────────────────────────────────────────

class S3Cache {
  /**
   * @param {object} opts
   * @param {string} opts.bucket - S3 bucket name
   * @param {string} [opts.region='us-east-1']
   * @param {number} [opts.ttl=60000] - Cache TTL in milliseconds
   * @param {number} [opts.maxEntries=500] - Max LRU cache entries
   */
  constructor(opts) {
    this.bucket = opts.bucket;
    this.region = opts.region || process.env.AWS_REGION || 'us-east-1';
    this.ttl = opts.ttl || parseInt(process.env.S3_CACHE_TTL, 10) || 60000;
    this.maxEntries = opts.maxEntries || 500;
    this.cache = new LRUCache(this.maxEntries);
    this._client = null;
  }

  get client() {
    if (!this._client) {
      this._client = new S3Client({ region: this.region });
    }
    return this._client;
  }

  // ── Timing helper ───────────────────────────────────────────────────────

  _log(operation, key, hit, durationMs) {
    const status = hit ? 'HIT' : 'MISS';
    console.log(`[s3-cache] ${operation} ${key || ''} ${status} ${durationMs}ms`);
  }

  // ── Raw S3 helpers ──────────────────────────────────────────────────────

  async _getObject(key) {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const result = await this.client.send(cmd);
    return result.Body.transformToString();
  }

  async _getJson(key) {
    const body = await this._getObject(key);
    return JSON.parse(body);
  }

  async _getJsonSafe(key) {
    try {
      return await this._getJson(key);
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.Code === 'NoSuchKey') return null;
      throw err;
    }
  }

  // ── List sessions (batch via ListObjectsV2 with prefix + delimiter) ─────

  async listSessions() {
    const cacheKey = '_sessions_list';
    const start = Date.now();

    const cached = this.cache.get(cacheKey);
    if (cached) {
      this._log('listSessions', '', true, Date.now() - start);
      return cached;
    }

    // Single ListObjectsV2 with delimiter gives us all session IDs
    const sessionIds = [];
    let continuationToken;

    do {
      const cmd = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: 'sessions/',
        Delimiter: '/',
        ContinuationToken: continuationToken,
      });
      const result = await this.client.send(cmd);
      const prefixes = result.CommonPrefixes || [];
      for (const p of prefixes) {
        const id = p.Prefix.replace('sessions/', '').replace(/\/$/, '');
        if (id) sessionIds.push(id);
      }
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);

    // Fetch metadata for all sessions in parallel
    const sessions = await Promise.all(
      sessionIds.map(async (id) => {
        try {
          const meta = await this._getCachedJson(`sessions/${id}/metadata.json`);
          return meta ? { session_id: id, ...meta } : { session_id: id, status: 'unknown' };
        } catch (err) {
          return { session_id: id, status: 'error', error: err.message };
        }
      })
    );

    // Sort by started_at descending (newest first)
    sessions.sort((a, b) => {
      const ta = a.started_at || '';
      const tb = b.started_at || '';
      return tb.localeCompare(ta);
    });

    this.cache.set(cacheKey, sessions, this.ttl);
    this._log('listSessions', `${sessions.length} sessions`, false, Date.now() - start);
    return sessions;
  }

  // ── Get single cached JSON object ───────────────────────────────────────

  async _getCachedJson(key) {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const data = await this._getJsonSafe(key);
    if (data !== null) {
      this.cache.set(key, data, this.ttl);
    }
    return data;
  }

  // ── Session detail (parallel fetch of all artifacts) ────────────────────

  async getSessionDetail(sessionId) {
    const cacheKey = `_detail_${sessionId}`;
    const start = Date.now();

    const cached = this.cache.get(cacheKey);
    if (cached) {
      this._log('getSessionDetail', sessionId, true, Date.now() - start);
      return cached;
    }

    const prefix = `sessions/${sessionId}`;

    // Fetch all artifacts in parallel
    const [metadata, clicks, transcript, analysis] = await Promise.all([
      this._getCachedJson(`${prefix}/metadata.json`),
      this._getCachedJson(`${prefix}/clicks/clicks.json`),
      this._getCachedJson(`${prefix}/transcript/transcript.json`),
      this._getCachedJson(`${prefix}/output/summary.json`),
    ]);

    const detail = {
      session_id: sessionId,
      metadata: metadata || {},
      clicks: clicks || { events: [] },
      transcript: transcript || { entries: [] },
      analysis: analysis || null,
    };

    this.cache.set(cacheKey, detail, this.ttl);
    this._log('getSessionDetail', sessionId, false, Date.now() - start);
    return detail;
  }

  // ── List files in a session (for screenshots, etc.) ─────────────────────

  async listSessionFiles(sessionId, subfolder) {
    const cacheKey = `_files_${sessionId}_${subfolder || 'root'}`;
    const start = Date.now();

    const cached = this.cache.get(cacheKey);
    if (cached) {
      this._log('listSessionFiles', cacheKey, true, Date.now() - start);
      return cached;
    }

    const prefix = subfolder
      ? `sessions/${sessionId}/${subfolder}/`
      : `sessions/${sessionId}/`;

    const files = [];
    let continuationToken;

    do {
      const cmd = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const result = await this.client.send(cmd);
      for (const obj of (result.Contents || [])) {
        files.push({
          key: obj.Key,
          size: obj.Size,
          last_modified: obj.LastModified,
        });
      }
      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);

    this.cache.set(cacheKey, files, this.ttl);
    this._log('listSessionFiles', `${sessionId}/${subfolder || '*'} (${files.length})`, false, Date.now() - start);
    return files;
  }

  // ── Write JSON to S3 ─────────────────────────────────────────────────────

  async _putJson(key, data) {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: JSON.stringify(data, null, 2),
      ContentType: 'application/json',
      ...SSE_PARAMS,
    });
    await this.client.send(cmd);
    // Invalidate caches that include this key
    this.cache.invalidate(key);
  }

  async updateSessionTags(sessionId, tags) {
    const key = `sessions/${sessionId}/metadata.json`;
    const meta = await this._getCachedJson(key) || {};
    meta.tags = Array.isArray(tags) ? tags : [];
    await this._putJson(key, meta);
    // Invalidate session list cache so next fetch picks up new tags
    this.cache.invalidate('_sessions_list');
    this.cache.invalidate(`_detail_${sessionId}`);
    return meta.tags;
  }

  // ── Cache stats ─────────────────────────────────────────────────────────

  stats() {
    return {
      entries: this.cache.size,
      maxEntries: this.maxEntries,
      ttl: this.ttl,
    };
  }
}

module.exports = { S3Cache, LRUCache };
