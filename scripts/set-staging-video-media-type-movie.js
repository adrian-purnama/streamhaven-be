/**
 * One-time script: set mediaType to 'movie' for all existing StagingVideo documents
 * that don't have mediaType or have it null (backfill after adding mediaType to schema).
 * Run from backend: node scripts/set-staging-video-media-type-movie.js
 *
 * If you see 0 documents but the app shows staging items, the script is likely using a
 * different DB than the running server. Fix: pass the SAME MONGODB_URI the server uses:
 *   Windows (PowerShell): $env:MONGODB_URI="mongodb://..."; node scripts/set-staging-video-media-type-movie.js
 *   Or copy MONGODB_URI from the server's env and run the script with that.
 * The script uses dbName: "app" to match the server (see backend index.js mongoose.connect(..., { dbName: "app" })).
 */
const path = require('path');
const fs = require('fs');

const backendEnv = path.resolve(__dirname, '../.env');
const cwdEnv = path.resolve(process.cwd(), '.env');
console.log('Script __dirname:', __dirname);
console.log('.env backend path:', backendEnv, '| exists:', fs.existsSync(backendEnv));
console.log('.env CWD path:', cwdEnv, '| exists:', fs.existsSync(cwdEnv));
require('dotenv').config({ path: backendEnv });
require('dotenv').config({ path: cwdEnv });

const mongoose = require('mongoose');
const StagingVideoModel = require('../model/stagingVideo.model');

function redactPassword(uri) {
  if (!uri || typeof uri !== 'string') return '(none)';
  return uri.replace(/:([^:@]+)@/, ':***@');
}

async function run() {
  console.log('\nStarting script: set StagingVideo.mediaType to "movie" where missing');
  console.log('CWD:', process.cwd());

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set. Set it in .env (in CWD or backend folder).');
    process.exit(1);
  }

  console.log('\n--- Script connection (password redacted) ---');
  console.log('MONGODB_URI:', redactPassword(uri));
  const dbNameFromUri = (uri.match(/\/([^/?]+)(\?|$)/) || [])[1] || '(unknown)';
  console.log('DB name from URI:', dbNameFromUri);
  console.log('--- To compare: in your running backend, add: console.log("SERVER MONGODB_URI", process.env.MONGODB_URI?.replace(/:([^:@]+)@/, ":***@")) ---\n');

  const dbNameOption = process.env.MONGODB_DB_NAME || 'app';
  console.log('Connecting to MongoDB (dbName option:', dbNameOption, ')...');
  await mongoose.connect(uri, { dbName: dbNameOption });
  const conn = mongoose.connection;
  const db = conn.db;
  const dbNameActual = db.databaseName;
  console.log('Connected.');
  console.log('Mongoose connection: host=', conn.host, 'port=', conn.port, 'name=', conn.name);
  console.log('Actual database name:', dbNameActual, '| Collection:', StagingVideoModel.collection.name);

  const colls = await db.listCollections().toArray();
  console.log('\n--- All collections in this DB ---');
  for (const c of colls) {
    const count = await db.collection(c.name).countDocuments();
    console.log('  ', c.name, ':', count, 'documents');
  }
  console.log('---\n');

  try {
    const totalBefore = await StagingVideoModel.countDocuments({});
    console.log('Total StagingVideo documents:', totalBefore);

    const withoutMediaType = await StagingVideoModel.countDocuments({
      $or: [{ mediaType: { $exists: false } }, { mediaType: null }],
    });
    const withMovie = await StagingVideoModel.countDocuments({ mediaType: 'movie' });
    const withTv = await StagingVideoModel.countDocuments({ mediaType: 'tv' });
    console.log('  - without mediaType or null:', withoutMediaType);
    console.log('  - with mediaType "movie":', withMovie);
    console.log('  - with mediaType "tv":', withTv);

    const filter = { $or: [{ mediaType: { $exists: false } }, { mediaType: null }] };
    console.log('Running updateMany(filter, { $set: { mediaType: "movie" } })...');
    const result = await StagingVideoModel.updateMany(filter, { $set: { mediaType: 'movie' } });
    console.log('Result: matchedCount =', result.matchedCount, ', modifiedCount =', result.modifiedCount);

    const totalAfter = await StagingVideoModel.countDocuments({});
    const withMovieAfter = await StagingVideoModel.countDocuments({ mediaType: 'movie' });
    console.log('After update: total =', totalAfter, ', with mediaType "movie" =', withMovieAfter);
    console.log('Done.');
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
