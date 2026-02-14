/* Dependencies */
const crypto = require('crypto');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../model/user.model');
require('dotenv').config();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

/* Passport Middleware */
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:`${process.env.BE_URL}/auth/google/callback`,
    },
    async function (accessToken, refreshToken, profile, done) {
      try {
        let user = await User.findOne({ googleId: profile.id }).lean();
        if (user) {
          return done(null, user);
        }
        const email = profile.emails?.[0]?.value;
        if (!email) {
          return done(new Error('Google profile has no email'), null);
        }
        user = await User.findOne({ email }).lean();
        if (user) {
          await User.updateOne({ _id: user._id }, { googleId: profile.id });
          user = { ...user, googleId: profile.id };
          return done(null, user);
        }
        const profilePhoto = profile.photos?.[0]?.value || '';
        const newUser = await User.create({
          email,
          password: crypto.randomBytes(32).toString('hex'),
          googleId: profile.id,
          profile_url: profilePhoto,
          ...(email === ADMIN_EMAIL && { isAdmin: true }),
        });
        return done(null, newUser.toObject ? newUser.toObject() : newUser);
      } catch (err) {
        return done(err, null);
      }
    }
  )
);

/* How to store the user information in the session */
passport.serializeUser(function (user, done) {
  done(null, user._id);
});

/* How to retrieve the user from the session */
passport.deserializeUser(function (id, done) {
  User.findById(id)
    .then((user) => done(null, user))
    .catch((err) => done(err, null));
});

/* Exporting Passport Configuration */
module.exports = passport;