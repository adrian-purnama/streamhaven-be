const { Readable, Transform } = require('stream');
const mongoose = require('mongoose');
const { getBucket, getFilesCollection } = require('../model/videoGridFs.model');
const StagingVideoModel = require('../model/stagingVideo.model');

const ALLOWED_TYPES = ['video/mp4', 'video/webm', 'video/x-matroska'];
const MAX_SIZE_BYTES = 15 * 1024 * 1024 * 1024; // 15GB

/**
 * Same as createStagingVideo but streams from readStream in chunks and calls onProgress(percent) so the server can report DB write progress.
 * @param {{ readStream: NodeJS.ReadableStream, mimetype: string, originalname: string, size: number, tmdbId?: number, imdbId?: string, title?: string, posterPath?: string }}
 * @param {(percent: number) => void} onProgress - called with 0-100 as bytes are written to GridFS
 */
async function createStagingVideoWithProgress(
  { readStream, mimetype, originalname, size, tmdbId = null, imdbId = null, title = '', posterPath = null },
  onProgress
) {
  if (!ALLOWED_TYPES.includes(mimetype)) {
    throw new Error(`Unsupported video type: ${mimetype}. Use: ${ALLOWED_TYPES.join(', ')}`);
  }
  if (size > MAX_SIZE_BYTES) {
    throw new Error(`Video too large. Max ${MAX_SIZE_BYTES / 1024 / 1024 / 1024}GB`);
  }

  const bucket = getBucket();
  const filename = originalname || `video-${Date.now()}.mp4`;
  const uploadStream = bucket.openUploadStream(filename, { metadata: { contentType: mimetype } });

  let written = 0;
  const progressTransform = new Transform({
    transform(chunk, enc, cb) {
      written += chunk.length;
      const percent = size > 0 ? Math.min(100, Math.round((written / size) * 100)) : 100;
      if (typeof onProgress === 'function') onProgress(percent);
      cb(null, chunk);
    },
  });

  await new Promise((resolve, reject) => {
    readStream.pipe(progressTransform).pipe(uploadStream);
    uploadStream.on('finish', () => resolve(uploadStream.id));
    uploadStream.on('error', reject);
    readStream.on('error', reject);
  });

  if (typeof onProgress === 'function') onProgress(100);

  const gridFsFileId = uploadStream.id;
  const staging = await StagingVideoModel.create({
    gridFsFileId,
    filename,
    size,
    contentType: mimetype,
    tmdbId,
    imdbId,
    poster_path: posterPath || undefined,
    title,
    status: 'pending',
  });

  return {
    stagingId: staging._id.toString(),
    gridFsFileId: gridFsFileId.toString(),
  };
}

/**
 * Stream upload to GridFS without knowing size upfront (e.g. from multipart stream).
 * Counts bytes as it streams; calls onProgress(percent) with 0 until end then 100.
 * @param {{ readStream: NodeJS.ReadableStream, mimetype: string, originalname: string, tmdbId?: number, imdbId?: string, title?: string, posterPath?: string }}
 * @param {(percent: number) => void} onProgress
 * @returns {Promise<{ stagingId: string, gridFsFileId: string, size: number }>}
 */
