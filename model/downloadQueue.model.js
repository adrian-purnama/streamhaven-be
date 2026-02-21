const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Queue of videos to be downloaded (torrent) then uploaded to staging.
 * Backend processes one by one: calls Python downloader with jobId; Python calls webhooks on download-done and upload-done.
 */
const downloadQueueSchema = new Schema(
  {
    /** Search title for torrent (e.g. "World War Z 2013") */
    title: {
      type: String,
      required: true,
      index: true,
    },
    /**
     * pending = in queue, not yet selected
     * waiting = selected by "Process next", waiting to be started
     * downloading = Python is downloading
     * uploading = download done, Python is uploading to staging
     * done = uploaded to staging (stagingId set)
     * failed = error (errorMessage set)
     */
    quality : {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'high',
    },
    status: {
      type: String,
      enum: ['pending', 'waiting', 'searching', 'downloading', 'uploading', 'done', 'failed'],
      default: 'pending',
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
    /** Optional TMDB id for staging metadata */
    tmdbId: {
      type: Number,
      default: null,
      unique: true,
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
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('DownloadQueue', downloadQueueSchema);
