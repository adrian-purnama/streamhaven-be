const express = require('express');
const mongoose = require('mongoose');
const { syncNowPlayingMovies, syncPopularMovies, syncTopRatedMovies, shouldSync, getLastSync, setLastSync, syncOnTheAirTv, syncPopularTv, syncTopRatedTv, shouldSyncTv, setLastSyncTv, syncMovieGenres, syncTvGenres, formatMediaImageUrls, formatMultiSearchResult, fetchMovieDetails, fetchMovieByImdbId, fetchMovieByTmdbId, saveMovieToCache } = require('../helper/tmdb.helper');
const { getAllMovieServers } = require('../helper/movietv.helper');
const { validateAdmin, validateToken, optionalValidateToken } = require('../helper/validate.helper');
const MediaModel = require('../model/media.model');
const { tmdbApi } = require('../helper/api.helper');
const router = express.Router();



router.post('/sync', validateToken, validateAdmin, async (req, res) => {
    const {override} = req.body;
    try {
        if (shouldSync() || override) {
            await syncNowPlayingMovies();
            await syncPopularMovies();
            await syncTopRatedMovies();
            setLastSync(Date.now());
            return res.status(200).json({
                success: true,
                message: 'Movies synced',
                lastSync: getLastSync(),
            });
        }
        return res.status(200).json({
            success: true,
            message: 'Movies already synced',
            lastSync: getLastSync(),
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || 'Failed to sync movies',
        });
    }
});

router.get('/sync', async (req, res) => {
    return res.status(200).json({
        success: true,
        lastSync: getLastSync(),
    });
});

router.get('/top-pick', validateToken, validateAdmin, async (req, res) => {
    const { imdb_id, tmdb_id } = req.query;
    try {
        const hasImdb = imdb_id != null && String(imdb_id).trim();
        const hasTmdb = tmdb_id != null && String(tmdb_id).trim() !== '';
        if (!hasImdb && !hasTmdb) {
            return res.status(400).json({
                success: false,
                message: 'imdb_id or tmdb_id is required',
            });
        }
        const movie = hasTmdb
            ? await fetchMovieByTmdbId(tmdb_id)
            : await fetchMovieByImdbId(imdb_id);
        if (!movie) {
            return res.status(404).json({
                success: false,
                message: hasTmdb ? 'Movie not found for this TMDB id' : 'Movie not found for this IMDB id',
            });
        }
        return res.status(200).json({
            success: true,
            data: formatMediaImageUrls(movie),
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || 'Failed to fetch movie',
        });
    }
});

router.delete('/top-pick/:id', validateToken, validateAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid id' });
        }
        const doc = await MediaModel.findOneAndDelete({
            _id: id,
            category: 'top_pick',
            mediaType: 'movie',
        });
        if (!doc) {
            return res.status(404).json({
                success: false,
                message: 'Top pick not found or already removed',
            });
        }
        return res.status(200).json({
            success: true,
            message: 'Top pick removed',
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || 'Failed to delete top pick',
        });
    }
});

router.post('/top-pick', validateToken, validateAdmin, async (req, res) => {
    const { imdb_id, tmdb_id } = req.body;
    try {
        const hasImdb = imdb_id != null && String(imdb_id).trim();
        const hasTmdb = tmdb_id != null && (typeof tmdb_id === 'number' || String(tmdb_id).trim());
        if (!hasImdb && !hasTmdb) {
            return res.status(400).json({
                success: false,
                message: 'imdb_id or tmdb_id is required',
            });
        }
        const movie = hasTmdb
            ? await fetchMovieByTmdbId(tmdb_id)
            : await fetchMovieByImdbId(imdb_id);
        if (!movie) {
            return res.status(404).json({
                success: false,
                message: hasTmdb ? 'Movie not found for this TMDB id' : 'Movie not found for this IMDB id',
            });
        }
        const saved = await saveMovieToCache(movie, 'top_pick');
        return res.status(200).json({
            success: true,
            message: 'Saved as top pick',
            data: formatMediaImageUrls(saved),
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || 'Failed to save top pick',
        });
    }
});

