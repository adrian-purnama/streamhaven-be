const express = require('express');
const axios = require('axios');
const { validateToken, validateAdmin } = require('../helper/validate.helper');
const { getPosterUrl } = require('../helper/movietv.helper');
const { tryStartDownloadJob, endDownloadJob, isDownloadJobRunning } = require('../helper/stagingProcessState.helper');
const DownloadQueueModel = require('../model/downloadQueue.model');

const router = express.Router();

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const DOWNLOADER_URL = (process.env.DOWNLOADER_URL || '').replace(/\/$/, '');
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const START_NEXT_DELAY_MS = 10000;
const DOWNLOADER_RETRY_ATTEMPTS = 3;
const DOWNLOADER_RETRY_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------------
// Webhook auth — downloader must send X-Webhook-Secret (or body.webhookSecret)
// -----------------------------------------------------------------------------

function checkWebhookSecret(req, res, next) {
  const secret = req.headers['x-webhook-secret'] || req.body?.webhookSecret;
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    console.log('[download-queue] webhook rejected: invalid or missing X-Webhook-Secret (check WEBHOOK_SECRET matches downloader .env)');
    return res.status(401).json({ success: false, message: 'Invalid webhook secret' });
  }
  next();
}

// -----------------------------------------------------------------------------
// startNextWaitingJob — pick next waiting job, call downloader, mark failed on error.
// Used by POST /process/start and by webhooks (upload-done, failed). No auto-retry
// of the same job; frontend can "Process waiting" again.
// -----------------------------------------------------------------------------

async function startNextWaitingJob() {
  // — Pick next job (oldest waiting)
  const next = await DownloadQueueModel.findOne({ status: 'waiting' }).sort({ createdAt: 1 }).lean();
  if (!next) {
    console.log('[download-queue] startNextWaitingJob: no waiting job');
    return null;
  }

  const jobId = next.jobId || next._id.toString();

  // — Claim "one job running" lock; skip if another job already running
  if (!tryStartDownloadJob(jobId)) {
    console.log('[download-queue] startNextWaitingJob: job already running, skipping');
    return null;
  }

  // — Mark job as downloading in DB
  console.log('[download-queue] startNextWaitingJob: starting', jobId, next.title);
  await DownloadQueueModel.updateOne({ _id: next._id }, { $set: { jobId, status: 'downloading' } });

  // — If no downloader URL, mark job failed and release lock
  if (!DOWNLOADER_URL) {
    endDownloadJob();
    await DownloadQueueModel.updateOne(
      { _id: next._id },
      { $set: { status: 'failed', errorMessage: 'DOWNLOADER_URL not set' } }
    );
    console.log('[download-queue] startNextWaitingJob: DOWNLOADER_URL not set');
    return null;
  }

  // — Build request to downloader POST /download
  const url = `${DOWNLOADER_URL}/download`;
  const body = { jobId, title: next.title };
  if (next.tmdbId != null) body.tmdbId = next.tmdbId;
  if (next.poster_path) body.poster_path = next.poster_path;

  // — Call downloader with retries (503/502/504/ECONNRESET/ETIMEDOUT → retry)
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOADER_RETRY_ATTEMPTS; attempt++) {
    try {
      // refetch with timeout 5000 for clear job in downloader
      await axios.post(url, body, { timeout: 5000 });
      console.log('[download-queue] startNextWaitingJob: downloader accepted', jobId);
      return await DownloadQueueModel.findById(next._id).lean();
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const isRetryable = status === 503 || status === 502 || status === 504 || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
      if (isRetryable && attempt < DOWNLOADER_RETRY_ATTEMPTS) {
        console.log('[download-queue] startNextWaitingJob: attempt', attempt, 'failed', err.message, '- retrying in', DOWNLOADER_RETRY_DELAY_MS, 'ms');
        await sleep(DOWNLOADER_RETRY_DELAY_MS);
      } else {
        break;
      }
    }
  }

  // — All attempts failed: release lock, mark job failed, return null
  const errorMessage = lastError?.response?.data?.message || lastError?.message || 'Downloader call failed';
  console.log('[download-queue] startNextWaitingJob: downloader failed', errorMessage);
  endDownloadJob();
  await DownloadQueueModel.updateOne(
    { _id: next._id },
    { $set: { status: 'failed', errorMessage } }
  );
  return null;
}

// -----------------------------------------------------------------------------
// GET / — List queue (optional ?status=, ?limit=, ?skip=)
// -----------------------------------------------------------------------------

