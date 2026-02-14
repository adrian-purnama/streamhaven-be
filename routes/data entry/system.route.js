const express = require('express');
const multer = require('multer');
const router = express.Router();
const systemModel = require('../../model/system.model');
const { validateToken, validateAdmin } = require('../../helper/validate.helper');
const { createImage, deleteImageById } = require('../../helper/image.helper');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(validateToken);

// GET / – read the single system config (any logged-in user)
router.get('/', async (req, res) => {
  try {
    const doc = await systemModel.findOne({});
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'System config not found',
      });
    }
    return res.status(200).json({
      success: true,
      data: doc,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to get system config',
    });
  }
});

// PUT / – update system config (adrian only). If logoUrl or logoFullUrl is changed, deletes old from storage when it was /api/images/:id.
router.put('/', validateAdmin, async (req, res) => {
  try {
    const { appName, openRegistration, logoUrl, logoFullUrl, tagLine } = req.body;
    let oldLogoUrl = null;
    let oldLogoFullUrl = null;
    const current = await systemModel.findOne({}).select('logoUrl logoFullUrl').lean();
    if (logoUrl !== undefined) oldLogoUrl = (current && current.logoUrl) || '';
    if (logoFullUrl !== undefined) oldLogoFullUrl = (current && current.logoFullUrl) || '';

    const doc = await systemModel.findOneAndUpdate(
      {},
      {
        ...(appName !== undefined && { appName }),
        ...(openRegistration !== undefined && { openRegistration }),
        ...(logoUrl !== undefined && { logoUrl }),
        ...(logoFullUrl !== undefined && { logoFullUrl }),
        ...(tagLine !== undefined && { tagLine }),
      },
      { new: true, runValidators: true }
    );
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'System config not found',
      });
    }

    if (oldLogoUrl && oldLogoUrl !== doc.logoUrl && typeof oldLogoUrl === 'string') {
      const match = oldLogoUrl.match(/\/api\/images\/([a-f0-9A-F]{24})$/);
      if (match) {
        try {
          await deleteImageById(match[1]);
        } catch {
          // ignore delete errors so response is still success
        }
      }
    }
    if (oldLogoFullUrl && oldLogoFullUrl !== doc.logoFullUrl && typeof oldLogoFullUrl === 'string') {
      const match = oldLogoFullUrl.match(/\/api\/images\/([a-f0-9A-F]{24})$/);
      if (match) {
        try {
          await deleteImageById(match[1]);
        } catch {
          // ignore delete errors so response is still success
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: 'System config updated',
      data: doc,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to update system config',
    });
  }
});

// POST /logo – upload new logo image (admin). Deletes previous logo from storage if it was /api/images/:id.
router.post('/logo', validateAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }
    const current = await systemModel.findOne({}).select('logoUrl').lean();
    const oldLogoUrl = (current && current.logoUrl) || '';

    const result = await createImage({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname || '',
    });

    const doc = await systemModel.findOneAndUpdate(
      {},
      { logoUrl: result.urlPath },
      { new: true, runValidators: true }
    );
    if (!doc) {
      return res.status(404).json({ success: false, message: 'System config not found' });
    }

    if (oldLogoUrl && typeof oldLogoUrl === 'string') {
      const match = oldLogoUrl.match(/\/api\/images\/([a-f0-9A-F]{24})$/);
      if (match) {
        try {
          await deleteImageById(match[1]);
        } catch {
          // ignore delete errors so response is still success
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Logo updated',
      data: doc,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Logo upload failed',
    });
  }
});

// POST /logo-full – upload new full logo image (admin). Deletes previous logoFullUrl from storage if it was /api/images/:id.
router.post('/logo-full', validateAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }
    const current = await systemModel.findOne({}).select('logoFullUrl').lean();
    const oldLogoFullUrl = (current && current.logoFullUrl) || '';

    const result = await createImage({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname || '',
    });

    const doc = await systemModel.findOneAndUpdate(
      {},
      { logoFullUrl: result.urlPath },
      { new: true, runValidators: true }
    );
    if (!doc) {
      return res.status(404).json({ success: false, message: 'System config not found' });
    }

    if (oldLogoFullUrl && typeof oldLogoFullUrl === 'string') {
      const match = oldLogoFullUrl.match(/\/api\/images\/([a-f0-9A-F]{24})$/);
      if (match) {
        try {
          await deleteImageById(match[1]);
        } catch {
          // ignore delete errors so response is still success
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Full logo updated',
      data: doc,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Full logo upload failed',
    });
  }
});

module.exports = router;
