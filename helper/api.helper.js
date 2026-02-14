require('dotenv').config();
const axios = require('axios');

const baseURL = process.env.TMDB_LINK || process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3';
const accessToken = process.env.TMDB_API_KEY;

if (!accessToken) {
  console.warn('[api.helper] TMDB_ACCESS_TOKEN is not set; TMDB requests will fail.');
}

const tmdbApi = axios.create({
  baseURL,
  headers: {
    Authorization: `Bearer ${accessToken}`,
    accept: 'application/json',
  },
});

module.exports = {
  tmdbApi,
};