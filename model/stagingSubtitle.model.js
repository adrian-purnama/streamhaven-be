const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Staging table for subtitle files queued or attached to staging videos.
 * The actual file is stored in GridFS (stagingSubtitles bucket); this doc holds metadata and reference.
 */
const stagingSubtitleSchema = new Schema(
  {
    /** GridFS file _id (stagingSubtitles bucket) */
    gridFsFileId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    /** Original filename, e.g. "Exhuma (2024).srt" */
    filename: {
      type: String,
      required: true,
    },
    /** File size in bytes */
    size: {
      type: Number,
      required: true,
    },
    /** MIME type, e.g. application/x-subrip, text/plain */
    contentType: {
      type: String,
      default: 'application/x-subrip',
    },
    /** Language code (ISO 639-1), e.g. "en" */
    language: {
      type: String,
      required: true,
      index: true,
    },
    /** TMDB movie id (links subtitle to title) */
    tmdbId: {
      type: Number,
      default: null,
      index: true,
    },
    /** Optional: link to staging video doc when subtitle is for a specific staged video */
    stagingVideoId: {
      type: Schema.Types.ObjectId,
      ref: 'StagingVideo',
      default: null,
      index: true,
    },
    /**
     * pending = in staging.
     * uploaded = attached/uploaded to Abyss (or consumed).
     * error = processing/upload error.
     */
    status: {
      type: String,
      enum: ['pending', 'uploaded', 'error'],
      default: 'pending',
      index: true,
    },
    /** Error message when status === 'error' */
    errorMessage: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

stagingSubtitleSchema.index({ tmdbId: 1, language: 1 });

module.exports = mongoose.model('StagingSubtitle', stagingSubtitleSchema);
