const { Readable } = require('stream');
const mongoose = require('mongoose');
const { getBucket, getFilesCollection } = require('../model/image.model');

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Upload image to GridFS (stored in chunks). Returns id and url path.
 * @param {{ buffer: Buffer, mimetype: string, originalname?: string }}
 * @returns {Promise<{ id: string, urlPath: string }>}
 */
async function createImage({ buffer, mimetype, originalname = '' }) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Invalid image data');
  }
  if (!ALLOWED_TYPES.includes(mimetype)) {
    throw new Error(`Unsupported image type: ${mimetype}. Use: ${ALLOWED_TYPES.join(', ')}`);
  }
  if (buffer.length > MAX_SIZE_BYTES) {
    throw new Error(`Image too large. Max ${MAX_SIZE_BYTES / 1024 / 1024}MB`);
  }

  const bucket = getBucket();
  const filename = originalname || `image-${Date.now()}`;

  const uploadStream = bucket.openUploadStream(filename, {
    metadata: { contentType: mimetype },
  });

  await new Promise((resolve, reject) => {
    Readable.from(buffer).pipe(uploadStream);
    uploadStream.on('finish', () => resolve(uploadStream.id));
    uploadStream.on('error', reject);
  });

  const id = uploadStream.id.toString();
  return { id, urlPath: `/api/images/${id}` };
}

/**
 * Get image from GridFS by id. Returns buffer and contentType.
 * @param {string} id - MongoDB ObjectId string
 * @returns {Promise<{ data: Buffer, contentType: string } | null>}
 */
async function getImageById(id) {
  let objectId;
  try {
    objectId = new mongoose.Types.ObjectId(id);
  } catch {
    return null;
  }

  const filesCol = getFilesCollection();
  const fileDoc = await filesCol.findOne({ _id: objectId });
  if (!fileDoc) return null;

  const contentType = fileDoc.metadata?.contentType || 'application/octet-stream';
  const bucket = getBucket();
  const chunks = [];
  const stream = bucket.openDownloadStream(objectId);

  await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  const data = Buffer.concat(chunks);
  return { data, contentType };
}

/**
 * Delete image from GridFS (removes file doc and all chunks).
 * @param {string} id - MongoDB ObjectId string
 * @returns {Promise<boolean>} true if deleted
 */
async function deleteImageById(id) {
  let objectId;
  try {
    objectId = new mongoose.Types.ObjectId(id);
  } catch {
    return false;
  }

  const fileDoc = await getFilesCollection().findOne({ _id: objectId });
  if (!fileDoc) return false;

  const bucket = getBucket();
  await bucket.delete(objectId);
  return true;
}

module.exports = {
  createImage,
  getImageById,
  deleteImageById,
};
