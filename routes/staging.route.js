const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const pipelineAsync = promisify(pipeline);
const { validateToken, validateAdmin, validateStagingAuth } = require('../helper/validate.helper');
const { createStagingVideoWithProgress, createStagingVideoFromStream, listStaging, getStagingVideoStream, updateStaging, deleteStaging } = require('../helper/stagingVideo.helper');
const { formatMediaImageUrls } = require('../helper/tmdb.helper');
const { getAccountInfo, checkUploadQuota, uploadVideoToAbyss, getSlugStatus } = require('../helper/abyss.helper');
const { tryStartRun, updateProgress, endRun, getState, setUploadState, clearUploadState, getUploadState } = require('../helper/stagingProcessState.helper');
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

// Streaming upload: pipe multipart file stream directly to GridFS (no temp file)
const streamingUploadStorage = {
  _handleFile(req, file, cb) {
    const sendLine = req._stagingSendLine;
    const tmdbId = req.body.tmdbId != null ? Number(req.body.tmdbId) : null;
    const title = req.body.title != null ? String(req.body.title) : '';
    const posterPath = req.body.poster_path != null ? String(req.body.poster_path) : null;
    createStagingVideoFromStream(
      {
        readStream: file.stream,
        mimetype: file.mimetype,
        originalname: file.originalname || file.filename || 'video.mp4',
        tmdbId,
        title,
        posterPath,
      },
      (percent) => { if (sendLine) sendLine({ stage: 'writing', progress: percent }); }
    )
      .then((result) => cb(null, { size: result.size, stagingId: result.stagingId, gridFsFileId: result.gridFsFileId }))
      .catch((err) => cb(null, { size: 0, uploadError: err?.message || 'Upload failed' }));
  },
  _removeFile(req, file, cb) { cb(null); },
};
const uploadStream = multer({
  storage: streamingUploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5GB
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/x-matroska'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported type: ${file.mimetype}. Use MP4, WebM, or MKV.`));
  },
});

const CHUNK_SIZE_LIMIT = 95 * 1024 * 1024; // 95MB per chunk (under Cloudflare 100MB)
const chunkStorage = multer.memoryStorage();
const uploadChunk = multer({
  storage: chunkStorage,
  limits: { fileSize: CHUNK_SIZE_LIMIT },
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/x-matroska'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    // Chunks from file.slice() often arrive as application/octet-stream; allow if filename looks like video
    if (file.mimetype === 'application/octet-stream' && /\.(mp4|webm|mkv)$/i.test(file.originalname || '')) return cb(null, true);
    cb(new Error(`Unsupported type: ${file.mimetype}. Use MP4, WebM, or MKV.`));
  },
});

// Append-only upload: one write stream per uploadId. Chunks appended as they arrive; no full-file reassembly in RAM.
const uploadStreams = new Map(); // uploadId -> { writeStream, filePath, meta, totalChunks, receivedChunks: Set }

function safeUploadId(id) {
  return String(id).replace(/[^a-zA-Z0-9-_]/g, '') || 'unknown';
}

async function removeUploadStream(uploadId, filePath) {
  const key = safeUploadId(uploadId);
  uploadStreams.delete(key);
  if (filePath) await fs.promises.unlink(filePath).catch(() => {});
}

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

// POST /api/staging/upload – stream multipart file directly to GridFS (no temp file). Response is NDJSON with progress.
// Uses validateStagingAuth so both browser (JWT) and downloader (STAGING_SERVICE_TOKEN) can call it.
// router.post('/upload', validateStagingAuth, validateAdmin, (req, res, next) => {
//   res.setHeader('Content-Type', 'application/x-ndjson');
//   res.setHeader('Transfer-Encoding', 'chunked');
//   res.status(201);
//   req._stagingSendLine = (obj) => res.write(JSON.stringify(obj) + '\n');
//   next();
// }, uploadStream.single('file'), async (req, res) => {
//   const logLines = [];
//   try {
//     if (!req.file) {
//       res.setHeader('Content-Type', 'application/json');
//       return res.status(400).json({ success: false, message: 'No video file provided' });
//     }
//     if (req.file.uploadError) {
//       req._stagingSendLine({ stage: 'error', message: req.file.uploadError });
//       res.end();
//       logLines.push(`Staging upload failed: ${req.file.uploadError}`);
//       return;
//     }
//     const filename = req.file.originalname || req.file.filename || 'video.mp4';
//     logLines.push(`Staging upload started: ${filename}`);
//     const result = { stage: 'done', progress: 100, stagingId: req.file.stagingId, gridFsFileId: req.file.gridFsFileId, message: 'Video added to staging' };
//     req._stagingSendLine(result);
//     res.end();
//     const sizeMb = ((req.file.size || 0) / (1024 * 1024)).toFixed(2);
//     logLines.push(`Staging upload done: ${filename} (${sizeMb} MB), stagingId: ${req.file.stagingId}`);
//   } catch (err) {
//     logLines.push(`Staging upload failed: ${err?.message || err}`);
//     if (!res.headersSent) {
//       res.setHeader('Content-Type', 'application/json');
//       return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
//     }
//     res.write(JSON.stringify({ stage: 'error', message: err.message || 'Upload failed' }) + '\n');
//     res.end();
//   } finally {
//     if (logLines.length > 0) {
//       await systemModel.appendLog('STAGING_PROCESS_LOG', logLines).catch(() => {});
//     }
//   }
// });

