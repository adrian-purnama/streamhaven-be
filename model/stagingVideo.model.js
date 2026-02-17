const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Staging table for videos queued for upload to Abyss.
 * The actual file is stored in GridFS (stagingVideos bucket); this doc holds metadata and reference.
 */
const stagingVideoSchema = new Schema(
  {
    /** GridFS file _id (stagingVideos bucket) */
    gridFsFileId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    /** Original filename as uploaded */
    filename: {
      type: String,
      required: true,
    },
    /** File size in bytes */
    size: {
      type: Number,
      required: true,
    },
    /** MIME type, e.g. video/mp4 */
    contentType: {
      type: String,
      default: 'video/mp4',
    },
    /** TMDB movie id (for mapping after Abyss upload) */
    tmdbId: {
      type: Number,
      default: null,
      index: true,
    },
    /** IMDB id if used */
    imdbId: {
      type: String,
      default: null,
    },
    poster_path: {
      type: String,
      default: null,
    },
    /** Display title (from TMDB or user) */
    title: {
      type: String,
      default: '',
    },
    /**
     * writing = file is still being streamed to GridFS (do not show in staging list).
     * pending = still in staging, queued.
     * uploading = currently uploading to Abyss.
     * storage_fail / daily_fail / max_upload_fail = Abyss quota check failed; retry tomorrow.
     * uploaded_not_ready = uploaded to Abyss, slug not ready yet.
     * ready = uploaded and slug ready on Abyss.
     * error = generic upload/processing error.
     */
    status: {
      type: String,
      enum: ['writing', 'pending', 'uploading', 'storage_fail', 'daily_fail', 'max_upload_fail', 'uploaded_not_ready', 'ready', 'error'],
      default: 'pending',
      index: true,
    },
    /** Error message when status === 'error' */
    errorMessage: {
      type: String,
      default: null,
    },
    /** Abyss slug after successful upload (uploaded_not_ready or ready) */
    abyssSlug: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StagingVideo', stagingVideoSchema);
