const express = require('express');
const axios = require('axios');
const { validateToken, validateAdmin, validateWebhookSecret } = require('../helper/validate.helper');
const { getPosterUrl } = require('../helper/movietv.helper');
const DownloadQueueModel = require('../model/downloadQueue.model');
const StagingVideoModel = require('../model/stagingVideo.model');
const UploadedVideoModel = require('../model/uploadedVideo.model');

const router = express.Router();

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const DOWNLOADER_URL = (process.env.DOWNLOADER_URL || '').replace(/\/$/, '');
const SNIFFER_URL = (process.env.DOWNLOADER_URL || process.env.DOWNLOADER_URL || '').replace(/\/$/, '');


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Use validateWebhookSecret from validate.helper for webhook routes (X-Webhook-Secret header).

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
    const rawList = await DownloadQueueModel.find(query)
      .populate('requester.id', 'email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    const total = await DownloadQueueModel.countDocuments(query);
    const list = rawList.map((item) => {
      const populated = item.requester?.id;
      const requesterEmail = populated?.email ?? null;
      const requesterType = item.requester?.type ?? null;
      return {
        ...item,
        poster_url: getPosterUrl(item.poster_path, 'w200') || null,
        requesterEmail,
        requesterType,
      };
    });
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
    const numTmdbId = tmdbId != null ? Number(tmdbId) : null;
    if (numTmdbId != null) {
      const [inQueue, inStaging, inUploaded] = await Promise.all([
        DownloadQueueModel.findOne({ tmdbId: numTmdbId }).lean(),
        StagingVideoModel.findOne({ tmdbId: numTmdbId }).lean(),
        UploadedVideoModel.findOne({ externalId: numTmdbId }).lean(),
      ]);
      if (inQueue || inStaging || inUploaded) {
        return res.status(400).json({
          success: false,
          message: 'This movie is already in the queue, staging, or has been uploaded',
        });
      }
    }
    const doc = await DownloadQueueModel.create({
      title: title.trim(),
      tmdbId: numTmdbId,
      poster_path: poster_path != null && String(poster_path).trim() ? String(poster_path).trim() : null,
      year: year != null ? Number(year) : null,
      status: 'pending',
      requester: { id: req.userId, type: 'admin' },
    });
    return res.status(201).json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------------
// PATCH /:id — Update item (quality; only if pending or waiting)
// -----------------------------------------------------------------------------

router.patch('/:id', validateToken, validateAdmin, async (req, res) => {
  try {
    const doc = await DownloadQueueModel.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Queue item not found' });
    if (doc.status === 'downloading' || doc.status === 'uploading') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update while downloading or uploading',
      });
    }
    const { quality } = req.body || {};
    if (quality != null && !['low', 'medium', 'high'].includes(quality)) {
      return res.status(400).json({ success: false, message: 'Invalid quality' });
    }
    const update = {};
    if (quality != null) update.quality = quality;
    if (Object.keys(update).length === 0) {
      return res.json({ success: true, data: doc });
    }
    const updated = await DownloadQueueModel.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true }
    ).lean();
    return res.json({ success: true, data: updated });
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
// POST /process/start — Ping sniffer server to start its worker loop (loop runs in Python).
// -----------------------------------------------------------------------------

router.post('/process/start', validateToken, validateAdmin, async (req, res) => {
  try {
    if (!SNIFFER_URL) {
      return res.status(503).json({ success: false, message: 'SNIFFER_URL not set' });
    }
    const { data, status } = await axios.get(
      `${SNIFFER_URL}/download`,
      { timeout: 5000, validateStatus: () => true }
    );
    if (status === 503) {
      return res.status(503).json({ success: false, message: data?.message || 'Sniffer loop already running' });
    }
    return res.json({ success: true, message: data?.message || 'Started', data: null });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});



module.exports = router;
