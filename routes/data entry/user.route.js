const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const router = express.Router();
const userModel = require('../../model/user.model');
const { validateToken, validateAdmin } = require('../../helper/validate.helper');
const { createImage, deleteImageById } = require('../../helper/image.helper');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(validateToken);

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const MAX_FOLDERS = 5;
const MAX_SAVED_PER_FOLDER = 50;

// GET / – list users with pagination (any logged-in user, no password)
// Optional query: ?email=<search> – case-insensitive partial match on email
router.get('/', validateAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT));
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.email && typeof req.query.email === 'string' && req.query.email.trim()) {
      const escaped = req.query.email.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.email = { $regex: escaped, $options: 'i' };
    }

    const [list, total] = await Promise.all([
      userModel.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      userModel.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      data: list,
      pagination: { page, limit, total, totalPages },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to list users',
    });
  }
});

// GET /me – current user (no password)
router.get('/me', async (req, res) => {
  try {
    const doc = await userModel.findById(req.userId).select('-password').lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.status(200).json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to get profile' });
  }
});

// POST /me/profile-picture – upload profile image (GridFS), update user.profile_url, delete previous image
router.post('/me/profile-picture', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }
    const currentUser = await userModel.findById(req.userId).select('profile_url').lean();
    const oldProfileUrl = currentUser?.profile_url || '';

    const result = await createImage({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname || '',
    });
    const doc = await userModel
      .findByIdAndUpdate(req.userId, { profile_url: result.urlPath }, { new: true })
      .select('-password')
      .lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (oldProfileUrl && typeof oldProfileUrl === 'string') {
      const match = oldProfileUrl.match(/\/api\/images\/([a-f0-9A-F]{24})$/);
      if (match) {
        try {
          await deleteImageById(match[1]);
        } catch {
          // ignore delete errors so response is still success
        }
      }
    }

    return res.status(200).json({ success: true, data: doc });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Upload failed',
    });
  }
});

const PREFERENCES_DEFAULTS = {
  saveButtonPosition: 'bottom_center',
  showWatchButton: true,
  showTopPickOnHome: true,
  showPosterTitle: false,
  showPromoTicker: true,
  showAdFreeStatus: true,
};
const SAVE_BUTTON_POSITIONS = ['bottom_center', 'top_right', 'hidden'];

// GET /me/preferences – current user display/rendering preferences
router.get('/me/preferences', async (req, res) => {
  try {
    const doc = await userModel.findById(req.userId).select('preferences').lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const prefs = doc.preferences || {};
    const data = {
      saveButtonPosition: SAVE_BUTTON_POSITIONS.includes(prefs.saveButtonPosition) ? prefs.saveButtonPosition : PREFERENCES_DEFAULTS.saveButtonPosition,
      showWatchButton: typeof prefs.showWatchButton === 'boolean' ? prefs.showWatchButton : PREFERENCES_DEFAULTS.showWatchButton,
      showTopPickOnHome: typeof prefs.showTopPickOnHome === 'boolean' ? prefs.showTopPickOnHome : PREFERENCES_DEFAULTS.showTopPickOnHome,
      showPosterTitle: typeof prefs.showPosterTitle === 'boolean' ? prefs.showPosterTitle : PREFERENCES_DEFAULTS.showPosterTitle,
      showPromoTicker: typeof prefs.showPromoTicker === 'boolean' ? prefs.showPromoTicker : PREFERENCES_DEFAULTS.showPromoTicker,
      showAdFreeStatus: typeof prefs.showAdFreeStatus === 'boolean' ? prefs.showAdFreeStatus : PREFERENCES_DEFAULTS.showAdFreeStatus,
    };
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to get preferences' });
  }
});