// POST /api/staging/upload-chunk – append each chunk to one file (no reassembly in RAM). Last chunk triggers DB write + NDJSON.
router.post('/upload-chunk', validateStagingAuth, validateAdmin, uploadChunk.single('file'), async (req, res) => {
  const uploadId = req.body.uploadId != null ? String(req.body.uploadId).trim() : null;
  const chunkIndex = req.body.chunkIndex != null ? parseInt(req.body.chunkIndex, 10) : NaN;
  const totalChunks = req.body.totalChunks != null ? parseInt(req.body.totalChunks, 10) : NaN;
  if (!uploadId || Number.isNaN(chunkIndex) || Number.isNaN(totalChunks) || totalChunks < 1 || chunkIndex < 0 || chunkIndex >= totalChunks) {
    return res.status(400).json({ success: false, message: 'uploadId, chunkIndex (0-based), and totalChunks required' });
  }
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ success: false, message: 'Chunk file required' });
  }
  const key = safeUploadId(uploadId);
  const chunkSize = req.file.buffer.length;
  console.log(`[STAGING_CHUNK] received uploadId=${uploadId} chunkIndex=${chunkIndex}/${totalChunks} chunkSize=${chunkSize}`);
  let logLines = [];
  try {
    let entry = uploadStreams.get(key);

    if (chunkIndex === 0) {
      if (entry && entry.receivedChunks.has(0)) {
        console.log(`[STAGING_CHUNK] chunk 0 already received (idempotent) uploadId=${uploadId}`);
        return res.status(200).json({ success: true, chunkIndex, totalChunks });
      }
      const ext = path.extname(req.file.originalname || 'video.mp4') || '.mp4';
      const filePath = path.join(os.tmpdir(), `staging-append-${uploadId}-${Date.now()}${ext}`);
      const writeStream = fs.createWriteStream(filePath, { flags: 'a' });
      let mimetype = req.file.mimetype || 'video/mp4';
      if (mimetype === 'application/octet-stream') {
        const e = (path.extname(req.file.originalname || '') || '').toLowerCase();
        mimetype = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska' }[e] || 'video/mp4';
      }
      const meta = {
        filename: req.file.originalname || req.file.filename || 'video.mp4',
        mimetype,
        tmdbId: req.body.tmdbId != null ? Number(req.body.tmdbId) : null,
        title: req.body.title != null ? String(req.body.title) : '',
        poster_path: req.body.poster_path != null ? String(req.body.poster_path) : null,
      };
      writeStream.write(req.file.buffer);
      entry = { writeStream, filePath, meta, totalChunks, receivedChunks: new Set([0]) };
      uploadStreams.set(key, entry);
      clearUploadState();
      setUploadState({ uploadId, status: 'uploading', fileName: meta.filename, totalChunks, currentChunk: 1, uploadProgress: Math.round((1 / totalChunks) * 100) });
      console.log(`[STAGING_CHUNK] created stream chunk 0/${totalChunks} uploadId=${uploadId}`);
      return res.status(200).json({ success: true, chunkIndex, totalChunks });
    }

    if (!entry) {
      return res.status(400).json({ success: false, message: 'Send chunk 0 first.' });
    }
    if (entry.receivedChunks.has(chunkIndex)) {
      console.log(`[STAGING_CHUNK] chunk ${chunkIndex} already received (idempotent) uploadId=${uploadId}`);
      return res.status(200).json({ success: true, chunkIndex, totalChunks });
    }

    entry.writeStream.write(req.file.buffer);
    entry.receivedChunks.add(chunkIndex);
    const isLastChunk = chunkIndex === totalChunks - 1;

    if (!isLastChunk) {
      setUploadState({ currentChunk: chunkIndex + 1, uploadProgress: Math.round(((chunkIndex + 1) / totalChunks) * 100) });
      console.log(`[STAGING_CHUNK] appended chunk ${chunkIndex + 1}/${totalChunks} uploadId=${uploadId}`);
      return res.status(200).json({ success: true, chunkIndex, totalChunks });
    }

    console.log(`[STAGING_CHUNK] last chunk appended, closing stream uploadId=${uploadId}`);
    const writeStream = entry.writeStream;
    const filePath = entry.filePath;
    const meta = entry.meta;
    uploadStreams.delete(key);

    await new Promise((resolve, reject) => {
      writeStream.once('finish', resolve);
      writeStream.once('error', reject);
      writeStream.end();
    });

    const stat = await fs.promises.stat(filePath);
    const totalSize = stat.size;
    console.log(`[STAGING_CHUNK] stream closed totalSize=${totalSize} calling createStagingVideoWithProgress uploadId=${uploadId}`);
    setUploadState({ status: 'writing', currentChunk: totalChunks, uploadProgress: 100, dbProgress: 0 });
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.status(201);
    let clientGone = false;
    res.on('error', (e) => {
      if (e?.code === 'ECONNRESET' || e?.code === 'EPIPE' || (e?.message && /write|socket|broken/i.test(e.message))) clientGone = true;
    });
    const sendLine = (obj) => {
      if (clientGone) return;
      try {
        if (!res.writableEnded && res.socket && !res.socket.destroyed) res.write(JSON.stringify(obj) + '\n');
      } catch (e) {
        clientGone = true;
      }
    };
    const readStream = fs.createReadStream(filePath);
    const result = await createStagingVideoWithProgress(
      {
        readStream,
        mimetype: meta.mimetype,
        originalname: meta.filename,
        size: totalSize,
        tmdbId: meta.tmdbId,
        title: meta.title,
        posterPath: meta.poster_path,
      },
      (percent) => {
        setUploadState({ dbProgress: percent });
        sendLine({ stage: 'writing', progress: percent });
      }
    );
    setUploadState({ status: 'done', dbProgress: 100, stagingId: result.stagingId });
    try {
      if (!res.writableEnded && res.socket && !res.socket.destroyed) {
        sendLine({ stage: 'done', progress: 100, ...result, message: 'Video added to staging' });
        res.end();
      }
    } catch (e) {
      // Client may have disconnected; state is already 'done' so polling will see it
    }
    console.log(`[STAGING_CHUNK] done uploadId=${uploadId} stagingId=${result.stagingId}`);
    logLines.push(`Chunked upload done: ${meta.filename}, stagingId: ${result.stagingId}`);
    await fs.promises.unlink(filePath).catch(() => {});
  } catch (err) {
    console.error(`[STAGING_CHUNK] error uploadId=${uploadId} message=${err?.message}`);
    const isClientGone = err?.code === 'ECONNRESET' || err?.code === 'EPIPE' || (err?.message && /write|socket|broken/i.test(err.message));
    if (!isClientGone) setUploadState({ status: 'error', error: err?.message || 'Chunk upload failed' });
    const entry = uploadStreams.get(key);
    uploadStreams.delete(key);
    if (entry && entry.filePath) await fs.promises.unlink(entry.filePath).catch(() => {});
    if (!res.headersSent) {
      return res.status(400).json({ success: false, message: err.message || 'Chunk upload failed' });
    }
    res.write(JSON.stringify({ stage: 'error', message: err.message || 'Upload failed' }) + '\n');
    res.end();
    logLines.push(`Chunked upload failed: ${err?.message || err}`);
  } finally {
    if (logLines.length > 0) {
      await systemModel.appendLog('STAGING_PROCESS_LOG', logLines).catch(() => {});
    }
  }
});

