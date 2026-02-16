const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const ServerModel = require('../../model/server.model');
const { validateToken, validateAdmin } = require('../../helper/validate.helper');

const USED_FOR_VALUES = ['tv', 'anime', 'movie', 'my_player'];

// GET / – list all servers, optionally filter by usedFor (no auth)
// Query: ?usedFor=movie|tv|anime|my_player – only servers that include this type (sorted by createdAt desc)
router.get('/', async (req, res) => {
  try {
    const { usedFor: usedForQuery } = req.query;
    let query = {};
    if (usedForQuery && USED_FOR_VALUES.includes(String(usedForQuery))) {
      query.usedFor = String(usedForQuery);
    }
    const list = await ServerModel.find(query)
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({
      success: true,
      data: list,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to list servers',
    });
  }
});

// GET /:id – get one server by id (no auth)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const doc = await ServerModel.findById(id).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Server not found' });
    }
    return res.status(200).json({
      success: true,
      data: doc,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to get server',
    });
  }
});

// POST / – create server (token + admin)
router.post('/', validateToken, validateAdmin, async (req, res) => {
  try {
    const { link, usedFor, label, watchPathPattern } = req.body;
    if (!link || typeof link !== 'string' || !link.trim()) {
      return res.status(400).json({ success: false, message: 'link is required' });
    }
    const normalized = (Array.isArray(usedFor) ? usedFor : [])
      .filter((v) => USED_FOR_VALUES.includes(String(v)));
    const doc = await ServerModel.create({
      link: link.trim().replace(/\/+$/, ''),
      usedFor: normalized.length ? normalized : [],
      ...(label !== undefined && { label: String(label).trim() }),
      ...(watchPathPattern !== undefined && { watchPathPattern: String(watchPathPattern).trim() }),
    });
    return res.status(201).json({
      success: true,
      message: 'Server created',
      data: doc.toObject ? doc.toObject() : doc,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to create server',
    });
  }
});

// PUT /:id – update server (token + admin)
router.put('/:id', validateToken, validateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { link, usedFor, label, watchPathPattern } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const update = {};
    if (link !== undefined) {
      if (typeof link !== 'string' || !link.trim()) {
        return res.status(400).json({ success: false, message: 'link must be a non-empty string' });
      }
      update.link = link.trim().replace(/\/+$/, '');
    }
    if (usedFor !== undefined) {
      update.usedFor = (Array.isArray(usedFor) ? usedFor : [])
        .filter((v) => USED_FOR_VALUES.includes(String(v)));
    }
    if (label !== undefined) update.label = String(label).trim();
    if (watchPathPattern !== undefined) update.watchPathPattern = String(watchPathPattern).trim();
    const doc = await ServerModel.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    }).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Server not found' });
    }
    return res.status(200).json({
      success: true,
      message: 'Server updated',
      data: doc,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to update server',
    });
  }
});

// DELETE /:id – delete server (token + admin)
router.delete('/:id', validateToken, validateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const doc = await ServerModel.findByIdAndDelete(id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Server not found' });
    }
    return res.status(200).json({
      success: true,
      message: 'Server deleted',
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to delete server',
    });
  }
});

module.exports = router;
