const { tmdbApi } = require("./api.helper");
const GenreModel = require("../model/genre.model");
const MediaModel = require("../model/media.model");
let lastSync = Date.now();
let lastSyncTv = Date.now();
const SYNC_INTERVAL = 1000 * 60 * 60 * 24;

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

/**
 * @param {string | null | undefined} path - TMDB path (e.g. "/abc.jpg")
 * @param {string} size - Size segment (e.g. "w200", "w300", "original")
 * @returns {string | null} Full image URL or null
 */
const tmdbImageUrl = (path, size = 'w200') => {
    if (!path || typeof path !== 'string') return null;
    const clean = path.startsWith('/') ? path : `/${path}`;
    return `${TMDB_IMAGE_BASE}/${size}${clean}`;
};

/**
 * @param {object} media - Media doc with poster_path, backdrop_path
 * @returns {object} Same doc with poster_url, backdrop_url, backdrop_url_high added
 */
const formatMediaImageUrls = (media) => {
    if (!media) return media;
    return {
        ...media,
        poster_url: tmdbImageUrl(media.poster_path, 'w500'),
        backdrop_url: tmdbImageUrl(media.backdrop_path, 'w300'),
        backdrop_url_high: tmdbImageUrl(media.backdrop_path, 'w1280'),
    };
};

/**
 * Format a single result from TMDB multi search (movie, tv, or person).
 * - movie/tv: adds poster_url, backdrop_url, backdrop_url_high
 * - person: adds profile_url and formats known_for[] with poster/backdrop URLs
 */
const formatMultiSearchResult = (item) => {
    if (!item) return item;
    if (item.media_type === 'person') {
        return {
            ...item,
            profile_url: tmdbImageUrl(item.profile_path, 'w185'),
            known_for: (item.known_for || []).map(formatMediaImageUrls),
        };
    }
    return formatMediaImageUrls(item);
};

const getLastSync = () => lastSync;
const setLastSync = (ts) => { lastSync = ts; };
const getLastSyncTv = () => lastSyncTv;
const setLastSyncTv = (ts) => { lastSyncTv = ts; };

const shouldSync = () => {
    return Date.now() - lastSync > SYNC_INTERVAL;
};
const shouldSyncTv = () => {
    return Date.now() - lastSyncTv > SYNC_INTERVAL;
};

const getMovieGenres = async () => {
    const response = await tmdbApi.get('/genre/movie/list?language=en');
    console.log(response);
    return response.data.genres;
}

const getTvGenres = async () => {
    const response = await tmdbApi.get('/genre/tv/list?language=en');
    console.log(response);
    return response.data.genres;
}

const syncMovieGenres = async () => {
    const genres = await getMovieGenres();
    for(const genre of genres){
        await GenreModel.findOneAndUpdate(
            { externalSystemId: String(genre.id), genreType: 'movie' },
            { name: genre.name, source: 'tmdb', genreType: 'movie' },
            { upsert: true }
        );
    }
}

const syncTvGenres = async () => {
    const genres = await getTvGenres();
    for(const genre of genres){
        await GenreModel.findOneAndUpdate(
            { externalSystemId: String(genre.id), genreType: 'tv' },
            { name: genre.name, source: 'tmdb', genreType: 'tv' },
            { upsert: true }
        );
    }
}


const MOVIES_PER_CATEGORY = 20;

const getNowPlayingMovies = (page = 1) =>
    tmdbApi.get(`/movie/now_playing?language=en-US&page=${page}`).then(r => r.data.results || []);

const getPopularMovies = (page = 1) =>
    tmdbApi.get(`/movie/popular?language=en-US&page=${page}`).then(r => r.data.results || []);

const getTopRatedMovies = (page = 1) =>
    tmdbApi.get(`/movie/top_rated?language=en-US&page=${page}`).then(r => r.data.results || []);


const getOnTheAirTv = (page = 1) =>
    tmdbApi.get(`/tv/on_the_air`, { params: { language: 'en-US', page } }).then(r => r.data.results || []);
const getPopularTv = (page = 1) =>
    tmdbApi.get(`/tv/popular`, { params: { language: 'en-US', page } }).then(r => r.data.results || []);
const getTopRatedTv = (page = 1) =>
    tmdbApi.get(`/tv/top_rated`, { params: { language: 'en-US', page } }).then(r => r.data.results || []);

/** Fetch up to target movies, paginating if needed. */
const fetchMovies = async (fetchPage, target = MOVIES_PER_CATEGORY) => {
    const list = [];
    let page = 1;
    while (list.length < target) {
        const results = await fetchPage(page);
        if (!results.length) break;
        list.push(...results);
        if (results.length < 20) break;
        page++;
    }
    return list.slice(0, target);
};

