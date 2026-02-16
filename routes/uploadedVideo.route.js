const express = require('express');
const { validateToken, validateAdmin } = require('../helper/validate.helper');
const { formatMediaImageUrls } = require('../helper/tmdb.helper');
const { getAllMyPlayerServers } = require('../helper/movietv.helper');
const UploadedVideoModel = require('../model/uploadedVideo.model');
const { getSlugStatus } = require('../helper/abyss.helper');

const router = express.Router();

const SLUG_STATUS_ENUM = ['uploaded_not_ready', 'ready'];

// GET /api/uploaded-videos – list successfully uploaded videos (Abyss) with pagination and optional slugStatus
router.get('/', validateToken, validateAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 20), 100);
    const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
    const slugStatus = req.query.slugStatus?.trim();
    const slugStatusFilter = slugStatus && SLUG_STATUS_ENUM.includes(slugStatus) ? slugStatus : null;
    const query = slugStatusFilter ? { slugStatus: slugStatusFilter } : {};
    const list = await UploadedVideoModel.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    const total = await UploadedVideoModel.countDocuments(query);
    const listWithPoster = await Promise.all(
      list.map(async (doc) => {
        const withPoster = formatMediaImageUrls(doc);
        const abyss_links = await getAllMyPlayerServers(doc.abyssSlug || '');
        return { ...withPoster, abyss_links };
      })
    );
    return res.json({ success: true, data: { list: listWithPoster, total } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to list uploaded videos' });
  }
});

// PATCH /api/uploaded-videos/:id – update mapping (externalId/tmdb id, title, poster_path)
router.patch('/:id', validateToken, validateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { externalId, title, poster_path: posterPath } = req.body;
    const update = {};
    if (externalId !== undefined) {
      const tid = externalId === null || externalId === '' ? null : Number(externalId);
      if (tid !== null && (Number.isNaN(tid) || tid < 1)) {
        return res.status(400).json({ success: false, message: 'externalId must be a positive number or null' });
      }
      update.externalId = tid;
    }
    if (title !== undefined) {
      update.title = title === null ? '' : String(title).trim();
    }
    if (posterPath !== undefined) {
      update.poster_path = posterPath === null || posterPath === '' ? null : String(posterPath).trim();
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, message: 'Provide externalId, title and/or poster_path' });
    }
    const doc = await UploadedVideoModel.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Uploaded video not found' });
    }
    const withPoster = formatMediaImageUrls(doc);
    return res.json({ success: true, data: withPoster });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to update mapping' });
  }
});

// GET Sync uploaded videos from Abyss
router.get('/sync', validateToken, validateAdmin, async (req, res) => {
  try {
    const list = await UploadedVideoModel.find({slugStatus: 'uploaded_not_ready'}).lean();

    for (const doc of list) {
      const slug = doc.abyssSlug;
      const slugStatus = await getSlugStatus(slug);
      if (slugStatus === 'ready') {
        await UploadedVideoModel.updateOne({ _id: doc._id }, { $set: { slugStatus: 'ready' } });
      }
    }
    return res.json({ success: true, data: list });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to sync uploaded videos' });
  }
});

module.exports = router;
