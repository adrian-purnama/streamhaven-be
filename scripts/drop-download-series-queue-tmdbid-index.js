/**
 * One-time script: drop the tmdbId_1 index from downloadseriesqueues.
 * DownloadSeriesQueue has no tmdbId field (episodes use parentId); a stray unique
 * index on tmdbId causes E11000 when inserting multiple episodes (all with null).
 * Run from backend: node scripts/drop-download-series-queue-tmdbid-index.js
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const mongoose = require('mongoose');
const DownloadSeriesQueueModel = require('../model/downloadSeriesQueue.model');

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  const dbNameOption = process.env.MONGODB_DB_NAME || 'app';
  console.log('Connecting to MongoDB (dbName:', dbNameOption, ')...');
  await mongoose.connect(uri, { dbName: dbNameOption });

  const coll = DownloadSeriesQueueModel.collection;
  const indexes = await coll.indexes();
  let dropped = 0;
  for (const idx of indexes) {
    const name = idx.name;
    if (name === '_id_') continue;
    const keys = Object.keys(idx.key || {});
    if (keys.includes('tmdbId')) {
      try {
        await coll.dropIndex(name);
        console.log('Dropped index:', name, '(references tmdbId; this collection uses parentId only)');
        dropped++;
      } catch (err) {
        if (err.code === 27 || err.codeName === 'IndexNotFound') {
          console.log('Index', name, 'already gone.');
        } else {
          throw err;
        }
      }
    }
  }
  if (dropped === 0) {
    console.log('No tmdbId index found on', coll.collectionName, '- nothing to drop.');
  }
  await mongoose.disconnect();
  console.log('Done.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
