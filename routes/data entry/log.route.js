const express = require('express');
const router = express.Router();
const { validateToken, validateAdmin } = require('../../helper/validate.helper');
const { LOG_NAME_ENUM } = require('../../helper/log.helper');
const systemModel = require('../../model/system.model');

router.use(validateToken);
router.use(validateAdmin);

// GET /api/logs/categories – return log category enum from log.helper
router.get('/categories', (req, res) => {
  return res.json({ success: true, data: LOG_NAME_ENUM });
});

// GET /api/logs?category=STAGING_PROCESS_LOG|all – list of log entries (each run is one entry), each { logName, logTimestamp, lines }; newest first
router.get('/', async (req, res) => {
  try {
    const category = req.query.category?.trim();
    const isAll = !category || category === 'all';
    if (!isAll && !LOG_NAME_ENUM.includes(category)) {
      return res.status(400).json({ success: false, message: 'Valid category or "all" required (use GET /api/logs/categories)' });
    }
    const sys = await systemModel.findOne({}).lean();
    let logs = sys?.systemLogs || [];
    if (!isAll) logs = logs.filter((e) => e.logName === category);
    const list = logs
      .map((e) => ({ logName: e.logName, logTimestamp: e.logTimestamp ?? null, lines: e.log ?? [] }))
      .sort((a, b) => new Date(b.logTimestamp) - new Date(a.logTimestamp));
    return res.json({ success: true, data: { list } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to get logs' });
  }
});

module.exports = router;
