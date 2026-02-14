const OtpModel = require('../model/otp.model');

const OTP_EXPIRY_MS = 15 * 60 * 1000

const createOtp = async (email, purposeOrUserId = 'register') => {
    if (!email) throw new Error('Email is required')
    const purpose = purposeOrUserId === 'reset' ? 'reset' : 'register'

    const generateOtp = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS)

    const tryUpsert = async () => {
        return await OtpModel.findOneAndUpdate(
            { email, purpose },
            { email, purpose, otp: generateOtp, expiresAt },
            { upsert: true, new: true }
        )
    }

    try {
        const existing = await OtpModel.findOne({ email, purpose })
        if (existing) await existing.deleteOne()
        return await tryUpsert()
    } catch (err) {
        if (err.code === 11000) {
            await OtpModel.deleteMany({ email })
            return await tryUpsert()
        }
        throw err
    }
}

const verifyOtp = async (email, otp, purpose = 'register') => {
    if (!otp) throw new Error('OTP is required')
    if (!email) throw new Error('Email is required')

    const findOtp = await OtpModel.findOne({ email, otp, purpose })
    if (!findOtp) return false
    await findOtp.deleteOne()
    return true
}

module.exports = { createOtp, verifyOtp }
