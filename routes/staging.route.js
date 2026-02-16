const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const pipelineAsync = promisify(pipeline);
const { validateToken, validateAdmin } = require('../helper/validate.helper');
const { createStagingVideoWithProgress, listStaging, getStagingVideoStream, updateStaging, deleteStaging } = require('../helper/stagingVideo.helper');
const { formatMediaImageUrls } = require('../helper/tmdb.helper');
const { getAccountInfo, checkUploadQuota, uploadVideoToAbyss, getSlugStatus } = require('../helper/abyss.helper');
const { tryStartRun, updateProgress, endRun, getState } = require('../helper/stagingProcessState.helper');
const StagingVideoModel = require('../model/stagingVideo.model');
const UploadedVideoModel = require('../model/uploadedVideo.model');
const systemModel = require('../model/system.model');

const router = express.Router();

const STATUS_ENUM = ['pending', 'uploading', 'storage_fail', 'daily_fail', 'max_upload_fail', 'uploaded_not_ready', 'ready', 'error'];
/** Statuses that should be picked up by the process queue (pending + previous failures to retry) */
const PROCESSABLE_STATUSES = ['pending', 'storage_fail', 'daily_fail', 'max_upload_fail', 'error'];



const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, os.tmpdir()),
  filename: (req, file, cb) => cb(null, `staging-${Date.now()}-${(file.originalname || 'video').replace(/[^a-zA-Z0-9.-]/g, '_')}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5GB
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/x-matroska'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported type: ${file.mimetype}. Use MP4, WebM, or MKV.`));
  },
});

// GET /api/staging – list staging with pagination, optional status/statuses filter, and current process run
router.get('/', validateToken, validateAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 20), 100);
    const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
    const status = req.query.status?.trim();
    const statusesParam = req.query.statuses?.trim();
    let statusFilter = null;
    let statusesFilter = null;
    if (statusesParam) {
      const arr = statusesParam.split(',').map((s) => s.trim()).filter((s) => STATUS_ENUM.includes(s));
      if (arr.length) statusesFilter = arr;
    } else if (status && STATUS_ENUM.includes(status)) {
      statusFilter = status;
    }
    const { list, total } = await listStaging({
      status: statusFilter,
      statuses: statusesFilter,
      limit,
      skip,
    });
    const listWithPoster = list.map((doc) => formatMediaImageUrls(doc));
    const processRun = getState();
    return res.json({
      success: true,
      data: {
        list: listWithPoster,
        total,
        processRun: {
          isProcessing: processRun.isProcessing,
          startedAt: processRun.startedAt,
          total: processRun.total,
          processed: processRun.processed,
          failed: processRun.failed,
          currentStagingId: processRun.currentStagingId,
          items: processRun.items,
        },
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to list staging' });
  }
});

// POST /api/staging/upload – upload video to staging (multipart: file + tmdbId, title). Response is NDJSON with progress.
router.post('/upload', validateToken, validateAdmin, upload.single('file'), async (req, res) => {
  const tmpPath = req.file?.path;
  const logLines = [];
  try {
    // — Validate request
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No video file provided' });
    }
    const filename = req.file.originalname || req.file.filename;
    logLines.push(`Staging upload started: ${filename}`);
    const tmdbId = req.body.tmdbId != null ? Number(req.body.tmdbId) : null;
    const title = req.body.title != null ? String(req.body.title) : '';
    const posterPath = req.body.poster_path != null ? String(req.body.poster_path) : null;

    // — Set up chunked NDJSON response
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.status(201);
    const sendLine = (obj) => res.write(JSON.stringify(obj) + '\n');

    // — Stream file to GridFS and create staging doc (with progress callbacks)
    logLines.push('Creating read stream and writing to GridFS…');
    const readStream = fs.createReadStream(req.file.path);
    const result = await createStagingVideoWithProgress(
      {
        readStream,
        mimetype: req.file.mimetype,
        originalname: req.file.originalname || req.file.filename || 'video.mp4',
        size: req.file.size,
        tmdbId,
        title,
        posterPath,
      },
      (percent) => sendLine({ stage: 'writing', progress: percent })
    );

    // — Send success line and close response
    sendLine({ stage: 'done', progress: 100, ...result, message: 'Video added to staging' });
    res.end();
    const sizeMb = (req.file.size / (1024 * 1024)).toFixed(2);
    logLines.push(`Staging upload done: ${filename} (tmdbId: ${tmdbId ?? '—'}, title: ${title || '—'}, ${sizeMb} MB), stagingId: ${result.stagingId}`);
  } catch (err) {
    logLines.push(`Staging upload failed: ${err?.message || err}`);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
    }
    res.write(JSON.stringify({ stage: 'error', message: err.message || 'Upload failed' }) + '\n');
    res.end();
  } finally {
    if (tmpPath) fs.promises.unlink(tmpPath).catch(() => {});
    if (logLines.length > 0) {
      await systemModel.appendLog('STAGING_PROCESS_LOG', logLines).catch(() => {});
    }
  }
});

// GET /api/staging/process-status – current process run state (for UI polling; survives refresh)
router.get('/process-status', validateToken, validateAdmin, (req, res) => {
  return res.json({ success: true, data: getState() });
});

