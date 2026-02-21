const express = require('express');
const { tmdbApi } = require('../helper/api.helper');
const { formatMediaImageUrls } = require('../helper/tmdb.helper');
const { getDownloadStatuses } = require('../helper/movietv.helper');

const router = express.Router();

/**
 * GET /api/discover/movie?sort_by=...&page=...&with_genres=...
 * GET /api/discover/tv?sort_by=...&page=...&first_air_date_year=...
 * Forwards all query params to TMDB discover endpoint. Returns { results, page, total_pages, total_results } with image URLs formatted.
 * @see https://developer.themoviedb.org/reference/discover-movie
 * @see https://developer.themoviedb.org/reference/discover-tv
 */
async function discoverHandler(req, res) {
  const type = req.params.type;
  if (type !== 'movie' && type !== 'tv') {
    return res.status(400).json({ success: false, message: 'Type must be movie or tv' });
  }
  try {
    const params = { ...req.query };
    if (!params.language) params.language = 'en-US';
    const response = await tmdbApi.get(`/discover/${type}`, { params });
    const data = response.data || {};
    const rawResults = data.results || [];
    const results = rawResults.map(formatMediaImageUrls);
    let finalResults = results;
    if (type === 'movie') {
      const tmdbIds = rawResults.map((m) => m.id).filter(Boolean);
      const statusMap = tmdbIds.length > 0 ? await getDownloadStatuses(tmdbIds) : new Map();
      finalResults = results.map((m) => {
        const id = m.externalId ?? m.id;
        return { ...m, downloadStatus: id != null ? statusMap.get(Number(id)) ?? null : null };
      });
    }
    return res.status(200).json({
      success: true,
      data: {
        results: finalResults,
        page: data.page ?? 1,
        total_pages: data.total_pages ?? 0,
        total_results: data.total_results ?? 0,
      },
    });
  } catch (err) {
    const message = err.response?.data?.status_message || err.message || 'Discover request failed';
    return res.status(err.response?.status || 500).json({ success: false, message });
  }
}

router.get('/:type', (req, res, next) => {
  const t = (req.params.type || '').toLowerCase();
  if (t !== 'movie' && t !== 'tv') {
    return res.status(400).json({ success: false, message: 'Type must be movie or tv' });
  }
  req.params.type = t;
  return discoverHandler(req, res, next);
});

module.exports = router;
