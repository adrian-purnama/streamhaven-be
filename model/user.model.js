const mongoose = require('mongoose');

/** Simplified saved show (movie or TV) for user folders. */
const savedItemSchema = new mongoose.Schema({
  externalId: { type: Number, required: true },
  mediaType: { type: String, required: true, enum: ['movie', 'tv'] },
  title: { type: String, required: true },
  poster_url: { type: String, default: '' },
  category: { type: String, default: '' },
  vote_average: { type: Number, default: 0 },
  release_date: { type: String, default: '' },
  genre_ids: [{ type: Number }],
  overview: { type: String, default: '' },
  episode_group: {
    episode_count: { type: Number, default: 0 },
    group_count: { type: Number, default: 0 },
  },
}, { _id: true });

const folderSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  saved: { type: [savedItemSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

/** Display/rendering preferences. All optional; defaults applied in API. */
const preferencesSchema = new mongoose.Schema({
  /** 'current' = below Watch button, 'topRight' = top-right of poster, 'hidden' = do not show */
  saveButtonPosition: { type: String, enum: ['bottom_center', 'top_right', 'hidden'], default: 'bottom_center' },
  /** true = show "Watch now" button; false = click poster to watch immediately */
  showWatchButton: { type: Boolean, default: true },
  /** true = show Top pick row on home page */
  showTopPickOnHome: { type: Boolean, default: true },
  /** true = show movie title on poster */
  showPosterTitle: { type: Boolean, default: false },
}, { _id: false });

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  profile_url: {
    type: String,
    default: '',
  },
  isAdmin: {
    type: Boolean,
    default: false,
  },
  folders: {
    type: [folderSchema],
    default: [],
  },
  preferences: {
    type: preferencesSchema,
    default: () => ({}),
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  googleId: {
    type: String,
    default: '',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('user', userSchema);
