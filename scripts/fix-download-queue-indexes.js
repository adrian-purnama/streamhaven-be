/**
 * Fix E11000 duplicate key on app.downloadqueues (index: jobId_1 dup key: { jobId: null }).
 *
 * Cause: A unique index on jobId that includes null values allows only one document with jobId: null.
 * Fix: Drop jobId_1 and recreate it as a unique PARTIAL index so only non-null jobId values are enforced.
 *
 * Run with backend stopped so the app doesn't recreate a bad index.
 * From project root: node backend/scripts/fix-download-queue-indexes.js
 * From backend:      node scripts/fix-download-queue-indexes.js
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const mongoose = require('mongoose');
const DownloadQueueModel = require('../model/downloadQueue.model');

const INDEX_NAME = 'jobId_1';
const DB_NAME = process.env.MONGODB_DB_NAME || 'app';

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  console.log('Connecting to MongoDB (dbName:', DB_NAME, ')...');
  await mongoose.connect(uri, { dbName: DB_NAME });

  const coll = DownloadQueueModel.collection;
  const collectionName = coll.collectionName;

  // Show current indexes
  const before = await coll.indexes();
  const jobIdIndexBefore = before.find((idx) => idx.name === INDEX_NAME);
  if (jobIdIndexBefore) {
    console.log('Current', INDEX_NAME, ':', JSON.stringify(jobIdIndexBefore));
  } else {
    console.log('No index', INDEX_NAME, 'present.');
  }

  // Drop jobId_1 (may be unique over all values including null)
  try {
    await coll.dropIndex(INDEX_NAME);
    console.log('Dropped index:', INDEX_NAME);
  } catch (err) {
    if (err.code === 27 || err.codeName === 'IndexNotFound') {
      console.log('Index', INDEX_NAME, 'did not exist.');
    } else {
      throw err;
    }
  }

  // Create partial unique index so multiple null/absent jobIds are allowed; only non-null jobIds must be unique.
  await coll.createIndex(
    { jobId: 1 },
    {
      unique: true,
      name: INDEX_NAME,
      partialFilterExpression: { jobId: { $exists: true, $ne: null } },
    }
  );
  console.log('Created partial unique index', INDEX_NAME, 'on', collectionName, '(non-null jobId only).');

  const after = await coll.indexes();
  const jobIdIndexAfter = after.find((idx) => idx.name === INDEX_NAME);
  console.log(
    'Verified:',
    jobIdIndexAfter
      ? 'unique=' + !!jobIdIndexAfter.unique + ', partialFilterExpression=' + JSON.stringify(jobIdIndexAfter.partialFilterExpression || {})
      : 'missing'
  );

  await mongoose.disconnect();
  console.log('Done. You can start the backend again.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