/** Paginated category list from TMDB (now_playing, popular, top_rated). GET /api/movies/now_playing?page=1 */
function paginatedCategoryHandler(tmdbSegment) {
    const pathMap = {
        now_playing: 'now_playing',
        popular: 'popular',
        top_rated: 'top_rated',
    };
    const path = pathMap[tmdbSegment] || tmdbSegment;
    return async (req, res) => {
        try {
            const page = Math.max(1, parseInt(req.query.page, 10) || 1);
            const response = await tmdbApi.get(`/movie/${path}`, { params: { language: 'en-US', page } });
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
            const message = err.response?.data?.status_message || err.message || 'Failed to fetch movies';
            return res.status(err.response?.status || 500).json({ success: false, message });
        }
    };
}

router.get('/now_playing', paginatedCategoryHandler('now_playing'));
router.get('/popular', paginatedCategoryHandler('popular'));
router.get('/top_rated', paginatedCategoryHandler('top_rated'));

router.get('/:id', optionalValidateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const tmdbDetails = await fetchMovieDetails(id, true);
        if (!tmdbDetails) {
            return res.status(404).json({ success: false, message: 'Movie not found' });
        }

        const rawRecommendations = tmdbDetails.recommendations?.results ?? [];
        const recommendations = rawRecommendations.map(formatMediaImageUrls);

        const merged = { ...tmdbDetails, recommendations };

        Object.assign(merged, {
            overview: tmdbDetails.overview ?? merged.overview,
            title: tmdbDetails.title ?? merged.title,
            poster_path: tmdbDetails.poster_path ?? merged.poster_path,
            backdrop_path: tmdbDetails.backdrop_path ?? merged.backdrop_path,
            release_date: tmdbDetails.release_date ?? merged.release_date,
            runtime: tmdbDetails.runtime,
            imdb_id: tmdbDetails.imdb_id,
            genres: tmdbDetails.genres,
        });
        if (merged.id !== undefined) delete merged.id;

        const watchLinks = await getAllMovieServers(id, { adFree: req.user?.adFree === true });

        const data = formatMediaImageUrls(merged);
        data.watchLinks = watchLinks;
        return res.status(200).json({
            success: true,
            data,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || 'Failed to get movie',
        });
    }
});

router.get('/', async (req, res) => {
    const { category } = req.query;
    try {
        // Once a day: sync movies, TV, and genres when this endpoint is hit
        if (shouldSync() || shouldSyncTv()) {
            if (shouldSync()) {
                await syncNowPlayingMovies();
                await syncPopularMovies();
                await syncTopRatedMovies();
                setLastSync(Date.now());
            }
            if (shouldSyncTv()) {
                await syncOnTheAirTv();
                await syncPopularTv();
                await syncTopRatedTv();
                setLastSyncTv(Date.now());
            }
            await syncMovieGenres();
            await syncTvGenres();
        }

        if (!category) {
            const [top_pick, popular, now_playing, top_rated] = await Promise.all([
                MediaModel.find({ category: 'top_pick', mediaType: 'movie' }).sort({ popularity: -1 }).lean(),
                MediaModel.find({ category: 'now_playing', mediaType: 'movie' }).sort({ popularity: -1 }).lean(),
                MediaModel.find({ category: 'popular', mediaType: 'movie' }).sort({ popularity: -1 }).lean(),
                MediaModel.find({ category: 'top_rated', mediaType: 'movie' }).sort({ vote_average: -1 }).lean()
            ]);


            return res.status(200).json({
                success: true,
                data: {
                    now_playing: now_playing.map(formatMediaImageUrls),
                    popular: popular.map(formatMediaImageUrls),
                    top_rated: top_rated.map(formatMediaImageUrls),
                    top_pick: top_pick.map(formatMediaImageUrls),
                },
            });
        }
        const movies = await MediaModel.find({ category }).lean();
        return res.status(200).json({
            success: true,
            data: movies.map(formatMediaImageUrls),
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || 'Failed to get movies',
        });
    }
});

router.post('/search/:query/:includeAdult/:page', async (req, res) => {
    try {
        const { query, includeAdult, page } = req.params;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const encodedQuery = encodeURIComponent(query);
        const rawResults = await tmdbApi.get(
            `/search/multi?query=${encodedQuery}&include_adult=${includeAdult}&page=${pageNum}`
        );
        const rawList = rawResults.data?.results ?? [];
        const results = Array.isArray(rawList) ? rawList.map(formatMultiSearchResult) : [];
        const totalPages = Math.max(1, rawResults.data?.total_pages ?? 1);
        const totalResults = rawResults.data?.total_results ?? 0;
        return res.status(200).json({
            success: true,
            data: results,
            page: pageNum,
            total_pages: totalPages,
            total_results: totalResults,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || 'Failed to search',
        });
    }
});

module.exports = router;