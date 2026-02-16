const mongoose = require('mongoose');
const { Schema } = mongoose;

const serverSchema = new Schema({
  /** What this server is used for: tv, anime, movie, and/or my_player */
  usedFor: {
    type: [String],
    required: true,
    enum: ['tv', 'anime', 'movie', 'my_player'],
    default: [],
  },
  /** Server base URL (no trailing slash) */
  link: {
    type: String,
    required: true,
    trim: true,
  },
  /** Display name (e.g. "Server 1", "Backup stream") */
  label: { type: String, trim: true, default: '' },
  /**
   * How to build the watch URL. Use {externalId} for TMDB id; use {slug} for my_player (Abyss slug).
   * Examples: "/movie/{externalId}", "/embed?tmdb={externalId}", "/watch/{slug}", "" = open link as-is.
   */
  watchPathPattern: { type: String, trim: true, default: '' },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Server', serverSchema);
