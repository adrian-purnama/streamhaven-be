const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Per-episode queue for TV series. Parent show lives in DownloadQueue (mediaType: 'tv').
 * Each doc = one episode download job (status, quality, stagingId, etc.).
 * Do NOT add tmdbId to this schema (episodes use parentId only). A unique index on
 * tmdbId would cause E11000 when inserting multiple episodes. If you see that index
 * in the DB, run: node scripts/drop-download-series-queue-tmdbid-index.js
 */
const downloadSeriesQueueSchema = new Schema(
  {
    /** Parent series doc in DownloadQueue. */
    parentId: {
      type: Schema.Types.ObjectId,
      ref: 'DownloadQueue',
      required: true,
      index: true,
    },
    seasonNumber: {
      type: Number,
      required: true,
      index: true,
    },
    episodeNumber: {
      type: Number,
      required: true,
      index: true,
    },
    /** Optional; when missing, use episodeName or default "showTitle year S01E01" for display/search. */
    title: {
      type: String,
      default: null,
      index: true,
    },
    /** Optional episode name from TMDB; when null, display can default to title or "title year SxxExx". */
    episodeName: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'waiting', 'searching', 'downloading', 'uploading', 'done', 'failed'],
      default: 'pending',
      index: true,
    },
    quality: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'high',
    },
    /** StagingVideo _id after successful upload */
    stagingId: {
      type: String,
      default: null,
    },
    uploadChunkIndex: { type: Number, default: null },
    uploadChunkTotal: { type: Number, default: null },
    uploadProgress: { type: Number, default: null },
    errorMessage: {
      type: String,
      default: null,
    },
    requester: {
      id: {
        type: Schema.Types.ObjectId,
        ref: 'user',
        required: false,
      },
      type: {
        type: String,
        enum: ['user', 'admin', 'guest'],
        required: false,
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DownloadSeriesQueue', downloadSeriesQueueSchema);
