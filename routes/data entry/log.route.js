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

// GET /api/logs?category=...&skip=0&limit=50
//   &format=entries → returns { list: [ { logName, logTimestamp, log } ], total } (paginated by entry)
//   else → returns { list: string[], total } (flat lines, legacy)
router.get('/', async (req, res) => {
  try {
    const category = req.query.category?.trim();
    const isAll = !category || category === 'all';
    if (!isAll && !LOG_NAME_ENUM.includes(category)) {
      return res.status(400).json({ success: false, message: 'Valid category or "all" required (use GET /api/logs/categories)' });
    }
    const formatEntries = req.query.format === 'entries';
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 100);
    const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
    const sys = await systemModel.findOne({}).lean();
    const logs = sys?.systemLogs || [];

    if (formatEntries) {
      let entries = isAll ? [...logs] : logs.filter((e) => e.logName === category);
      entries = entries.reverse(); // newest first
      const total = entries.length;
      entries = entries.slice(skip, skip + limit);
      const list = entries.map((e) => ({
        logName: e.logName,
        logTimestamp: e.logTimestamp ? new Date(e.logTimestamp).toISOString() : null,
        log: e.log || [],
      }));
      return res.json({ success: true, data: { list, total } });
    }

    let allLines;
    if (isAll) {
      allLines = [];
      for (const name of LOG_NAME_ENUM) {
        const entry = logs.find((e) => e.logName === name);
        const lines = entry?.log || [];
        lines.forEach((line) => allLines.push(`[${name}] ${line}`));
      }
    } else {
      const entry = logs.find((e) => e.logName === category);
      allLines = entry?.log || [];
    }
    const total = allLines.length;
    const list = allLines.slice(skip, skip + limit);
    return res.json({ success: true, data: { list, total } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Failed to get logs' });
  }
});

module.exports = router;