// PATCH /me/preferences – update display/rendering preferences (partial)
router.patch('/me/preferences', async (req, res) => {
  try {
    const body = req.body || {};
    const updates = {};
    if (body.saveButtonPosition !== undefined) {
      updates['preferences.saveButtonPosition'] = SAVE_BUTTON_POSITIONS.includes(body.saveButtonPosition)
        ? body.saveButtonPosition
        : PREFERENCES_DEFAULTS.saveButtonPosition;
    }
    if (body.showWatchButton !== undefined) {
      updates['preferences.showWatchButton'] = Boolean(body.showWatchButton);
    }
    if (body.showTopPickOnHome !== undefined) {
      updates['preferences.showTopPickOnHome'] = Boolean(body.showTopPickOnHome);
    }
    if (body.showPosterTitle !== undefined) {
      updates['preferences.showPosterTitle'] = Boolean(body.showPosterTitle);
    }
    if (body.showPromoTicker !== undefined) {
      updates['preferences.showPromoTicker'] = Boolean(body.showPromoTicker);
    }
    if (body.showAdFreeStatus !== undefined) {
      updates['preferences.showAdFreeStatus'] = Boolean(body.showAdFreeStatus);
    }
    if (Object.keys(updates).length === 0) {
      const doc = await userModel.findById(req.userId).select('preferences').lean();
      const prefs = (doc && doc.preferences) || {};
      const data = {
        saveButtonPosition: SAVE_BUTTON_POSITIONS.includes(prefs.saveButtonPosition) ? prefs.saveButtonPosition : PREFERENCES_DEFAULTS.saveButtonPosition,
        showWatchButton: typeof prefs.showWatchButton === 'boolean' ? prefs.showWatchButton : PREFERENCES_DEFAULTS.showWatchButton,
        showTopPickOnHome: typeof prefs.showTopPickOnHome === 'boolean' ? prefs.showTopPickOnHome : PREFERENCES_DEFAULTS.showTopPickOnHome,
        showPosterTitle: typeof prefs.showPosterTitle === 'boolean' ? prefs.showPosterTitle : PREFERENCES_DEFAULTS.showPosterTitle,
        showPromoTicker: typeof prefs.showPromoTicker === 'boolean' ? prefs.showPromoTicker : PREFERENCES_DEFAULTS.showPromoTicker,
        showAdFreeStatus: typeof prefs.showAdFreeStatus === 'boolean' ? prefs.showAdFreeStatus : PREFERENCES_DEFAULTS.showAdFreeStatus,
      };
      return res.status(200).json({ success: true, data });
    }
    const doc = await userModel
      .findByIdAndUpdate(req.userId, { $set: updates }, { new: true })
      .select('preferences')
      .lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const prefs = doc.preferences || {};
    const data = {
      saveButtonPosition: SAVE_BUTTON_POSITIONS.includes(prefs.saveButtonPosition) ? prefs.saveButtonPosition : PREFERENCES_DEFAULTS.saveButtonPosition,
      showWatchButton: typeof prefs.showWatchButton === 'boolean' ? prefs.showWatchButton : PREFERENCES_DEFAULTS.showWatchButton,
      showTopPickOnHome: typeof prefs.showTopPickOnHome === 'boolean' ? prefs.showTopPickOnHome : PREFERENCES_DEFAULTS.showTopPickOnHome,
      showPosterTitle: typeof prefs.showPosterTitle === 'boolean' ? prefs.showPosterTitle : PREFERENCES_DEFAULTS.showPosterTitle,
      showPromoTicker: typeof prefs.showPromoTicker === 'boolean' ? prefs.showPromoTicker : PREFERENCES_DEFAULTS.showPromoTicker,
      showAdFreeStatus: typeof prefs.showAdFreeStatus === 'boolean' ? prefs.showAdFreeStatus : PREFERENCES_DEFAULTS.showAdFreeStatus,
    };
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to update preferences' });
  }
});

// --- Folders (max 5 per user, max 50 saved items per folder) ---

// GET /me/folders – list current user's folders
router.get('/me/folders', async (req, res) => {
  try {
    const doc = await userModel.findById(req.userId).select('folders').lean();
    if (!doc) return res.status(404).json({ success: false, message: 'User not found' });
    return res.status(200).json({ success: true, data: doc.folders || [] });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to get folders' });
  }
});

// POST /me/folders – create folder (max 5)
router.post('/me/folders', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Folder name is required' });
    }
    const user = await userModel.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if ((user.folders?.length || 0) >= MAX_FOLDERS) {
      return res.status(400).json({ success: false, message: `Maximum ${MAX_FOLDERS} folders allowed` });
    }
    user.folders = user.folders || [];
    user.folders.push({ name: name.trim(), description: (description && String(description).trim()) || '', saved: [] });
    await user.save();
    const folder = user.folders[user.folders.length - 1];
    return res.status(201).json({ success: true, data: folder });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to create folder' });
  }
});

// GET /me/folders/:folderId – get one folder
router.get('/me/folders/:folderId', async (req, res) => {
  try {
    const { folderId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      return res.status(400).json({ success: false, message: 'Invalid folder id' });
    }
    const user = await userModel.findById(req.userId).select('folders').lean();
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const folder = (user.folders || []).find((f) => String(f._id) === folderId);
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });
    return res.status(200).json({ success: true, data: folder });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to get folder' });
  }
});

// PUT /me/folders/:folderId – update folder (name, description)
router.put('/me/folders/:folderId', async (req, res) => {
  try {
    const { folderId } = req.params;
    const { name, description } = req.body;
    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      return res.status(400).json({ success: false, message: 'Invalid folder id' });
    }
    const user = await userModel.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const folder = (user.folders || []).find((f) => String(f._id) === folderId);
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });
    if (name !== undefined) folder.name = typeof name === 'string' ? name.trim() : folder.name;
    if (description !== undefined) folder.description = typeof description === 'string' ? description.trim() : folder.description;
    await user.save();
    return res.status(200).json({ success: true, data: folder });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to update folder' });
  }
});

