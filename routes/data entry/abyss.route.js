const express = require('express');
const router = express.Router();
const { validateToken, validateAdmin } = require('../../helper/validate.helper');
const { getAccountInfo } = require('../../helper/abyss.helper');

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

module.exports = router;