async function createStagingVideoFromStream(
  { readStream, mimetype, originalname, tmdbId = null, imdbId = null, title = '', posterPath = null },
  onProgress
) {
  if (!ALLOWED_TYPES.includes(mimetype)) {
    throw new Error(`Unsupported video type: ${mimetype}. Use: ${ALLOWED_TYPES.join(', ')}`);
  }

  const bucket = getBucket();
  const filename = originalname || `video-${Date.now()}.mp4`;
  const uploadStream = bucket.openUploadStream(filename, { metadata: { contentType: mimetype } });
  const gridFsFileId = uploadStream.id;

  // Create staging doc with status 'writing' so it does not appear in the staging list until upload is 100% complete
  const staging = await StagingVideoModel.create({
    gridFsFileId,
    filename,
    size: 0,
    contentType: mimetype,
    tmdbId,
    imdbId,
    poster_path: posterPath || undefined,
    title,
    status: 'writing',
  });

  let written = 0;
  const progressTransform = new Transform({
    transform(chunk, enc, cb) {
      written += chunk.length;
      if (typeof onProgress === 'function') onProgress(written > 0 ? 99 : 0);
      cb(null, chunk);
    },
  });

  try {
    await new Promise((resolve, reject) => {
      readStream.pipe(progressTransform).pipe(uploadStream);
      uploadStream.on('finish', () => resolve(uploadStream.id));
      uploadStream.on('error', reject);
      readStream.on('error', reject);
    });
  } catch (err) {
    await bucket.delete(gridFsFileId).catch(() => {});
    await StagingVideoModel.updateOne(
      { _id: staging._id },
      { $set: { status: 'error', errorMessage: err?.message || 'Upload failed' } }
    );
    throw err;
  }

  const size = written;
  if (size > MAX_SIZE_BYTES) {
    await bucket.delete(gridFsFileId);
    await StagingVideoModel.updateOne(
      { _id: staging._id },
      { $set: { status: 'error', errorMessage: `Video too large. Max ${MAX_SIZE_BYTES / 1024 / 1024 / 1024}GB` } }
    );
    throw new Error(`Video too large. Max ${MAX_SIZE_BYTES / 1024 / 1024 / 1024}GB`);
  }
  if (typeof onProgress === 'function') onProgress(100);

  await StagingVideoModel.updateOne(
    { _id: staging._id },
    { $set: { size, status: 'pending' } }
  );

  return {
    stagingId: staging._id.toString(),
    gridFsFileId: gridFsFileId.toString(),
    size,
  };
}

/**
 * Get staging document by id.
 */
async function getStagingById(stagingId) {
  let id;
  try {
    id = new mongoose.Types.ObjectId(stagingId);
  } catch {
    return null;
  }
  return StagingVideoModel.findById(id).lean();
}

/**
 * Open a read stream for the video file (for uploading to Abyss or streaming).
 * @param {string} stagingId - StagingVideo _id
 * @returns {Promise<{ stream: Readable, contentType: string, filename: string } | null>}
 */
async function getStagingVideoStream(stagingId) {
  const staging = await getStagingById(stagingId);
  if (!staging?.gridFsFileId) return null;

  let objectId;
  try {
    objectId = new mongoose.Types.ObjectId(staging.gridFsFileId);
  } catch {
    return null;
  }

  const filesCol = getFilesCollection();
  const fileDoc = await filesCol.findOne({ _id: objectId });
  if (!fileDoc) return null;

  const bucket = getBucket();
  const stream = bucket.openDownloadStream(objectId);
  const contentType = fileDoc.metadata?.contentType || staging.contentType || 'video/mp4';
  const filename = staging.filename || fileDoc.filename || 'video.mp4';

  return { stream, contentType, filename };
}

/**
 * List staging documents (optional filters).
 * @param {object} opts
 * @param {string|null} opts.status - single status
 * @param {string[]|null} opts.statuses - multiple statuses ($in)
 * @param {number} opts.limit
 * @param {number} opts.skip
 */
async function listStaging({ status = null, statuses = null, limit = 50, skip = 0 } = {}) {
  const query = {};
  if (statuses?.length) {
    query.status = { $in: statuses };
  } else if (status) {
    query.status = status;
  }
  const list = await StagingVideoModel.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
  const total = await StagingVideoModel.countDocuments(query);
  return { list, total };
}

/**
 * Update staging document (e.g. status, abyssSlug, errorMessage).
 */
async function updateStaging(stagingId, update) {
  let id;
  try {
    id = new mongoose.Types.ObjectId(stagingId);
  } catch {
    return null;
  }
  return StagingVideoModel.findByIdAndUpdate(id, update, { new: true }).lean();
}

/**
 * Delete staging document and its file from GridFS.
 */
async function deleteStaging(stagingId) {
  const staging = await getStagingById(stagingId);
  if (!staging) return false;

  const bucket = getBucket();
  try {
    const objectId = new mongoose.Types.ObjectId(staging.gridFsFileId);
    await bucket.delete(objectId);
  } catch (err) {
    // chunk may already be missing
  }
  await StagingVideoModel.deleteOne({ _id: staging._id });
  return true;
}

module.exports = {
  createStagingVideoWithProgress,
  createStagingVideoFromStream,
  getStagingById,
  getStagingVideoStream,
  listStaging,
  updateStaging,
  deleteStaging,
  ALLOWED_TYPES,
  MAX_SIZE_BYTES,
};
