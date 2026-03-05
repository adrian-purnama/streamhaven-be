/**
 * One-time script: fix E11000 duplicate key on jobId (dup key: { jobId: null }).
 * The collection had a plain unique index on jobId; MongoDB treats all nulls as the same,
 * so only one doc could have jobId: null. We drop that index and create a sparse unique
 * index so multiple docs can have null jobId (e.g. TV parents, pending items).
 * Run from backend: node scripts/fix-download-queue-jobid-index.js
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const mongoose = require('mongoose');
const DownloadQueueModel = require('../model/downloadQueue.model');

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  const dbNameOption = process.env.MONGODB_DB_NAME || 'app';
  console.log('Connecting to MongoDB (dbName:', dbNameOption, ')...');
  await mongoose.connect(uri, { dbName: dbNameOption });

  const coll = DownloadQueueModel.collection;
  const indexName = 'jobId_1';

  try {
    await coll.dropIndex(indexName);
    console.log('Dropped index:', indexName);
  } catch (err) {
    if (err.code === 27 || err.codeName === 'IndexNotFound') {
      console.log('Index', indexName, 'does not exist (already dropped or never created).');
    } else {
      throw err;
    }
  }

  await coll.createIndex(
    { jobId: 1 },
    { unique: true, sparse: true, name: 'jobId_1' }
  );
  console.log('Created sparse unique index on jobId (multiple nulls allowed).');

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