// DELETE /me/folders/:folderId – delete folder
router.delete('/me/folders/:folderId', async (req, res) => {
  try {
    const { folderId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      return res.status(400).json({ success: false, message: 'Invalid folder id' });
    }
    const user = await userModel.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const idx = (user.folders || []).findIndex((f) => String(f._id) === folderId);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Folder not found' });
    user.folders.splice(idx, 1);
    await user.save();
    return res.status(200).json({ success: true, message: 'Folder deleted' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to delete folder' });
  }
});

// POST /me/folders/:folderId/saved – add saved item (max 50 per folder)
router.post('/me/folders/:folderId/saved', async (req, res) => {
  try {
    const { folderId } = req.params;
    const body = req.body || {};
    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      return res.status(400).json({ success: false, message: 'Invalid folder id' });
    }
    const externalId = body.externalId != null ? Number(body.externalId) : NaN;
    const mediaType = body.mediaType === 'tv' ? 'tv' : (body.mediaType === 'movie' ? 'movie' : null);
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!Number.isInteger(externalId) || externalId <= 0 || !mediaType || !title) {
      return res.status(400).json({ success: false, message: 'externalId (number), mediaType (movie|tv), and title (string) are required' });
    }
    const user = await userModel.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const folder = (user.folders || []).find((f) => String(f._id) === folderId);
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });
    if ((folder.saved?.length || 0) >= MAX_SAVED_PER_FOLDER) {
      return res.status(400).json({ success: false, message: `Maximum ${MAX_SAVED_PER_FOLDER} items per folder` });
    }
    const episode_group = body.episode_group && typeof body.episode_group === 'object'
      ? {
          episode_count: Number(body.episode_group.episode_count) || 0,
          group_count: Number(body.episode_group.group_count) || 0,
        }
      : { episode_count: 0, group_count: 0 };
    const poster_url = typeof body.poster_url === 'string' ? body.poster_url.trim() : '';
    folder.saved = folder.saved || [];
    folder.saved.push({
      externalId,
      mediaType,
      title,
      poster_url,
      category: typeof body.category === 'string' ? body.category : '',
      vote_average: Number(body.vote_average) || 0,
      release_date: typeof body.release_date === 'string' ? body.release_date : '',
      genre_ids: Array.isArray(body.genre_ids) ? body.genre_ids.filter((n) => Number.isInteger(Number(n))) : [],
      overview: typeof body.overview === 'string' ? body.overview : '',
      episode_group,
    });
    await user.save();
    const added = folder.saved[folder.saved.length - 1];
    return res.status(201).json({ success: true, data: added });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to add saved item' });
  }
});

// DELETE /me/folders/:folderId/saved/:savedItemId – remove saved item
router.delete('/me/folders/:folderId/saved/:savedItemId', async (req, res) => {
  try {
    const { folderId, savedItemId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(folderId) || !mongoose.Types.ObjectId.isValid(savedItemId)) {
      return res.status(400).json({ success: false, message: 'Invalid folder or saved item id' });
    }
    const user = await userModel.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const folder = (user.folders || []).find((f) => String(f._id) === folderId);
    if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });
    const idx = (folder.saved || []).findIndex((s) => String(s._id) === savedItemId);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Saved item not found' });
    folder.saved.splice(idx, 1);
    await user.save();
    return res.status(200).json({ success: true, message: 'Saved item removed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to remove saved item' });
  }
});

// GET /:id – get one user (no password)
router.get('/:id',validateAdmin, async (req, res) => {
  try {
    const doc = await userModel.findById(req.params.id).select('-password').lean();
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }
    return res.status(200).json({
      success: true,
      data: doc,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to get user',
    });
  }
});

// POST /profile – create a new user (admin only)
router.post('/profile', validateAdmin, async (req, res) => {
  try {
    const { email, password, profile_url } = req.body;
    const doc = await userModel.create({ email, password, profile_url });
    return res.status(201).json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to create user',
    });
  }
});

// PUT /:id – update user (admin only)
router.put('/:id', validateAdmin, async (req, res) => {
  try {
    const { email, isActive, isAdmin, adFree } = req.body;
    const doc = await userModel
      .findByIdAndUpdate(
        req.params.id,
        {
          ...(email !== undefined && { email }),
          ...(isActive !== undefined && { isActive }),
          ...(isAdmin !== undefined && { isAdmin }),
          ...(adFree !== undefined && { adFree }),
        },
        { new: true, runValidators: true }
      )
      .select('-password')
      .lean();
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }
    return res.status(200).json({
      success: true,
      message: 'User updated',
      data: doc,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to update user',
    });
  }
});

module.exports = router;
