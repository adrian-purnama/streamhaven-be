/**
 * Redis cache helper – key structure and get/set/del.
 *
 * KEY STRUCTURE (namespace : resource : id?)
 *   All keys use a prefix to avoid collisions (e.g. multiple apps on same Redis).
 *
 *   {prefix}:branding     – public branding (appName, logoUrl). Invalidate when system config changes.
 *   {prefix}:system       – full system config. Invalidate on PUT /api/system.
 *   {prefix}:user:{id}    – user document (no password). Invalidate when that user is updated.
 *
 * USAGE
 *   1. Set a Redis client: setRedisClient(redisClient).
 *   2. On read: value = await cache.get(keys.branding()); if (!value) { value = await loadFromDb(); await cache.set(keys.branding(), value, ttl); }
 *   3. On update: after saving to DB, call cache.del(keys.branding()) (or the key you cache).
 *
 * Without a Redis client, get() returns null (cache miss) and set/del are no-ops so the app still runs.
 */

const PREFIX = process.env.REDIS_PREFIX || 'streamhaven';

const keys = {
  branding: () => `${PREFIX}:branding`,
  system: () => `${PREFIX}:system`,
  user: (id) => `${PREFIX}:user:${id}`,
};

let redisClient = null;

function setRedisClient(client) {
  redisClient = client;
}

async function get(key) {
  if (!redisClient) return null;
  try {
    const raw = await redisClient.get(key);
    if (raw == null) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.error('[cache] get error', key, err.message);
    return null;
  }
}

async function set(key, value, ttlSeconds = 3600) {
  if (!redisClient) return;
  try {
    const serialized = JSON.stringify(value);
    if (ttlSeconds > 0) {
      await redisClient.setEx(key, ttlSeconds, serialized);
    } else {
      await redisClient.set(key, serialized);
    }
  } catch (err) {
    console.error('[cache] set error', key, err.message);
  }
}

async function del(key) {
  if (!redisClient) return;
  try {
    await redisClient.del(key);
  } catch (err) {
    console.error('[cache] del error', key, err.message);
  }
}

/** Delete multiple keys (e.g. keys matching a pattern). Pass an array of key strings. */
async function delMany(keyList) {
  if (!redisClient || !keyList?.length) return;
  try {
    await redisClient.del(keyList);
  } catch (err) {
    console.error('[cache] delMany error', err.message);
  }
}

module.exports = {
  keys,
  setRedisClient,
  get,
  set,
  del,
  delMany,
};
