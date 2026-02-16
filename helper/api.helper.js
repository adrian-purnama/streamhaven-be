require('dotenv').config();
const axios = require('axios');

const TMDBBaseURL = process.env.TMDB_LINK || process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3';
const TMDBAccessToken = process.env.TMDB_API_KEY;

const AbyssBaseURL = process.env.ABYSS_LINK;
const AbyssApiKey = process.env.ABYSS_API_KEY;

if (!TMDBAccessToken) {
  console.warn('[api.helper] TMDB_API_KEY is not set; TMDB requests will fail.');
}

if (!AbyssBaseURL) {
  console.warn('[api.helper] ABYSS_LINK is not set; Abyss requests will fail.');
}

const tmdbApi = axios.create({
  baseURL: TMDBBaseURL,
  headers: {
    Authorization: `Bearer ${TMDBAccessToken}`,
    accept: 'application/json',
  },
});

/** Use for login only (no Bearer token). Authenticated calls use token from getAbyssToken in abyss.helper. */
const abyssApi = axios.create({
  baseURL: AbyssBaseURL,
  headers: {
    accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

module.exports = {
  tmdbApi,
  abyssApi,
  AbyssBaseURL,
  AbyssApiKey,
};