/** Map TMDB movie result to our update payload. Details API returns genres[], list API returns genre_ids[]. */
const movieToPayload = (movie, category) => ({
    externalId: movie.id,
    mediaType: 'movie',
    category,
    adult: movie.adult ?? false,
    backdrop_path: movie.backdrop_path ?? null,
    //map genre to genre_ids too
    genre_ids: movie.genre_ids?.length ? movie.genre_ids : (movie.genres || []).map((g) => g.id).filter((id) => id != null),
    original_language: movie.original_language ?? '',
    original_title: movie.original_title ?? '',
    overview: movie.overview ?? '',
    popularity: movie.popularity ?? 0,
    poster_path: movie.poster_path ?? null,
    release_date: movie.release_date ?? '',
    title: movie.title ?? '',
    video: movie.video ?? false,
    vote_average: movie.vote_average ?? 0,
    vote_count: movie.vote_count ?? 0,
});

const syncCategory = async (fetchPage, category) => {
    const movies = await fetchMovies(fetchPage);
    for (const movie of movies) {
        const payload = movieToPayload(movie, category);
        await MediaModel.findOneAndUpdate(
            { externalId: movie.id, mediaType: 'movie', category },
            payload,
            { upsert: true }
        );
    }
}

const syncNowPlayingMovies = () => syncCategory(getNowPlayingMovies, 'now_playing');
const syncPopularMovies = () => syncCategory(getPopularMovies, 'popular');
const syncTopRatedMovies = () => syncCategory(getTopRatedMovies, 'top_rated');

const TV_PER_CATEGORY = 20;

/**
 * Format TMDB episode_groups (from append_to_response) to { episode_count, group_count }.
 * Uses first group (e.g. "Aired Order") or zeros if missing.
 * @param {object} [raw] - TMDB response: { id, results: [ { episode_count, group_count, ... } ] }
 * @returns {{ episode_count: number, group_count: number }}
 */
const formatEpisodeGroups = (raw) => {
    const first = raw?.results?.[0];
    return {
        episode_count: first?.episode_count ?? 0,
        group_count: first?.group_count ?? 0,
    };
};

/** Map TMDB TV result to our media payload (title from name, release_date from first_air_date). */
const tvToPayload = (tv, category, episodeGroup = null) => ({
    externalId: tv.id,
    mediaType: 'tv',
    category,
    adult: tv.adult ?? false,
    backdrop_path: tv.backdrop_path ?? null,
    genre_ids: tv.genre_ids ?? [],
    original_language: tv.original_language ?? '',
    original_title: tv.original_name ?? '',
    overview: tv.overview ?? '',
    popularity: tv.popularity ?? 0,
    poster_path: tv.poster_path ?? null,
    release_date: tv.first_air_date ?? '',
    title: tv.name ?? '',
    video: false,
    vote_average: tv.vote_average ?? 0,
    vote_count: tv.vote_count ?? 0,
    ...(episodeGroup && { episode_group: episodeGroup }),
});

/** Fetch up to target TV shows, paginating if needed. */
const fetchTv = async (fetchPage, target = TV_PER_CATEGORY) => {
    const list = [];
    let page = 1;
    while (list.length < target) {
        const results = await fetchPage(page);
        if (!results.length) break;
        list.push(...results);
        if (results.length < 20) break;
        page++;
    }
    return list.slice(0, target);
};

const syncCategoryTv = async (fetchPage, category) => {
    const list = await fetchTv(fetchPage);
    for (const tv of list) {
        const details = await fetchTvDetails(tv.id, true);
        const episodeGroup = formatEpisodeGroups(details?.episode_groups);
        const payload = tvToPayload(tv, category, episodeGroup);
        await MediaModel.findOneAndUpdate(
            { externalId: tv.id, mediaType: 'tv', category },
            payload,
            { upsert: true }
        );
    }
};

const syncOnTheAirTv = () => syncCategoryTv(getOnTheAirTv, 'now_playing');
const syncPopularTv = () => syncCategoryTv(getPopularTv, 'popular');
const syncTopRatedTv = () => syncCategoryTv(getTopRatedTv, 'top_rated');

/**
 * Fetch movie details from TMDB by movie id (TMDB external id).
 * @param {number|string} tmdbId - TMDB movie id
 * @param {boolean} [appendRecommendations=false] - if true, adds append_to_response=recommendations
 * @returns {Promise<object|null>} TMDB movie details (and recommendations.results when requested) or null
 */
const fetchMovieDetails = async (tmdbId, appendRecommendations = false) => {
    try {
        const params = { language: 'en-US' };
        if (appendRecommendations) {
            params.append_to_response = 'recommendations';
        }
        const res = await tmdbApi.get(`/movie/${tmdbId}`, { params });
        return res.data || null;
    } catch {
        return null;
    }
};

