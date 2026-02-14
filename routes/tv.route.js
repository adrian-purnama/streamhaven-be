const express = require('express');
const mongoose = require('mongoose');
const {
    syncOnTheAirTv,
    syncPopularTv,
    syncTopRatedTv,
    shouldSyncTv,
    getLastSyncTv,
    setLastSyncTv,
    formatMediaImageUrls,
    formatEpisodeGroups,
    fetchTvDetails,
} = require('../helper/tmdb.helper');
const { getAllTvServers } = require('../helper/movietv.helper');
const { validateAdmin, validateToken } = require('../helper/validate.helper');
const MediaModel = require('../model/media.model');
const { tmdbApi } = require('../helper/api.helper');
const router = express.Router();

/** Paginated category list from TMDB (now_playing -> on_the_air, popular, top_rated). GET /api/tv/now_playing?page=1 */
function paginatedCategoryHandler(tmdbSegment) {
    const pathMap = {
        now_playing: 'on_the_air',
        popular: 'popular',
        top_rated: 'top_rated',
    };
    const path = pathMap[tmdbSegment] || tmdbSegment;
    return async (req, res) => {
        try {
            const page = Math.max(1, parseInt(req.query.page, 10) || 1);
            const response = await tmdbApi.get(`/tv/${path}`, { params: { language: 'en-US', page } });
            const data = response.data || {};
            const results = (data.results || []).map(formatMediaImageUrls);
            return res.status(200).json({
                success: true,
                data: {
                    results,
                    page: data.page ?? page,
                    total_pages: data.total_pages ?? 1,
                    total_results: data.total_results ?? 0,
                },
            });
        } catch (err) {
            const message = err.response?.data?.status_message || err.message || 'Failed to fetch TV';
            return res.status(err.response?.status || 500).json({ success: false, message });
        }
    };
}

router.post('/sync', validateToken, validateAdmin, async (req, res) => {
    const { override } = req.body;
    try {
        if (shouldSyncTv() || override) {
            await syncOnTheAirTv();
            await syncPopularTv();
            await syncTopRatedTv();
            setLastSyncTv(Date.now());
            return res.status(200).json({
                success: true,
                message: 'TV synced',
                lastSync: getLastSyncTv(),
            });
        }
        return res.status(200).json({
            success: true,
            message: 'TV already synced',
            lastSync: getLastSyncTv(),
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || 'Failed to sync TV',
        });
    }
});

router.get('/sync', async (req, res) => {
    return res.status(200).json({
        success: true,
        lastSync: getLastSyncTv(),
    });
});

async function getTvByIdHandler(req, res) {
    const { id } = req.params;
    const season = Math.max(1, parseInt(req.params.ss ?? req.query.ss ?? req.query.season, 10) || 1);
    const episode = Math.max(1, parseInt(req.params.eps ?? req.query.eps ?? req.query.episode, 10) || 1);
    try {
        const tmdbId = parseInt(id, 10);
        if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
            return res.status(404).json({ success: false, message: 'TV show not found' });
        }

        const tmdbDetails = await fetchTvDetails(tmdbId, true, true);
        if (!tmdbDetails) {
            return res.status(404).json({ success: false, message: 'TV show not found' });
        }

        const rawRecommendations = tmdbDetails.recommendations?.results ?? [];
        const recommendations = rawRecommendations.map(formatMediaImageUrls);

        const merged = { ...tmdbDetails, recommendations };
        Object.assign(merged, {
            overview: tmdbDetails.overview ?? merged.overview,
            title: tmdbDetails.name ?? merged.title,
            poster_path: tmdbDetails.poster_path ?? merged.poster_path,
            backdrop_path: tmdbDetails.backdrop_path ?? merged.backdrop_path,
            release_date: tmdbDetails.first_air_date ?? merged.release_date,
            number_of_seasons: tmdbDetails.number_of_seasons,
            number_of_episodes: tmdbDetails.number_of_episodes,
            seasons: (tmdbDetails.seasons || []).map(formatMediaImageUrls),
            genres: tmdbDetails.genres,
        });
        if (merged.id !== undefined) delete merged.id;

        const watchLinks = await getAllTvServers(tmdbId, season, episode);
        const data = formatMediaImageUrls(merged);
        data.watchLinks = watchLinks;
        data.season = season;
        data.episode = episode;
        data.episode_group = formatEpisodeGroups(tmdbDetails.episode_groups);
        if (tmdbDetails.next_episode_to_air != null) {
            data.next_episode_to_air = tmdbDetails.next_episode_to_air;
        }

        return res.status(200).json({
            success: true,
            data,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || 'Failed to get TV show',
        });
    }
}

router.get('/now_playing', paginatedCategoryHandler('now_playing'));
router.get('/popular', paginatedCategoryHandler('popular'));
router.get('/top_rated', paginatedCategoryHandler('top_rated'));

router.get('/:id/:ss/:eps', getTvByIdHandler);
router.get('/:id', getTvByIdHandler);

router.get('/', async (req, res) => {
    const { category } = req.query;
    try {
        if (!category) {
            const [now_playing, popular, top_rated] = await Promise.all([
                MediaModel.find({ category: 'now_playing', mediaType: 'tv' }).sort({ popularity: -1 }).lean(),
                MediaModel.find({ category: 'popular', mediaType: 'tv' }).sort({ popularity: -1 }).lean(),
                MediaModel.find({ category: 'top_rated', mediaType: 'tv' }).sort({ vote_average: -1 }).lean(),
            ]);
            return res.status(200).json({
                success: true,
                data: {
                    now_playing: now_playing.map(formatMediaImageUrls),
                    popular: popular.map(formatMediaImageUrls),
                    top_rated: top_rated.map(formatMediaImageUrls),
                },
            });
        }
        const list = await MediaModel.find({ category }).lean();
        return res.status(200).json({
            success: true,
            data: list.map(formatMediaImageUrls),
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || 'Failed to get TV',
        });
    }
});

module.exports = router;