// POST /api/staging/process – process pending queue; one run at a time (semaphore), 409 if already running
router.post('/process', validateToken, validateAdmin, async (req, res) => {
  const logLines = [];

  // — Load pending items (processable statuses only)
  let pending;
  try {
    pending = await StagingVideoModel.find({ status: { $in: PROCESSABLE_STATUSES } })
      .sort({ createdAt: 1 })
      .limit(100)
      .lean();
  } catch (err) {
    logLines.push(`Staging upload process failed to load pending: ${err?.message || err}`);
    return res.status(500).json({ success: false, message: err.message || 'Failed to load pending' });
  }

  // — Take the run lock; 409 if already processing
  if (!tryStartRun(pending)) {
    return res.status(409).json({
      success: false,
      message: 'A process run is already in progress. Wait for it to finish or refresh to see status.',
      data: getState(),
    });
  }

  let processed = 0;
  let failed = 0;
  let quotaStopped = false;

  try {
    logLines.push(`Process run started, pending count: ${pending.length}`);
    for (const doc of pending) {
      const stagingId = doc._id.toString();
      const title = doc.title || doc.filename || stagingId;
      updateProgress(processed, failed, stagingId);

      try {
        // — Check Abyss quota before uploading
        logLines.push(`${stagingId} Checking Abyss quota…`);
        const accountInfo = await getAccountInfo();
        const quota = checkUploadQuota(accountInfo, doc.size);
        if (!quota.canUpload) {
          logLines.push(`${stagingId} Quota check failed: ${quota.failStatus}`);
          await updateStaging(stagingId, { status: quota.failStatus });
          quotaStopped = true;
          break;
        }

        // — Set uploading, open GridFS stream
        logLines.push(`${stagingId} Opening GridFS stream…`);
        await updateStaging(stagingId, { status: 'uploading' });
        const streamResult = await getStagingVideoStream(stagingId);
        if (!streamResult?.stream) {
          logLines.push(`${stagingId} Could not open staging stream`);
          await updateStaging(stagingId, { status: 'error', errorMessage: 'Could not open staging stream' });
          failed += 1;
          updateProgress(processed, failed, null);
          continue;
        }

        // — Write to temp file, then upload to Abyss
        const tmpPath = path.join(os.tmpdir(), `abyss-upload-${stagingId}-${Date.now()}${path.extname(streamResult.filename) || '.mp4'}`);
        logLines.push(`${stagingId} Writing to temp file, then uploading to Abyss…`);
        await pipelineAsync(streamResult.stream, fs.createWriteStream(tmpPath));
        let slug;
        try {
          const stat = await fs.promises.stat(tmpPath);
          const fileStream = fs.createReadStream(tmpPath);
          const result = await uploadVideoToAbyss(fileStream, {
            filename: streamResult.filename,
            contentType: streamResult.contentType,
            size: stat.size,
          });
          slug = result.slug;
          logLines.push(`${stagingId} Abyss upload OK, slug: ${slug}`);
        } finally {
          await fs.promises.unlink(tmpPath).catch(() => {});
        }

        // — Fetch slug status, create UploadedVideo, delete staging
        logLines.push(`${stagingId} Fetching slug status…`);
        const slugStatus = await getSlugStatus(slug);
        await UploadedVideoModel.create({
          externalId: doc.tmdbId ?? null,
          title: doc.title ?? '',
          poster_path: doc.poster_path ?? null,
          abyssSlug: slug,
          slugStatus,
          filename: doc.filename ?? null,
          size: doc.size ?? null,
        });
        logLines.push(`${stagingId} UploadedVideo created, slug: ${slug}`);
        await updateStaging(stagingId, { status: slugStatus, abyssSlug: slug });
        
        logLines.push(`${stagingId} deleting staging`);
        await deleteStaging(stagingId);
        logLines.push(`${stagingId} staging deleted`);
        processed += 1;
        logLines.push(`${stagingId} Done. Processed: ${processed}, Failed: ${failed}`);
      } catch (err) {
        logLines.push(`${stagingId} Error: ${err?.message || err}`);
        await updateStaging(stagingId, {
          status: 'error',
          errorMessage: err?.message || String(err),
        }).catch(() => {});
        failed += 1;
      }
      updateProgress(processed, failed, null);
    }

    logLines.push(`Run finished. Processed: ${processed}, Failed: ${failed}, QuotaStopped: ${quotaStopped}`);
    return res.json({
      success: true,
      data: { processed, failed, quotaStopped, total: pending.length, ...getState() },
      message: `Processed ${processed}, failed ${failed}${quotaStopped ? ' (stopped by quota)' : ''}.`,
    });
  } catch (err) {
    logLines.push(`Process run failed: ${err?.message || err}`);
    return res.status(500).json({ success: false, message: err.message || 'Process failed', data: getState() });
  } finally {
    endRun();
    if (logLines.length > 0) {
      await systemModel.appendLog('ABYSS_UPLOAD_LOG', logLines).catch(() => {});
    }
  }
});

module.exports = router;
