const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const systemModel = require('./model/system.model');
const MediaModel = require('./model/media.model');
const passport = require("./helper/passport.helper");
const session = require('express-session');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

const authRoutes = require('./routes/auth.route.js');
const systemRoutes = require('./routes/data entry/system.route.js');
const userRoutes = require('./routes/data entry/user.route.js');
const imageRoutes = require('./routes/image.route.js');
const genreRoutes = require('./routes/data entry/genre.route.js');
const serverRoutes = require('./routes/data entry/server.route.js');
const movieRoutes = require('./routes/movie.route.js');
const tvRoutes = require('./routes/tv.route.js');
const discoverRoutes = require('./routes/discover.route.js');
const languagesRoutes = require('./routes/languages.route.js');
const personRoutes = require('./routes/person.route.js');
const supporterRoutes = require('./routes/supporter.route.js');

// --------------- Security headers ---------------
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow images/fonts to load cross-origin
  contentSecurityPolicy: false, // disable CSP so the SPA can load freely; tighten in production if needed
}));

// --------------- CORS ---------------
const allowedOrigins = (process.env.FE_URL || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// --------------- Rate limiting ---------------
// Global limiter: 200 requests per minute per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 200,
  standardHeaders: true,      // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false,       // Disable `X-RateLimit-*` headers
  message: { success: false, message: 'Too many requests, please try again later.' },
});
app.use(globalLimiter);

// Stricter limiter for auth endpoints (login/register): 15 requests per minute
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many auth attempts, please try again later.' },
});

app.use(express.json({ limit: '5mb' }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'streamhaven-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' },
  })
);
app.use(passport.initialize());
app.use(passport.session());

const populateSystem = async () => {
    const findSystem = await systemModel.findOne({})
    if(findSystem){
        return;
    }
    const initalSystem = {
        appName : 'Stream Haven',
        openRegistration : true,
        logoUrl : 'https://placehold.co/600x400',
    }
    systemModel.create(initalSystem)
    console.log("init system success")
}



app.get('/api/health', (req, res) => {
    res.status(200).json({message : "Made By Love from Adrian"})
})

/** One-time fix: drop id_1 unique index if present. Causes E11000 dup key on upsert when docs lack id. */
async function dropMediaIdIndex() {
  try {
    await MediaModel.collection.dropIndex('id_1');
    console.log('Dropped media.id_1 index (fix for E11000 duplicate key)');
  } catch (err) {
    if (err.code === 27 || err.codeName === 'IndexNotFound') return; // index doesn't exist
    console.warn('Could not drop media.id_1 index:', err.message);
  }
}

mongoose.connect(process.env.MONGODB_URI, {
    dbName : "app",
})
.then(async () => {
    await dropMediaIdIndex();
    await populateSystem();
    console.log("MongoDB Connected");
})
.catch((err)=> (console.log(err)))


// Very strict limiter for OTP-sending endpoints: 1 request per 2 minutes per IP
const otpLimiter = rateLimit({
  windowMs: 2 * 60 * 1000,   // 2 minutes
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Please wait 2 minutes before requesting another code.' },
});
app.use('/auth/send-otp', otpLimiter);
app.use('/auth/forgot-password', otpLimiter);

app.use('/auth', authLimiter, authRoutes)
app.use('/api/system', systemRoutes)
app.use('/api/users', userRoutes)
app.use('/api/images', imageRoutes)
app.use('/api/genres', genreRoutes)
app.use('/api/servers', serverRoutes)
app.use('/api/movies', movieRoutes)
app.use('/api/tv', tvRoutes)
app.use('/api/discover', discoverRoutes)
app.use('/api/languages', languagesRoutes)
app.use('/api/person', personRoutes)
app.use('/api/supporters', supporterRoutes)

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
