const mongoose = require('mongoose');
const { Schema } = mongoose;

const serverSchema = new Schema({
  /** What this server is used for: tv, anime, and/or movie */
  usedFor: {
    type: [String],
    required: true,
    enum: ['tv', 'anime', 'movie'],
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
   * How to build the watch URL. Use {externalId} for TMDB id.
   * Examples: "/movie/{externalId}", "/embed?tmdb={externalId}", "" = open link as-is.
   */
  watchPathPattern: { type: String, trim: true, default: '' },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Server', serverSchema);
