const express = require('express');
const router = express.Router();
const { validateToken, validateAdmin } = require('../../helper/validate.helper');
const { getAccountInfo, deleteAbyssVideoById } = require('../../helper/abyss.helper');
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
    await uploadedVideoModel.findOneAndDelete({ abyssSlug: slug });
    return res.status(200).json({ success: true, message: 'Video deleted from Abyss and database' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
