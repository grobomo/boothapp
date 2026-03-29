'use strict';
/**
 * Tenant pool interface.
 *
 * Pool state lives in S3:
 *   tenant-pool/tenants.json       — list of all tenants with status
 *   tenant-pool/locks/<tenant-id>  — atomic lock; presence = claimed
 *
 * Claiming uses S3 conditional put (IfNoneMatch: '*') so two simultaneous
 * session starts cannot claim the same tenant. inf-03 will manage pool
 * replenishment; this module only claims and records releases.
 */
const { putObject, getObject, deleteObject } = require('./s3');

const POOL_KEY = 'tenant-pool/tenants.json';

async function getPool() {
  try {
    return await getObject(POOL_KEY);
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NoSuchKey') {
      return { tenants: [] };
    }
    throw err;
  }
}

/**
 * Attempt to atomically claim the first available tenant for sessionId.
 * Returns tenant info object on success, null if pool is empty.
 */
async function claimTenant(sessionId) {
  const pool = await getPool();
  const available = pool.tenants.filter(t => t.status === 'available');

  if (available.length === 0) return null;

  for (const tenant of available) {
    const lockKey = `tenant-pool/locks/${tenant.tenant_id}`;
    try {
      // Atomic: fails with 412 if lock already exists
      await putObject(lockKey, { session_id: sessionId, claimed_at: new Date().toISOString() }, { ifNoneMatch: true });
      return buildTenantRecord(tenant, sessionId);
    } catch (err) {
      if (err.$metadata?.httpStatusCode === 412) continue; // race — try next
      throw err;
    }
  }

  return null; // all candidates lost to concurrent claims
}

function buildTenantRecord(tenant, sessionId) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return {
    session_id: sessionId,
    tenant_url: tenant.tenant_url,
    tenant_id: tenant.tenant_id,
    login_email: tenant.login_email,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    status: 'active',
  };
}

/**
 * Record a tenant release so inf-03 can reclaim it.
 * Does NOT delete the lock — inf-03 manages pool replenishment lifecycle.
 */
async function releaseTenant(tenantId, sessionId) {
  await putObject(`tenant-pool/released/${tenantId}.json`, {
    tenant_id: tenantId,
    session_id: sessionId,
    released_at: new Date().toISOString(),
  });
}

module.exports = { claimTenant, releaseTenant, getPool };
