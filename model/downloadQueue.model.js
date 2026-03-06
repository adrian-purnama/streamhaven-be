const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Queue of videos to be downloaded (torrent) then uploaded to staging.
 * - Movies: one doc per movie (title, status, quality, etc.).
 * - TV: one doc per show (parent only); episode jobs live in DownloadSeriesQueue.
 */
const downloadQueueSchema = new Schema(
  {
    /** Show/movie title. For TV parent this is the series name (e.g. "Loki"). */
    title: {
      type: String,
      required: true,
      index: true,
    },
    /**
     * For movies: pending | waiting | searching | downloading | uploading | done | failed.
     * For TV parents: leave empty (null); workflow status lives on children in DownloadSeriesQueue.
     */
    quality : {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'high',
    },
    status: {
      type: String,
      enum: ['pending', 'waiting', 'searching', 'downloading', 'uploading', 'done', 'failed', null],
      default: null,
      index: true,
    },
    /** StagingVideo _id after successful upload */
    stagingId: {
      type: String,
      default: null,
    },
    /** Upload progress: current chunk (1-based) when status === 'uploading' */
    uploadChunkIndex: { type: Number, default: null },
    /** Total chunks for staging upload */
    uploadChunkTotal: { type: Number, default: null },
    /** Writing-to-DB progress 0-100 when last chunk is being processed */
    uploadProgress: { type: Number, default: null },
    /** Error message when status === 'failed' */
    errorMessage: {
      type: String,
      default: null,
    },
    /** TMDB id: for movies the movie id (unique per movie); for TV the show id (many entries per show, one per episode) */
    tmdbId: {
      type: Number,
      default: null,
      index: true,
    },
    poster_path: {
      type: String,
      default: null,
    },
    year: {
      type: Number,
      default: null,
    },
    requester : {
      id : {
        type : mongoose.Schema.Types.ObjectId,
        ref : 'user',
        required : false,
      },
      type : {
        type : String,
        enum : ['user', 'admin', 'guest'],
        required : false,
      }
    },
    mediaType: {
      type: String,
      enum: ['movie', 'tv'],
      default: 'movie',
    },
    /** Set when job is moved to waiting; used by downloader and webhooks. */
    jobId: {
      type: String,
      default: null,
    },
    /** For TV parent only: one doc per season (name, posterPath). */
    seasonMetadata: {
      type: [
        {
          seasonNumber: { type: Number },
          name: { type: String },
          posterPath: { type: String },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

// Sparse unique: many docs can have jobId null (TV parents, pending). When set, jobId must be unique.
downloadQueueSchema.index({ jobId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('DownloadQueue', downloadQueueSchema);
