const express = require('express');
const multer = require('multer');
const { validateToken, validateAdmin } = require('../helper/validate.helper');
const { createImage, getImageById, deleteImageById } = require('../helper/image.helper');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// POST /api/images/upload – upload image (auth + admin), returns { id, urlPath }
router.post('/upload', validateToken, validateAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }
    const result = await createImage({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname || '',
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Upload failed',
    });
  }
});

// GET /api/images/:id – serve image (no auth for img src)
router.get('/:id', async (req, res) => {
  try {
    const image = await getImageById(req.params.id);
    if (!image) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }
    res.set('Content-Type', image.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(image.data);
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to get image',
    });
  }
});

// DELETE /api/images/:id – delete image (auth + admin)
router.delete('/:id', validateToken, validateAdmin, async (req, res) => {
  try {
    const deleted = await deleteImageById(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }
    return res.status(200).json({ success: true, message: 'Image deleted' });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to delete image',
    });
  }
});

module.exports = router;
