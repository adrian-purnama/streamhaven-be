require('dotenv').config();
const jwt = require('jsonwebtoken');
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const system = require('../model/system.model');
const user = require('../model/user.model');
const { createOtp, verifyOtp } = require('../helper/otp.helper');
const { sendOtpEmail, sendResetOtpEmail } = require('../helper/email.helper');
const { validateToken, validateAdmin } = require('../helper/validate.helper');
const { validateAndCleanEmail } = require('../helper/regex.helper');
const passport = require('../helper/passport.helper');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

// Public: branding (logo, app name, tagline, full logo) for the frontend
router.get('/branding', async (req, res) => {
    const doc = await system.findOne({}).select('appName logoUrl logoFullUrl tagLine openAdFreeRequest').lean()
    if (!doc) {
        return res.status(200).json({
            success: true,
            data: { appName: 'Stream Haven', logoUrl: '', logoFullUrl: '', tagLine: '', openAdFreeRequest: false },
        })
    }
    return res.status(200).json({
        success: true,
        data: {
            appName: doc.appName || 'Stream Haven',
            logoUrl: doc.logoUrl || '',
            logoFullUrl: doc.logoFullUrl || '',
            tagLine: doc.tagLine || '',
            openAdFreeRequest: Boolean(doc.openAdFreeRequest),
        },
    })
})

router.get('/check-registration', async (req, res) => {
    const findSystem = await system.findOne({})
    
    if(!findSystem || !findSystem.openRegistration){
        return res.status(404).json({
            success : false,
            message : "System not found or registration is closed"
        })
    }

    return res.status(200).json({
        success : true,
        message : "Registration is open"
    })
})

router.post('/forgot-password', async (req, res) => {
    let { email } = req.body;
    email = validateAndCleanEmail(email);
    if (!email) {
        return res.status(400).json({ success: false, message: 'Email is required' });
    }
    const existingUser = await user.findOne({ email }).lean();
    if (!existingUser) {
        return res.status(200).json({
            success: true,
            message: 'If an account exists with this email, you will receive a reset code shortly.',
        });
    }
    const branding = await system.findOne({}).select('appName logoUrl').lean();
    const appName = branding?.appName || 'Stream Haven';
    let logoUrl = branding?.logoUrl || '';
    if (logoUrl) logoUrl = process.env.BE_URL + logoUrl;
    const newOtp = await createOtp(email, 'reset');
    await sendResetOtpEmail(email, newOtp.otp, appName, logoUrl);
    return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, you will receive a reset code shortly.',
    });
});

router.post('/reset-password', async (req, res) => {
    let { email, otp, newPassword } = req.body;
    email = validateAndCleanEmail(email);
    if (!email || !otp || !newPassword) {
        return res.status(400).json({
            success: false,
            message: 'Email, OTP and new password are required',
        });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({
            success: false,
            message: 'Password must be at least 6 characters',
        });
    }
    const valid = await verifyOtp(email, otp, 'reset');
    if (!valid) {
        return res.status(400).json({
            success: false,
            message: 'Invalid or expired reset code',
        });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await user.findOneAndUpdate({ email }, { password: hashedPassword });
    return res.status(200).json({
        success: true,
        message: 'Password reset successfully. You can now log in.',
    });
});

router.post('/send-otp', async (req, res) => {
    let { email } = req.body;
    email = validateAndCleanEmail(email) 
    if(!email){
        return res.status(400).json({
            success : false,
            message : "Email is required"
        })
    }
    const existingUser = await user.findOne({ email }).lean();
    if (existingUser) {
        return res.status(400).json({
            success: false,
            message: "An account with this email is already registered"
        })
    }
    const branding = await system.findOne({}).select('appName logoUrl').lean();
    const appName = branding?.appName || 'Stream Haven';
    let logoUrl = branding?.logoUrl || '';
    if (logoUrl) {
        logoUrl = process.env.BE_URL + logoUrl;
    }
    const newOtp = await createOtp(email)
    await sendOtpEmail(email, newOtp.otp, appName, logoUrl)
    return res.status(200).json({
        success : true,
        message : "OTP sent successfully"
    })
})


const bad = (res, message, status = 400) =>
    res.status(status).json({ success: false, message })

router.post('/register', async (req, res) => {
    const { email: rawEmail, password, otp } = req.body
    // ——— check system registration ———
    const sys = await system.findOne({})
    if (!sys?.openRegistration) return res.status(400).json({
        success : false,
        message : "Registration is closed"
    })

    if (!rawEmail || !password || !otp) {
        return res.status(400).json({
            success : false,
            message : "Email, full name, password and OTP are required"
        })
    }

    let email

    try {
        email = validateAndCleanEmail(rawEmail)
    } catch (e) {
        return res.status(400).json({
            success : false,
            message : e.message
        })
    }

    if (await user.findOne({ email })) return res.status(400).json({
        success : false,
        message : "Email already exists"
    })
    if (!(await verifyOtp(email, otp, 'register'))) return res.status(400).json({
        success : false,
        message : "Invalid OTP"
    })

    // ——— Create user ———
    const hashedPassword = await bcrypt.hash(password, 10)

    if(email === ADMIN_EMAIL){
        const newUser = await user.create({ email, password: hashedPassword, isAdmin: true })
        return res.status(200).json({
            success : true,
            message : "User created successfully",
            data : { id: newUser._id, email: newUser.email}
        })
    }
    const newUser = await user.create({ email, password: hashedPassword })

    return res.status(200).json({
        success: true,
        message: 'User created successfully',
        data: { id: newUser._id, email: newUser.email},
    })
})


router.post('/login', async (req, res) => {
    let { email, password } = req.body;
    email = validateAndCleanEmail(email)
    if(!email || !password){
        return res.status(400).json({
            success : false,
            message : "Email and password are required"
        })
    }

    const findUser = await user.findOne({ email })
    if(!findUser){
        return res.status(400).json({
            success : false,
            message : "Invalid email or password"
        })
    }
    const isPasswordValid = await bcrypt.compare(password, findUser.password)
    if(!isPasswordValid){
        return res.status(400).json({
            success : false,
            message : "Invalid email or password"
        })
    }

    const token = jwt.sign({ id: findUser._id, email: findUser.email }, process.env.JWT_SECRET, { expiresIn: '30d' })

    return res.status(200).json({
        success : true,
        message : "Login successful",
        data : { email: findUser.email, token }
    })
})

router.get('/verify-token', validateToken, (req, res) => {
    const { _id, email, profile_url } = req.user
    return res.status(200).json({
        success: true,
        message: 'Token verified',
        data: { id: _id, email, isAdmin: req.user.isAdmin, profile_url: profile_url || '' }
    })
})

router.get('/is-admin', validateToken, validateAdmin, (req, res) => {
    return res.status(200).json({
        success: true,
        message: 'You are an admin',
    })
});

const FRONTEND_URL = process.env.FE_URL || 'http://localhost:5173';

/* Route to start OAuth2 authentication */
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
  })
);

/* Callback route for OAuth2 authentication — issue JWT and redirect to frontend */
router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false }, (err, user) => {
    if (err) {
      const param = err.message === 'Registration is closed' ? 'registration_closed' : 'google';
      return res.redirect(`${FRONTEND_URL}/login?error=${param}`);
    }
    if (!user || !user._id) {
      return res.redirect(`${FRONTEND_URL}/login?error=google`);
    }
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.redirect(`${FRONTEND_URL}/login?token=${encodeURIComponent(token)}`);
  })(req, res, next);
});

  
module.exports = router;