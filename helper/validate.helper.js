require('dotenv').config();
const jwt = require('jsonwebtoken');
const userModel = require('../model/user.model');

/**
 * Middleware: validates JWT from Authorization header (Bearer <token>).
 * If valid, decodes the token, loads the user from DB, and sets req.user.
 * Use on any route that requires the user to be logged in.
 */
const validateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await userModel.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found. Token may be invalid.',
      });
    }
    if (user.isActive !== true) {
      return res.status(401).json({
        success: false,
        message: 'Account is inactive.',
      });
    }

    req.user = user;
    req.userId = user._id;

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please log in again.',
      });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.',
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Unauthorized.',
    });
  }
};

/**
 * Optional auth: if valid Bearer token is present, sets req.user and req.userId; otherwise continues without 401.
 * Use for routes that work for both anonymous and logged-in users (e.g. submit feedback).
 */
const optionalValidateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;
    if (!token) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await userModel.findById(decoded.id);
    if (!user || user.isActive !== true) return next();

    req.user = user;
    req.userId = user._id;
    next();
  } catch {
    next();
  }
};

/** Must run after validateToken. Returns 403 if req.user.email is not adrianpurnama209@gmail.com */
const validateAdmin = (req, res, next) => {
  if (req.user?.isAdmin !== true) {
    return res.status(403).json({
      success: false,
      message: 'You are not authorized to access this resource.',
    });
  }
  next();
};

module.exports = { validateToken, validateAdmin, optionalValidateToken };
