const express = require('express')
const router = express.Router()
require('../../model/user.model') // ensure User is registered before Feedback uses ref: 'User'
const feedbackModel = require('../../model/feedback.model')
const DownloadQueueModel = require('../../model/downloadQueue.model')
const StagingVideoModel = require('../../model/stagingVideo.model')
const systemModel = require('../../model/system.model')
const { validateToken, validateAdmin, optionalValidateToken } = require('../../helper/validate.helper')
const { fetchMovieByImdbId, fetchMovieByTmdbId } = require('../../helper/tmdb.helper')
const { getPosterUrl } = require('../../helper/movietv.helper')
const UploadedVideoModel = require('../../model/uploadedVideo.model')
const { verifyRecaptcha } = require('../../helper/recaptcha.helper')

const PAGE_SIZE = 20

// POST / – submit feedback (public); if Authorization header present, userId is set from token
router.post('/', optionalValidateToken, async (req, res) => {
  try {
    // reCAPTCHA required for all (prevents spam)
    if (process.env.SECRET_KEY) {
      const { recaptchaToken } = req.body || {}
      const result = await verifyRecaptcha(recaptchaToken, req.ip || req.socket?.remoteAddress)
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: 'Please complete the captcha verification',
        })
      }
    }
    const { feedback, feedbackType } = req.body
    if (!feedback || typeof feedback !== 'string' || !feedback.trim()) {
      return res.status(400).json({ success: false, message: 'Feedback text is required' })
    }
    const type = feedbackType === 'register' ? 'register' : 'feedback'
    const payload = {
      feedback: feedback.trim(),
      feedbackType: type,
    }
    // If request has authenticated user (e.g. from optional validateToken), set userId
    if (req.userId) {
      payload.userId = req.userId
    }
    const doc = await feedbackModel.create(payload)
    return res.status(201).json({ success: true, data: doc, message: 'Feedback submitted' })
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message })
  }
})

// POST /ad-free-request – request ad-free movie by tmdbId or imdbId (optional auth)
router.post('/ad-free-request', optionalValidateToken, async (req, res) => {
  try {
    const sys = await systemModel.findOne({}).select('openAdFreeRequest').lean()
    if (!sys?.openAdFreeRequest) {
      return res.status(403).json({
        success: false,
        message: 'Ad-free requests are currently closed',
      })
    }
    // reCAPTCHA required for all (prevents spam)
    if (process.env.SECRET_KEY) {
      const { recaptchaToken } = req.body || {}
      const result = await verifyRecaptcha(recaptchaToken, req.ip || req.socket?.remoteAddress)
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: 'Please complete the captcha verification',
        })
      }
    }
    const { tmdbId, imdbId } = req.body || {}
    const hasTmdb = tmdbId != null && (typeof tmdbId === 'number' || String(tmdbId).trim() !== '')
    const hasImdb = imdbId != null && typeof imdbId === 'string' && imdbId.trim() !== ''
    if (!hasTmdb && !hasImdb) {
      return res.status(400).json({
        success: false,
        message: 'tmdbId or imdbId is required',
      })
    }
    const movie = hasTmdb
      ? await fetchMovieByTmdbId(tmdbId)
      : await fetchMovieByImdbId(imdbId)
    if (!movie) {
      return res.status(404).json({
        success: false,
        message: hasTmdb ? 'Movie not found for this TMDB id' : 'Movie not found for this IMDB id',
      })
    }
    const movieTmdbId = movie.id != null ? Number(movie.id) : null
    if (movieTmdbId != null) {
      const [inQueue, inStaging, inUploaded] = await Promise.all([
        DownloadQueueModel.findOne({ tmdbId: movieTmdbId }).lean(),
        StagingVideoModel.findOne({ tmdbId: movieTmdbId }).lean(),
        UploadedVideoModel.findOne({ externalId: movieTmdbId }).lean(),
      ])
      if (inQueue || inStaging || inUploaded) {
        return res.status(400).json({
          success: false,
          message: 'This movie is already in the queue, staging, or has been uploaded',
        })
      }
    }
    const title = movie.title
      ? `${movie.title}${movie.release_date ? ` ${new Date(movie.release_date).getFullYear()}` : ''}`.trim()
      : `TMDB ${movie.id}`
    const requester = req.userId
      ? { id: req.userId, type: 'user' }
      : { id: null, type: 'guest' }
    const doc = await DownloadQueueModel.create({
      title,
      tmdbId: movieTmdbId,
      poster_path: movie.poster_path != null && String(movie.poster_path).trim() ? String(movie.poster_path).trim() : null,
      year: movie.release_date ? new Date(movie.release_date).getFullYear() : null,
      status: 'pending',
      requester,
    })
    return res.status(201).json({
      success: true,
      data: doc,
      message: 'Added to download queue',
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to add to queue',
    })
  }
})