/**
 * Fetch TV show details from TMDB by TV id (TMDB external id).
 * @param {number|string} tmdbId - TMDB TV id
 * @param {boolean} [appendEpisodeGroups=false] - if true, adds episode_groups to append_to_response
 * @param {boolean} [appendRecommendations=false] - if true, adds recommendations to append_to_response
 * @returns {Promise<object|null>} TMDB TV details (and requested append data) or null
 */
const fetchTvDetails = async (tmdbId, appendEpisodeGroups = false, appendRecommendations = false) => {
    try {
        const params = { language: 'en-US' };
        const append = [];
        if (appendEpisodeGroups) append.push('episode_groups');
        if (appendRecommendations) append.push('recommendations');
        if (append.length) params.append_to_response = append.join(',');
        const res = await tmdbApi.get(`/tv/${tmdbId}`, { params });
        return res.data || null;
    } catch {
        return null;
    }
};

/**
 * Fetch movie details by IMDB id (e.g. tt0137523).
 * Uses TMDB find by external id, then movie details.
 * @param {string} imdbId - IMDB id (with or without "tt" prefix)
 * @returns {Promise<object|null>} Movie object or null if not found
 */
const fetchMovieByImdbId = async (imdbId) => {
    const id = String(imdbId || '').trim();
    if (!id) return null;
    const normalized = id.startsWith('tt') ? id : `tt${id}`;
    const findRes = await tmdbApi.get(`/find/${normalized}`, { params: { external_source: 'imdb_id' } });
    const movieResults = findRes.data?.movie_results;
    if (!movieResults?.length) return null;
    const tmdbId = movieResults[0].id;
    const detailRes = await tmdbApi.get(`/movie/${tmdbId}`, { params: { language: 'en-US' } });
    return detailRes.data || null;
};

/**
 * Fetch movie details by TMDB id.
 * @param {number|string} tmdbId - TMDB movie id
 * @returns {Promise<object|null>} Movie object or null if not found
 */
const fetchMovieByTmdbId = async (tmdbId) => {
    const id = typeof tmdbId === 'number' ? tmdbId : parseInt(String(tmdbId || ''), 10);
    if (!Number.isFinite(id)) return null;
    try {
        const res = await tmdbApi.get(`/movie/${id}`, { params: { language: 'en-US' } });
        return res.data || null;
    } catch (err) {
        if (err.response?.status === 404) return null;
        throw err;
    }
};

/**
 * Save a single movie to cache with category (e.g. 'top_pick').
 * @param {object} movie - TMDB movie details (from fetchMovieByImdbId or similar)
 * @param {string} category - 'now_playing' | 'popular' | 'top_rated' | 'top_pick'
 * @returns {Promise<object>} Saved doc (plain)
 */
const saveMovieToCache = async (movie, category) => {
    const payload = movieToPayload(movie, category);
    const doc = await MediaModel.findOneAndUpdate(
        { externalId: movie.id, mediaType: 'movie', category },
        payload,
        { upsert: true, new: true }
    ).lean();
    return doc;
};

/**
 * Save a single movie to cache with category (e.g. 'top_pick').
 * @param {object} movie - TMDB movie details (from fetchMovieByImdbId or similar)
 * @param {string} category - 'now_playing' | 'popular' | 'top_rated' | 'top_pick'
 * @returns {Promise<object>} Saved doc (plain)
 */
const GetReccomendations  = async (tmdbId, category) => {
    const res = await tmdbApi.get(`/${category}/${tmdbId}/recommendations`, { params: { language: 'en-US' } });
    return res.data.results || [];
}



module.exports = {
    tmdbImageUrl,
    formatMediaImageUrls,
    formatMultiSearchResult,
    getMovieGenres,
    getTvGenres,
    syncMovieGenres,
    syncTvGenres,
    shouldSync,
    getLastSync,
    setLastSync,
    getLastSyncTv,
    setLastSyncTv,
    shouldSyncTv,
    syncNowPlayingMovies,
    syncPopularMovies,
    syncTopRatedMovies,
    syncOnTheAirTv,
    syncPopularTv,
    syncTopRatedTv,
    getNowPlayingMovies,
    getPopularMovies,
    getTopRatedMovies,
    getOnTheAirTv,
    getPopularTv,
    getTopRatedTv,
    fetchMovieDetails,
    fetchTvDetails,
    formatEpisodeGroups,
    fetchMovieByImdbId,
    fetchMovieByTmdbId,
    saveMovieToCache,
    GetReccomendations,
}