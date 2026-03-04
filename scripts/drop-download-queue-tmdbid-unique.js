/**
 * One-time script: drop the unique index on tmdbId in downloadqueues.
 * MongoDB still had the old unique index after we removed unique: true from the model,
 * causing E11000 when adding TV episodes (same tmdbId for multiple docs).
 * Run from backend: node scripts/drop-download-queue-tmdbid-unique.js
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
  const indexName = 'tmdbId_1';
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
  await mongoose.disconnect();
  console.log('Done.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
