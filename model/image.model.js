const mongoose = require('mongoose');

/**
 * Images are stored in MongoDB via GridFS, which splits files into chunks
 * (default 255KB each) in two collections:
 *   - images.files  (metadata: filename, length, uploadDate, metadata.contentType)
 *   - images.chunks (binary chunks)
 * This avoids the 16MB document limit and is the standard way to store
 * larger binaries in MongoDB.
 *
 * All create/read/delete is done in helper/image.helper.js using GridFSBucket.
 * This file documents the storage model; no Mongoose schema is used for the file itself.
 */

const BUCKET_NAME = 'images';

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