// GET /ad-free-request – list download queue + ad-free-only (UploadedVideo without queue) with pagination
router.get('/ad-free-request', optionalValidateToken, async (req, res) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || PAGE_SIZE), 100)
    const skip = Math.max(0, parseInt(req.query.skip, 10) || 0)
    const statusFilter = req.query.status?.trim() || null

    const [allQueue, allAdFreeOnly] = await Promise.all([
      DownloadQueueModel.find({}).sort({ createdAt: -1 }).lean(),
      UploadedVideoModel.find({ slugStatus: 'ready', externalId: { $ne: null } }).sort({ createdAt: -1 }).lean(),
    ])
    const queueTmdbSet = new Set(allQueue.map((d) => d.tmdbId).filter((id) => id != null))
    const adFreeOnly = allAdFreeOnly.filter((d) => !queueTmdbSet.has(d.externalId))
    const adFreeByTmdb = new Map(allAdFreeOnly.map((d) => [d.externalId, d.slugStatus]))

    const queueItems = allQueue.map((item) => {
      let downloadStatus
      const slugStatus = item.tmdbId != null ? adFreeByTmdb.get(item.tmdbId) : undefined
      if (slugStatus === 'ready') {
        downloadStatus = 'ad_free'
      } else if (item.status === 'done') {
        downloadStatus = 'processing'
      } else if (item.status === 'uploading') {
        downloadStatus = 'staging'
      } else {
        downloadStatus = item.status
      }
      return {
        ...item,
        poster_url: getPosterUrl(item.poster_path, 'w200') || null,
        downloadStatus,
      }
    })
    const adFreeOnlyItems = adFreeOnly.map((d) => ({
      _id: d._id,
      title: d.title || `TMDB ${d.externalId}`,
      tmdbId: d.externalId,
      poster_path: d.poster_path,
      poster_url: getPosterUrl(d.poster_path, 'w200') || null,
      year: d.year ?? null,
      downloadStatus: 'ad_free',
      createdAt: d.createdAt,
      fromUploadedVideo: true,
    }))

    let combined = [...queueItems, ...adFreeOnlyItems].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    )
    if (statusFilter) {
      combined = combined.filter((item) => item.downloadStatus === statusFilter)
    }
    const total = combined.length
    const list = combined.slice(skip, skip + limit)

    return res.status(200).json({
      success: true,
      data: { list, total, page: Math.floor(skip / limit) + 1, totalPages: Math.ceil(total / limit) || 1 },
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to list queue',
    })
  }
})

// GET / – list all feedback (admin only)
router.get('/', validateToken, validateAdmin, async (req, res) => {
  try {
    const list = await feedbackModel
      .find()
      .populate('userId', 'email')
      .sort({ createdAt: -1 })
      .lean()
    return res.status(200).json({ success: true, data: list })
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message })
  }
})

// DELETE /:id – delete feedback (admin only)
router.delete('/:id', validateToken, validateAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const doc = await feedbackModel.findByIdAndDelete(id)
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Feedback not found' })
    }
    return res.status(200).json({ success: true, message: 'Feedback deleted' })
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router
