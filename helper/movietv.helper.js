const ServerModel = require('../model/server.model');
const UploadedVideoModel = require('../model/uploadedVideo.model');
const DownloadQueueModel = require('../model/downloadQueue.model');
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
 * When an uploaded video exists with slugStatus 'ready' (ad-free), prepends my_player (StreamHaven) links.
 * @param {number|string} externalId - TMDB movie id
 * @param {{ adFree?: boolean }} [options] - unused; kept for API compatibility
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

  const uploaded = await UploadedVideoModel.findOne({
    mediaType: 'movie',
    externalId: Number(externalId),
    slugStatus: 'ready',
  }).lean();
  if (uploaded?.abyssSlug) {
    const myPlayerLinks = await getAllMyPlayerServers(uploaded.abyssSlug);
    links = [...myPlayerLinks, ...links];
  }

  return links;
}

/**
 * Get all TV servers and format each to { label, link } for the given externalId, season, episode.
 * When an uploaded video exists for this episode (tmdb show + season + episode) with slugStatus 'ready' (ad-free),
 * prepends my_player (StreamHaven) links using that episode's abyssSlug.
 * @param {number|string} externalId - TMDB TV id (show id)
 * @param {number|string} ss - season number
 * @param {number|string} eps - episode number
 * @param {{ adFree?: boolean }} [options] - unused; kept for API compatibility
 * @returns {Promise<Array<{ label: string, link: string }>>}
 */
async function getAllTvServers(externalId, ss, eps, options = {}) {
  const servers = await ServerModel.find({ usedFor: 'tv' })
    .sort({ createdAt: -1 })
    .lean();
  let links = servers.map((s) => ({
    label: s.label || s.link || 'Watch',
    link: buildWatchUrl(s, {
      externalId,
      season: ss,
      episode: eps,
    }),
  }));

  const uploaded = await UploadedVideoModel.findOne({
    mediaType: 'tv',
    externalId: Number(externalId),
    seasonNumber: Number(ss) ?? null,
    episodeNumber: Number(eps) ?? null,
    slugStatus: 'ready',
  }).lean();
  if (uploaded?.abyssSlug) {
    const myPlayerLinks = await getAllMyPlayerServers(uploaded.abyssSlug);
    links = [...myPlayerLinks, ...links];
  }

  return links;
}

/**
 * Get download status for a single TV episode (by show id + season + episode).
 * @param {number|string} showId - TMDB show id
 * @param {number|string} seasonNumber - season number
 * @param {number|string} episodeNumber - episode number
 * @returns {Promise<'ad_free'|'processing'|null>} 'ad_free' when uploaded and ready, 'processing' when uploaded but not ready, null when not uploaded
 */
async function getTvEpisodeDownloadStatus(showId, seasonNumber, episodeNumber) {
  const uploaded = await UploadedVideoModel.findOne({
    mediaType: 'tv',
    externalId: Number(showId),
    seasonNumber: Number(seasonNumber) || null,
    episodeNumber: Number(episodeNumber) || null,
  }).lean();
  if (!uploaded) return null;
  return uploaded.slugStatus === 'ready' ? 'ad_free' : 'processing';
}

/**
 * For a given TV show + season, return the list of episode numbers that are ad-free (uploaded and ready).
 * @param {number|string} showId - TMDB show id
 * @param {number|string} seasonNumber - season number
 * @returns {Promise<number[]>} Sorted unique list of episode numbers
 */
async function getTvSeasonAdFreeEpisodes(showId, seasonNumber) {
  const docs = await UploadedVideoModel.find({
    mediaType: 'tv',
    externalId: Number(showId),
    seasonNumber: Number(seasonNumber) || null,
    slugStatus: 'ready',
  }).lean();
  const nums = [...new Set(docs.map((d) => d.episodeNumber).filter((n) => Number.isFinite(n)))];
  nums.sort((a, b) => a - b);
  return nums;
}

/**
 * Get download status for multiple TV shows by TMDB id (based on uploaded TV episodes).
 * For each show id, returns:
 * - 'ad_free' if any episode has slugStatus 'ready'
 * - 'processing' if at least one episode exists but none are ready yet
 * - null if no uploaded episodes exist for that show
 * @param {Array<number|string>} tvIds - Array of TMDB TV ids (show ids)
 * @returns {Promise<Map<number, string|null>>}
 */
async function getTvShowsDownloadStatuses(tvIds = []) {
  const ids = [...new Set(tvIds.map((id) => Number(id)).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const uploadedDocs = await UploadedVideoModel.find({
    mediaType: 'tv',
    externalId: { $in: ids },
  }).lean();

  const byShow = new Map();
  for (const doc of uploadedDocs) {
    const key = Number(doc.externalId);
    if (!byShow.has(key)) byShow.set(key, []);
    byShow.get(key).push(doc);
  }

  const statusMap = new Map();
  for (const id of ids) {
    const docs = byShow.get(id) || [];
    if (docs.length === 0) {
      statusMap.set(id, null);
      continue;
    }
    if (docs.some((d) => d.slugStatus === 'ready')) {
      statusMap.set(id, 'ad_free');
    } else {
      statusMap.set(id, 'processing');
    }
  }

  return statusMap;
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

/**
 * Batch-fetch download status for multiple movies by TMDB id.
 * Uses 2 DB queries total (DownloadQueue + UploadedVideo) instead of 2 per movie.
 * @param {Array<number|string>} tmdbIds - Array of TMDB movie ids
 * @returns {Promise<Map<number, string>>} Map of tmdbId -> status. Values: 'ad_free' | 'processing' | 'staging' | queue status (pending, waiting, searching, downloading, failed)
 */
async function getDownloadStatuses(tmdbIds = []) {
  const ids = [...new Set(tmdbIds.map((id) => Number(id)).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const [downloadQueueDocs, uploadedDocs] = await Promise.all([
    DownloadQueueModel.find({ tmdbId: { $in: ids } }).lean(),
    UploadedVideoModel.find({ externalId: { $in: ids } }).lean(),
  ]);

  const queueByTmdb = new Map(downloadQueueDocs.map((d) => [d.tmdbId, d]));
  const uploadedByTmdb = new Map(uploadedDocs.map((d) => [d.externalId, d.slugStatus]));

  const statusMap = new Map();
  for (const tmdbId of ids) {
    const queue = queueByTmdb.get(tmdbId);
    if (queue) {
      if (queue.status === 'done') {
        const slugStatus = uploadedByTmdb.get(tmdbId);
        statusMap.set(tmdbId, slugStatus === 'ready' ? 'ad_free' : 'processing');
      } else if (queue.status === 'uploading') {
        statusMap.set(tmdbId, 'staging');
      } else {
        statusMap.set(tmdbId, queue.status);
      }
    } else {
      const slugStatus = uploadedByTmdb.get(tmdbId);
      if (slugStatus) {
        statusMap.set(tmdbId, slugStatus === 'ready' ? 'ad_free' : 'processing');
      } else {
        statusMap.set(tmdbId, null);
      }
    }
  }
  return statusMap;
}

module.exports = {
  getPosterUrl,
  buildWatchUrl,
  formatMovie,
  formatTv,
  getAllMovieServers,
  getAllTvServers,
  getAllMyPlayerServers,
  getDownloadStatuses,
  getTvShowsDownloadStatuses,
  getTvEpisodeDownloadStatus,
  getTvSeasonAdFreeEpisodes,
};
