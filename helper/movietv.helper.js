const ServerModel = require('../model/server.model');
const UploadedVideoModel = require('../model/uploadedVideo.model');
const { tmdbImageUrl } = require('./tmdb.helper');

/**
 * Full TMDB poster URL for a poster_path (e.g. from download queue or staging).
 * @param {string | null | undefined} posterPath - TMDB path (e.g. "/abc.jpg")
 * @param {string} [size='w200'] - Size segment (e.g. "w200", "w500")
 * @returns {string | null}
 */
function getPosterUrl(posterPath, size = 'w200') {
  return tmdbImageUrl(posterPath, size) || null;
}

/**
 * Build watch URL from server base link + watchPathPattern.
 * Replaces placeholders: {externalId}, {slug}, {season}, {episode}
 * @param {object} server - { link, watchPathPattern, label }
 * @param {object} replacements - { externalId, slug, season, episode }
 * @returns {string} Full URL
 */
function buildWatchUrl(server, replacements = {}) {
  const base = (server.link || '').replace(/\/+$/, '');
  let pattern = (server.watchPathPattern || '').trim();
  if (!pattern) return base;
  pattern = pattern
    .replace(/\{externalId\}/g, String(replacements.externalId ?? ''))
    .replace(/\{slug\}/g, String(replacements.slug ?? ''))
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
 * If options.adFree is true, also appends my_player links when an uploaded video exists with slugStatus 'ready'.
 * @param {number|string} externalId - TMDB movie id
 * @param {{ adFree?: boolean }} [options] - adFree: if true, include my_player links when uploaded video is ready
 * @returns {Promise<Array<{ label: string, link: string }>>}
 */
async function getAllMovieServers(externalId, options = {}) {
  const servers = await ServerModel.find({ usedFor: 'movie' })
    .sort({ createdAt: -1 })
    .lean();
  let links = servers.map((s) => ({
    label: s.label || s.link || 'Watch',
    link: buildWatchUrl(s, { externalId }),
  }));

  if (options.adFree === true) {
    const uploaded = await UploadedVideoModel.findOne({
      externalId: Number(externalId),
      slugStatus: 'ready',
    }).lean();
    if (uploaded?.abyssSlug) {
      const myPlayerLinks = await getAllMyPlayerServers(uploaded.abyssSlug);
      links = [ ...myPlayerLinks, ...links];
    }
  }

  return links;
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

/**
 * Get all my_player servers and format each to { label, link } for the given Abyss slug.
 * Pattern uses {slug} for the video slug.
 * @param {string} slug - Abyss slug (video identifier)
 * @returns {Promise<Array<{ label: string, link: string }>>}
 */
async function getAllMyPlayerServers(slug) {
  const servers = await ServerModel.find({ usedFor: 'my_player' })
    .sort({ createdAt: -1 })
    .lean();
  return servers.map((s) => ({
    label: s.label || s.link || 'Watch',
    link: buildWatchUrl(s, { slug }),
  }));
}

module.exports = {
  getPosterUrl,
  buildWatchUrl,
  formatMovie,
  formatTv,
  getAllMovieServers,
  getAllTvServers,
  getAllMyPlayerServers,
};
