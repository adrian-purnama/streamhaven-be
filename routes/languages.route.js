const express = require('express');
const { tmdbApi } = require('../helper/api.helper');

const router = express.Router();

/**
 * GET /api/languages
 * Returns TMDB list of languages (iso_639_1, english_name) for dropdowns.
 * @see https://developer.themoviedb.org/reference/configuration-languages
 */
router.get('/', async (req, res) => {
  try {
    const response = await tmdbApi.get('/configuration/languages');
    const list = response.data || [];
    return res.status(200).json({
      success: true,
      data: list,
    });
  } catch (err) {
    const message = err.response?.data?.status_message || err.message || 'Failed to fetch languages';
    return res.status(err.response?.status || 500).json({ success: false, message });
  }
});

module.exports = router;
