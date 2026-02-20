/**
 * WebSocket: download-queue progress. Backend polls the downloader and pushes to connected clients.
 * Path: /ws/download-queue/progress?token=<JWT>
 * Auth: token must be valid JWT for an admin user. Unauthorized connections are closed.
 */

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const userModel = require('../model/user.model');
const DownloadQueueModel = require('../model/downloadQueue.model');
const { getPosterUrl } = require('../helper/movietv.helper');
const { URL } = require('url');

const DOWNLOADER_URL = (process.env.DOWNLOADER_URL || '').replace(/\/$/, '');
const POLL_INTERVAL_MS = 1000;

/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();
/** @type {NodeJS.Timeout | null} */
let pollInterval = null;

async function buildPayload() {
  try {
    if (!DOWNLOADER_URL) {
      return { phase: 'idle', download: {}, upload: {}, message: 'DOWNLOADER_URL not set' };
    }
    const r = await axios.get(`${DOWNLOADER_URL}/status`, { timeout: 5000 });
    const data = r.data || {};
    const jobId = data.jobId;
    if (jobId) {
      const job = await DownloadQueueModel.findOne({ jobId: String(jobId) }).lean();
      if (job) {
        data.job = { ...job, poster_url: getPosterUrl(job.poster_path, 'w200') || null };
      }
    }
    return data;
  } catch (err) {
    const message = err.response?.data?.message || err.message || 'Downloader unreachable';
    return { phase: 'idle', download: {}, upload: {}, error: message };
  }
}

function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(async () => {
    if (clients.size === 0) return;
    const payload = await buildPayload();
    broadcast(payload);
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === 1) {
      try {
        ws.send(payload);
      } catch (e) {
        // ignore
      }
    }
  }
}

/**
 * Verify token and return true if admin. Closes ws and returns false if invalid.
 * @param {string} token
 * @param {import('ws').WebSocket} ws
 * @returns {Promise<boolean>}
 */
async function verifyAdminAndAccept(token, ws) {
  if (!token) {
    ws.close(4401, 'Missing token');
    return false;
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await userModel.findById(decoded.id);
    if (!user || user.isActive !== true || user.isAdmin !== true) {
      ws.close(4403, 'Forbidden');
      return false;
    }
  } catch (err) {
    ws.close(4401, err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token');
    return false;
  }
  return true;
}

/**
 * @param {import('http').Server} server
 */
function attachDownloadQueueProgressWs(server) {
  const wss = new WebSocketServer({ server, path: '/ws/download-queue/progress' });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token') || '';

    if (!(await verifyAdminAndAccept(token, ws))) return;

    clients.add(ws);
    startPolling();

    // Send initial state immediately (same shape as poll: downloader progress + job from DB)
    buildPayload().then((payload) => {
      try {
        ws.send(JSON.stringify(payload));
      } catch (e) {
        // ignore
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      if (clients.size === 0) stopPolling();
    });

    ws.on('error', () => {
      clients.delete(ws);
      if (clients.size === 0) stopPolling();
    });
  });
}

module.exports = { attachDownloadQueueProgressWs };
