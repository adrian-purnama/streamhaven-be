const express = require('express');
const router = express.Router();
const { validateToken, validateAdmin } = require('../../helper/validate.helper');
const { getAccountInfo, deleteAbyssVideoById, getResources, putResource } = require('../../helper/abyss.helper');
const uploadedVideoModel = require('../../model/uploadedVideo.model');

router.use(validateToken);
router.use(validateAdmin);

router.get('/account-info', async (req, res) => {
  try {
    const accountInfo = await getAccountInfo();
    return res.status(200).json({
      success: true,
      data: accountInfo,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/delete-video/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    if (!slug) {
      return res.status(400).json({ success: false, message: 'Slug required' });
    }
    const response = await deleteAbyssVideoById(slug);
    if (!response.success) {
      return res.status(500).json({ success: false, message: response.message ?? 'Abyss delete failed' });
    }
    // Remove our mapping doc if it exists (no-op when doc not found)
    await uploadedVideoModel.findOneAndDelete({ abyssSlug: slug });
    return res.status(200).json({ success: true, message: 'Video deleted from Abyss and database' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/resources',async (req, res) => {
  try {
    // raw resources data
    // TODO : can use other than item
    const resources = await getResources();

    const items = resources.item || resources.items || [];

    const mappeditems = await Promise.all(
      items.map(async (item) => {
        const uploadedVideo = await uploadedVideoModel.findOne({ abyssSlug: item.id });
        return uploadedVideo ?? null;
      })
    );

    return res.status(200).json({ success: true, data: { items, mappeditems } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/patch-video/:slug', express.json(), async (req, res) => {
  try {
    const { slug } = req.params;
    const { fileName } = req.body || {};
    if (!slug) {
      return res.status(400).json({ success: false, message: 'Slug required' });
    }
    const name = fileName != null ? String(fileName).trim() : '';
    if (!name) {
      return res.status(400).json({ success: false, message: 'fileName required' });
    }
    const result = await putResource(slug, name);
    if (!result.success) {
      return res.status(500).json({ success: false, message: result.message ?? 'Patch failed' });
    }
    return res.status(200).json({ success: true, data: result.data, message: 'Resource name updated' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
