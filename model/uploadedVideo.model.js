const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Record of videos successfully uploaded to Abyss (file lives on Abyss, not in our DB).
 * Used for mapping (TMDB ↔ Abyss), "my uploads" list, and slug status.
 */
const uploadedVideoSchema = new Schema(
  {
    /** 'movie' | 'tv'. Default 'movie' for backward compatibility. */
    mediaType: {
      type: String,
      enum: ['movie', 'tv'],
      default: 'movie',
      index: true,
    },
    /** TMDB movie id (movies) or show id (TV). For TV, one row per episode. */
    externalId: {
      type: Number,
      default: null,
      index: true,
    },
    /** Display title. For TV, often episode title or "Show S01E01". */
    title: {
      type: String,
      default: '',
    },
    /** TV only: season number (1-based). */
    seasonNumber: {
      type: Number,
      default: null,
      index: true,
    },
    /** TV only: episode number within season (1-based). */
    episodeNumber: {
      type: Number,
      default: null,
      index: true,
    },
    poster_path: {
      type: String,
      default: null,
    },
    /** Abyss slug (video identifier on Abyss) */
    abyssSlug: {
      type: String,
      required: true,
      index: true,
    },
    /** Slug status on Abyss: uploaded_not_ready | ready */
    slugStatus: {
      type: String,
      enum: ['uploaded_not_ready', 'ready'],
      default: 'uploaded_not_ready',
      index: true,
    },
    /** Original filename (for display) */
    filename: {
      type: String,
      default: null,
    },
    /** File size in bytes (for display) */
    size: {
      type: Number,
      default: null,
    },
    subtitle: {
      availableSubtitles: {
        type: [String],
        default: [],
      },
      downloadedSubtitles: {
        type: [String],
        default: [],
      },
      lastCacheAvailableSubtitles: {
        type: Date,
        default: null,
      },
    },
  },
  { timestamps: true }
);

uploadedVideoSchema.index({ externalId: 1, slugStatus: 1 });
uploadedVideoSchema.index({ externalId: 1, seasonNumber: 1, episodeNumber: 1 });
module.exports = mongoose.model('UploadedVideo', uploadedVideoSchema);
