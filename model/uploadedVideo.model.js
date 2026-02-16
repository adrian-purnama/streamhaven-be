const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Record of videos successfully uploaded to Abyss (file lives on Abyss, not in our DB).
 * Used for mapping (TMDB ↔ Abyss), "my uploads" list, and slug status.
 */
const uploadedVideoSchema = new Schema(
  {
    /** TMDB movie id */
    externalId: {
      type: Number,
      default: null,
      index: true,
    },
    /** Display title */
    title: {
      type: String,
      default: '',
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
  },
  { timestamps: true }
);

uploadedVideoSchema.index({ externalId: 1, slugStatus: 1 });
module.exports = mongoose.model('UploadedVideo', uploadedVideoSchema);