router.get('/', validateToken, validateAdmin, async (req, res) => {
  try {
    // await markStuckDownloadQueueJobs();
    const status = req.query.status?.trim() || null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
    const query = status ? { status } : {};
    const rawList = await DownloadQueueModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
    const total = await DownloadQueueModel.countDocuments(query);
    const list = rawList.map((item) => ({
      ...item,
      poster_url: getPosterUrl(item.poster_path, 'w200') || null,
    }));
    return res.json({ success: true, data: { list, total } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST / — Add item to queue (body: title, tmdbId?, poster_path?, year?)
// -----------------------------------------------------------------------------

router.post('/', validateToken, validateAdmin, async (req, res) => {
  try {
    const { title, tmdbId, poster_path, year } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, message: 'title required' });
    }
    const doc = await DownloadQueueModel.create({
      title: title.trim(),
      tmdbId: tmdbId != null ? Number(tmdbId) : null,
      poster_path: poster_path != null && String(poster_path).trim() ? String(poster_path).trim() : null,
      year: year != null ? Number(year) : null,
      status: 'pending',
    });
    return res.status(201).json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------------
// DELETE /:id — Remove item (only if pending or waiting; not while downloading/uploading)
// -----------------------------------------------------------------------------

router.delete('/:id', validateToken, validateAdmin, async (req, res) => {
  try {
    const doc = await DownloadQueueModel.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Queue item not found' });
    if (doc.status === 'downloading' || doc.status === 'uploading') {
      return res.status(400).json({ success: false, message: 'Cannot delete while downloading or uploading' });
    }
    await DownloadQueueModel.deleteOne({ _id: req.params.id });
    return res.json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------------
// GET /job/:jobId — Get single job by jobId (for polling progress)
// -----------------------------------------------------------------------------

router.get('/job/:jobId', validateToken, validateAdmin, async (req, res) => {
  try {
    const doc = await DownloadQueueModel.findOne({ jobId: req.params.jobId }).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Job not found' });
    const data = { ...doc, poster_url: getPosterUrl(doc.poster_path, 'w200') || null };
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /process — Move all pending → waiting (assign jobId to each)
// -----------------------------------------------------------------------------

router.post('/process', validateToken, validateAdmin, async (req, res) => {
  try {
    const pending = await DownloadQueueModel.find({ status: 'pending' }).sort({ createdAt: 1 }).lean();
    for (const doc of pending) {
      await DownloadQueueModel.updateOne(
        { _id: doc._id },
        { $set: { status: 'waiting', jobId: doc._id.toString() } }
      );
    }
    return res.json({ success: true, data: { moved: pending.length } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /process/start — Start next waiting job (call downloader). Returns 404 if no waiting jobs.
// -----------------------------------------------------------------------------

router.post('/process/start', validateToken, validateAdmin, async (req, res) => {
  try {
    if (isDownloadJobRunning()) {
      return res.json({ success: true, message: 'Job already in progress', data: null });
    }
    const started = await startNextWaitingJob();
    if (!started) {
      return res.status(404).json({ success: false, message: 'No waiting jobs' });
    }
    const data = { ...started, poster_url: getPosterUrl(started.poster_path, 'w200') || null };
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------------
// Webhooks (called by Python; require X-Webhook-Secret). No retry from backend; Python may retry.
// -----------------------------------------------------------------------------

// POST /webhook/download-done — Job finished downloading, now uploading to staging
router.post('/webhook/download-done', checkWebhookSecret, express.json(), async (req, res) => {
  try {
    const { jobId } = req.body || {};
    if (!jobId) return res.status(400).json({ success: false, message: 'jobId required' });
    const doc = await DownloadQueueModel.findOneAndUpdate(
      { jobId: String(jobId) },
      { $set: { status: 'uploading' } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ success: false, message: 'Job not found' });
    return res.json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /webhook/upload-progress — Chunk/writing progress (chunkIndex, totalChunks, progress?)
router.post('/webhook/upload-progress', checkWebhookSecret, express.json(), async (req, res) => {
  try {
    const { jobId, chunkIndex, totalChunks, progress } = req.body || {};
    if (!jobId) return res.status(400).json({ success: false, message: 'jobId required' });
    const update = {};
    if (chunkIndex != null) update.uploadChunkIndex = Number(chunkIndex);
    if (totalChunks != null) update.uploadChunkTotal = Number(totalChunks);
    if (progress != null) update.uploadProgress = Math.min(100, Math.max(0, Number(progress)));
    if (Object.keys(update).length === 0) return res.json({ success: true });
    const doc = await DownloadQueueModel.findOneAndUpdate(
      { jobId: String(jobId) },
      { $set: update },
      { new: true }
    );
    if (!doc) return res.status(404).json({ success: false, message: 'Job not found' });
    return res.json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /webhook/upload-done — Job finished uploading to staging; schedule next waiting job after delay
router.post('/webhook/upload-done', checkWebhookSecret, express.json(), async (req, res) => {
  try {
    const { jobId, stagingId } = req.body || {};
    if (!jobId) return res.status(400).json({ success: false, message: 'jobId required' });
    console.log('[download-queue] webhook upload-done received', jobId);
    const doc = await DownloadQueueModel.findOneAndUpdate(
      { jobId: String(jobId) },
      { $set: { status: 'done', stagingId: stagingId != null ? String(stagingId) : null, uploadChunkIndex: null, uploadChunkTotal: null, uploadProgress: null } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ success: false, message: 'Job not found' });
    endDownloadJob();
    console.log('[download-queue] webhook upload-done: scheduling startNextWaitingJob in', START_NEXT_DELAY_MS, 'ms');
    setTimeout(() => startNextWaitingJob().catch((e) => console.log('[download-queue] startNextWaitingJob error', e.message)), START_NEXT_DELAY_MS);
    return res.json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /webhook/failed — Job failed; schedule next waiting job after delay
router.post('/webhook/failed', checkWebhookSecret, express.json(), async (req, res) => {
  try {
    const { jobId, errorMessage } = req.body || {};
    if (!jobId) return res.status(400).json({ success: false, message: 'jobId required' });
    console.log('[download-queue] webhook failed received', jobId);
    const doc = await DownloadQueueModel.findOneAndUpdate(
      { jobId: String(jobId) },
      { $set: { status: 'failed', errorMessage: errorMessage != null ? String(errorMessage) : null } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ success: false, message: 'Job not found' });
    endDownloadJob();
    console.log('[download-queue] webhook failed: scheduling startNextWaitingJob in', START_NEXT_DELAY_MS, 'ms');
    setTimeout(() => startNextWaitingJob().catch((e) => console.log('[download-queue] startNextWaitingJob error', e.message)), START_NEXT_DELAY_MS);
    return res.json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
