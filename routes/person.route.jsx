const express = require('express');
const router = express.Router();
const { tmdbApi } = require('../helper/api.helper');
const { tmdbImageUrl } = require('../helper/tmdb.helper');

/** Format a credit item (movie or tv) with poster_url */
function formatCredit(item) {
  if (!item) return item;
  return {
    ...item,
    poster_url: tmdbImageUrl(item.poster_path, 'w500'),
  };
}

/** Format cast/crew arrays to add poster_url to each entry */
function formatCredits(credits) {
  if (!credits) return { cast: [], crew: [] };
  return {
    cast: (credits.cast || []).map(formatCredit),
    crew: (credits.crew || []).map(formatCredit),
  };
}

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const parsed = parseInt(id, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid person id' });
    }
    const { data: rawPerson } = await tmdbApi.get(`/person/${parsed}`, {
      params: { append_to_response: 'movie_credits,tv_credits', language: 'en-US' },
    });
    if (!rawPerson) {
      return res.status(404).json({ success: false, message: 'Person not found' });
    }

    const person = {
      ...rawPerson,
      profile_url: tmdbImageUrl(rawPerson.profile_path, 'w185'),
      movie_credits: formatCredits(rawPerson.movie_credits),
      tv_credits: formatCredits(rawPerson.tv_credits),
    };

    return res.status(200).json({ success: true, data: person });
  } catch (error) {
    const status = error.response?.status === 404 ? 404 : 500;
    const message = error.response?.status === 404 ? 'Person not found' : error.message || 'Failed to fetch person';
    return res.status(status).json({ success: false, message });
  }
});

module.exports = router;