// GET /api/staging/process-status – current process run state (for UI polling; survives refresh)
router.get('/process-status', validateToken, validateAdmin, (req, res) => {
  return res.json({ success: true, data: getState() });
});

// GET /api/staging/upload-status/:uploadId – upload-to-staging progress for this id (for polling after reload)
router.get('/upload-status/:uploadId', validateStagingAuth, validateAdmin, (req, res) => {
  const state = getUploadState();
  if (state.uploadId !== req.params.uploadId) {
    return res.status(404).json({ success: false, message: 'Upload not found or no longer tracked.' });
  }
  return res.json({ success: true, data: state });
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

// Purge: clear in-progress uploads, upload state, all staging docs, and all staging video files (GridFS).
router.get('/purge-all-uploads', validateToken, validateAdmin, async (req, res) => {
  try {
    // 1. Close in-progress chunk upload streams and delete their temp files
    for (const [, entry] of uploadStreams) {
      if (entry.writeStream && !entry.writeStream.destroyed) {
        try {
          entry.writeStream.destroy();
        } catch (e) { /* ignore */ }
      }
      if (entry.filePath) await fs.promises.unlink(entry.filePath).catch(() => {});
    }
    uploadStreams.clear();

    // 2. Clear upload-to-staging progress state
    clearUploadState();

    // 3. Delete every staging document and its GridFS file
    const stagingDocs = await StagingVideoModel.find({}).select('_id').lean();
    let deleted = 0;
    for (const doc of stagingDocs) {
      const ok = await deleteStaging(doc._id.toString());
      if (ok) deleted++;
    }

    // 4. Remove any leftover temp files (staging-append-*, staging-reassembled-*)
    const tmpDir = os.tmpdir();
    const names = await fs.promises.readdir(tmpDir).catch(() => []);
    for (const name of names) {
      if (name.startsWith('staging-append-') || name.startsWith('staging-reassembled-')) {
        await fs.promises.unlink(path.join(tmpDir, name)).catch(() => {});
      }
    }

    return res.json({
      success: true,
      message: `Purge complete: ${deleted} staging video(s) and their files deleted; in-progress uploads cleared.`,
      deleted,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err?.message || 'Purge failed' });
  }
});


module.exports = router;
