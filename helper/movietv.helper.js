const ServerModel = require('../model/server.model');

/**
 * Build watch URL from server base link + watchPathPattern.
 * Replaces placeholders: {externalId}, {season}, {episode}
 * @param {object} server - { link, watchPathPattern, label }
 * @param {object} replacements - { externalId, season, episode }
 * @returns {string} Full URL
 */
function buildWatchUrl(server, replacements = {}) {
  const base = (server.link || '').replace(/\/+$/, '');
  let pattern = (server.watchPathPattern || '').trim();
  if (!pattern) return base;
  pattern = pattern
    .replace(/\{externalId\}/g, String(replacements.externalId ?? ''))
    .replace(/\{season\}/g, String(replacements.season ?? ''))
    .replace(/\{episode\}/g, String(replacements.episode ?? ''))
    .replace(/\{ss\}/g, String(replacements.season ?? ''))
    .replace(/\{eps\}/g, String(replacements.episode ?? ''));
  if (pattern.startsWith('http')) return pattern;
  return `${base}${pattern.startsWith('/') ? pattern : `/${pattern}`}`;
}

/**
 * Get watch links for a movie by TMDB external id.
 * Returns array of { label, link } ready to pass to frontend.
 * @param {number|string} externalId - TMDB movie id
 * @returns {Promise<Array<{ label: string, link: string }>>}
 */
async function formatMovie(externalId) {
  const servers = await ServerModel.find({ usedFor: 'movie' })
    .sort({ createdAt: -1 })
    .lean();
  return servers.map((s) => ({
    label: s.label || s.link || 'Watch',
    link: buildWatchUrl(s, { externalId }),
  }));
}

/**
 * Get watch links for a TV show by TMDB external id, season, and episode.
 * Returns array of { label, link } ready to pass to frontend.
 * Pattern can use {externalId}, {season}, {episode} (or {ss}, {eps}).
 * @param {number|string} externalId - TMDB TV id
 * @param {number|string} ss - season number
 * @param {number|string} eps - episode number
 * @returns {Promise<Array<{ label: string, link: string }>>}
 */
async function formatTv(externalId, ss, eps) {
  const servers = await ServerModel.find({ usedFor: 'tv' })
    .sort({ createdAt: -1 })
    .lean();
  return servers.map((s) => ({
    label: s.label || s.link || 'Watch',
    link: buildWatchUrl(s, {
      externalId,
      season: ss,
      episode: eps,
    }),
  }));
}


/**
 * Get all movie servers and format each to { label, link } for the given externalId.
 * @param {number|string} externalId - TMDB movie id
 * @returns {Promise<Array<{ label: string, link: string }>>}
 */
async function getAllMovieServers(externalId) {
  const servers = await ServerModel.find({ usedFor: 'movie' })
    .sort({ createdAt: -1 })
    .lean();
  return servers.map((s) => ({
    label: s.label || s.link || 'Watch',
    link: buildWatchUrl(s, { externalId }),
  }));
}

/**
 * Get all TV servers and format each to { label, link } for the given externalId, season, episode.
 * @param {number|string} externalId - TMDB TV id
 * @param {number|string} ss - season number
 * @param {number|string} eps - episode number
 * @returns {Promise<Array<{ label: string, link: string }>>}
 */
async function getAllTvServers(externalId, ss, eps) {
  const servers = await ServerModel.find({ usedFor: 'tv' })
    .sort({ createdAt: -1 })
    .lean();
  return servers.map((s) => ({
    label: s.label || s.link || 'Watch',
    link: buildWatchUrl(s, {
      externalId,
      season: ss,
      episode: eps,
    }),
  }));
}

module.exports = {
  buildWatchUrl,
  formatMovie,
  formatTv,
  getAllMovieServers,
  getAllTvServers,
};
