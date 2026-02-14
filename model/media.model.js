const mongoose = require('mongoose');
const { Schema } = mongoose;

const mediaSchema = new Schema({
  /** TMDB id (movie or tv). Unique per mediaType. */
  externalId: {
    type: Number,
    required: true,
    index: true,
  },
  /** 'movie' | 'tv' so we can cache both in one collection. */
  mediaType: {
    type: String,
    required: true,
    enum: ['movie', 'tv'],
    index: true,
  },
  category: {
    type: String,
    required: true,
    enum: ['now_playing', 'popular', 'top_rated', 'top_pick'],
    index: true,
  },
  adult: { type: Boolean, default: false },
  backdrop_path: { type: String, default: null },
  genre_ids: [{ type: Number }],
  original_language: { type: String, default: '' },
  original_title: { type: String, default: '' },
  overview: { type: String, default: '' },
  popularity: { type: Number, default: 0 },
  poster_path: { type: String, default: null },
  release_date: { type: String, default: '' },
  title: { type: String, required: true },
  video: { type: Boolean, default: false },
  vote_average: { type: Number, default: 0 },
  vote_count: { type: Number, default: 0 },
  episode_group:{
    episode_count: { type: Number, default: 0 },
    group_count: { type: Number, default: 0 },
  }
}, {
  timestamps: true,
});

mediaSchema.index({ externalId: 1, mediaType: 1, category: 1 }, { unique: true });

module.exports = mongoose.model('Media', mediaSchema);
