const mongoose = require('mongoose');

/**
 * Subtitle files are stored in MongoDB via GridFS:
 *   - stagingSubtitles.files  (metadata: filename, length, uploadDate, metadata.contentType)
 *   - stagingSubtitles.chunks (binary chunks)
 */

const BUCKET_NAME = 'stagingSubtitles';

function getBucket() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database not connected');
  return new mongoose.mongo.GridFSBucket(db, { bucketName: BUCKET_NAME });
}

function getFilesCollection() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database not connected');
  return db.collection(`${BUCKET_NAME}.files`);
}

/**
 * Read a subtitle file from GridFS by id. Returns the file as a Buffer.
 * @param {string|import('mongoose').Types.ObjectId} gridFsFileId
 * @returns {Promise<Buffer|null>}
 */
async function getSubtitleBuffer(gridFsFileId) {
  const db = mongoose.connection.db;
  if (!db) return null;
  let objectId;
  try {
    objectId = new mongoose.Types.ObjectId(gridFsFileId);
  } catch {
    return null;
  }
  const bucket = getBucket();
  const chunks = [];
  const stream = bucket.openDownloadStream(objectId);
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

module.exports = {
  BUCKET_NAME,
  getBucket,
  getFilesCollection,
  getSubtitleBuffer,
};
