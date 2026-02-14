const express = require('express')
const router = express.Router()
require('../../model/user.model') // ensure User is registered before Feedback uses ref: 'User'
const feedbackModel = require('../../model/feedback.model')
const { validateToken, validateAdmin, optionalValidateToken } = require('../../helper/validate.helper')

// POST / – submit feedback (public); if Authorization header present, userId is set from token
router.post('/', optionalValidateToken, async (req, res) => {
  try {
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
