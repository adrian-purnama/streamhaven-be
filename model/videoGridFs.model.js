const mongoose = require('mongoose');

/**
 * Video files are stored in MongoDB via GridFS in two collections:
 *   - stagingVideos.files  (metadata: filename, length, uploadDate, metadata.contentType)
 *   - stagingVideos.chunks (binary chunks)
 */

const BUCKET_NAME = 'stagingVideos';

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

module.exports = {
  BUCKET_NAME,
  getBucket,
  getFilesCollection,
};
