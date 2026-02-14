const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const genreModel = require('../../model/genre.model');
const { validateToken, validateAdmin } = require('../../helper/validate.helper');
const { syncMovieGenres, syncTvGenres } = require('../../helper/tmdb.helper');

// GET / – list all genres, or filter by ids / externalSystemIds (no auth)
// Query: ?ids=id1,id2,id3 (MongoDB _ids) or ?externalSystemIds=28,12,16 (TMDB ids)
router.get('/', async (req, res) => {
  try {
    const { ids, externalSystemIds, genreType } = req.query;
    let query = {};

    if (ids) {
      const idList = ids.split(',').map((s) => s.trim()).filter(Boolean);
      const validIds = idList.filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (validIds.length) query._id = { $in: validIds };
    } else if (externalSystemIds) {
      const extList = externalSystemIds.split(',').map((s) => s.trim()).filter(Boolean);
      if (extList.length) query.externalSystemId = { $in: extList };
    }
    if (genreType === 'movie' || genreType === 'tv') query.genreType = genreType;

    const list = await genreModel.find(query).sort({ name: 1 }).lean();
    return res.status(200).json({
      success: true,
      data: list,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to list genres',
    });
  }
});

// GET /:id – get one genre by MongoDB _id or by externalSystemId (e.g. TMDB id)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let doc = null;
    if (mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id) {
      doc = await genreModel.findById(id).lean();
    }
    if (!doc) {
      doc = await genreModel.findOne({ externalSystemId: id }).lean();
    }
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'Genre not found',
      });
    }
    return res.status(200).json({
      success: true,
      data: doc,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to get genre',
    });
  }
});

// POST /sync – sync genres from TMDB (movie + TV). Requires auth + admin.
router.post('/sync', validateToken, validateAdmin, async (req, res) => {
    try {
    await syncMovieGenres();
    await syncTvGenres();
    return res.status(200).json({
      success: true,
      message: 'Genres synced (movie and TV)',
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Sync failed',
    });
  }
});

module.exports = router;
