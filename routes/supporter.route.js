const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const supporterModel = require('../model/supporters.model');
const { validateToken, validateAdmin } = require('../helper/validate.helper');

const SUPPORTER_TYPES = ['platinum', 'gold', 'silver', 'bronze'];



router.get('/', async (req, res) => {
    try {
        const supporters = await supporterModel.find()
            .populate('userId', 'profile_url')
            .lean();
        const platinumSupporters = supporters.filter(supporter => supporter.supporterType === 'platinum');
        const goldSupporters = supporters.filter(supporter => supporter.supporterType === 'gold');
        const silverSupporters = supporters.filter(supporter => supporter.supporterType === 'silver');
        const bronzeSupporters = supporters.filter(supporter => supporter.supporterType === 'bronze');
        const allSupporters = {
            platinum : platinumSupporters.sort((a, b) => a.order - b.order),
            gold : goldSupporters.sort((a, b) => a.order - b.order),
            silver : silverSupporters.sort((a, b) => a.order - b.order),
            bronze : bronzeSupporters.sort((a, b) => a.order - b.order),
        }
        return res.status(200).json({
            success : true,
            data : allSupporters
        })
    } catch (err) {
        return res.status(500).json({
            success : false,
            message : err.message
        })
    }
})

router.post('/', validateToken, validateAdmin, async (req, res) => {
    try {
        const { userId, supporterType, displayName, links, order, tagLine } = req.body;

        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Valid userId is required' });
        }
        if (!supporterType || !SUPPORTER_TYPES.includes(supporterType)) {
            return res.status(400).json({ success: false, message: `supporterType must be one of: ${SUPPORTER_TYPES.join(', ')}` });
        }
        if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
            return res.status(400).json({ success: false, message: 'displayName is required' });
        }
        if (order === undefined || !Number.isFinite(Number(order))) {
            return res.status(400).json({ success: false, message: 'order must be a number' });
        }

        const cleanLinks = Array.isArray(links)
            ? links
                .filter((l) => l && typeof l.label === 'string' && l.label.trim() && typeof l.link === 'string' && l.link.trim())
                .map((l) => ({ label: l.label.trim(), link: l.link.trim(), icon: typeof l.icon === 'string' ? l.icon.trim() : '' }))
            : [];

        const supporter = await supporterModel.create({
            userId,
            supporterType,
            displayName: displayName.trim(),
            links: cleanLinks,
            order: Number(order),
            tagLine: typeof tagLine === 'string' ? tagLine.trim() : '',
            isVerified: Boolean(req.body.isVerified),
        });

        return res.status(201).json({
            success: true,
            message: 'Supporter created',
            data: supporter,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || 'Failed to create supporter',
        });
    }
})

router.patch('/:id', validateToken, validateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid supporter ID' });
        }

        const body = req.body || {};
        const updates = {};

        // userId – must be a valid ObjectId if provided
        if (body.userId !== undefined) {
            if (!mongoose.Types.ObjectId.isValid(body.userId)) {
                return res.status(400).json({ success: false, message: 'Invalid userId' });
            }
            updates.userId = body.userId;
        }

        // supporterType – must be one of the allowed values
        if (body.supporterType !== undefined) {
            if (!SUPPORTER_TYPES.includes(body.supporterType)) {
                return res.status(400).json({
                    success: false,
                    message: `supporterType must be one of: ${SUPPORTER_TYPES.join(', ')}`,
                });
            }
            updates.supporterType = body.supporterType;
        }

        // displayName – must be a non-empty string
        if (body.displayName !== undefined) {
            const name = typeof body.displayName === 'string' ? body.displayName.trim() : '';
            if (!name) {
                return res.status(400).json({ success: false, message: 'displayName cannot be empty' });
            }
            updates.displayName = name;
        }

        // links – must be an array; each item needs label and link strings
        if (body.links !== undefined) {
            if (!Array.isArray(body.links)) {
                return res.status(400).json({ success: false, message: 'links must be an array' });
            }
            for (let i = 0; i < body.links.length; i++) {
                const l = body.links[i];
                if (!l || typeof l.label !== 'string' || !l.label.trim()) {
                    return res.status(400).json({ success: false, message: `links[${i}].label is required` });
                }
                if (typeof l.link !== 'string' || !l.link.trim()) {
                    return res.status(400).json({ success: false, message: `links[${i}].link is required` });
                }
            }
            updates.links = body.links.map((l) => ({
                label: l.label.trim(),
                link: l.link.trim(),
                icon: typeof l.icon === 'string' ? l.icon.trim() : '',
            }));
        }

        // order – must be a number
        if (body.order !== undefined) {
            const order = Number(body.order);
            if (!Number.isFinite(order)) {
                return res.status(400).json({ success: false, message: 'order must be a number' });
            }
            updates.order = order;
        }

        // tagLine – optional string
        if (body.tagLine !== undefined) {
            updates.tagLine = typeof body.tagLine === 'string' ? body.tagLine.trim() : '';
        }

        // isVerified – optional boolean
        if (body.isVerified !== undefined) {
            updates.isVerified = Boolean(body.isVerified);
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, message: 'No valid fields to update' });
        }

        const supporter = await supporterModel.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true });
        if (!supporter) {
            return res.status(404).json({ success: false, message: 'Supporter not found' });
        }

        return res.status(200).json({
            success: true,
            message: 'Supporter updated',
            data: supporter,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || 'Failed to update supporter',
        });
    }
})

router.delete('/:id', validateToken, validateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid supporter ID' });
        }
        const supporter = await supporterModel.findByIdAndDelete(id);
        if (!supporter) {
            return res.status(404).json({ success: false, message: 'Supporter not found' });
        }
        return res.status(200).json({
            success: true,
            message: 'Supporter deleted',
            data: supporter,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message || 'Failed to delete supporter',
        });
    }
})

module.exports = router;