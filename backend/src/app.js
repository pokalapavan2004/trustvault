// src/app.js
// Express application configuration and middleware pipeline

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const authRouter = require('./routes/auth');
const profileRouter = require('./routes/profile');
const documentsRouter = require('./routes/documents');
const usersRouter = require('./routes/users');
const activityLogsRouter = require('./routes/audit');

const app = express();

// Trust proxy for rate limiting behind reverse proxies (like Render)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Security & cross-origin middleware
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',');
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. same-origin requests, mobile apps, curl) or matching allowed origins
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount routes
app.use('/api/auth', authRouter);
app.use('/api/profile', profileRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/users', usersRouter);
app.use('/api/activity-logs', activityLogsRouter);

// In production, Express serves frontend/dist as static files and returns index.html for any non-/api route
if (process.env.NODE_ENV === 'production') {
  const frontendDist = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDist));

  // SPA fallback for client-side routing
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Explicit error handler (No stack traces in responses - AGENTS.md Code style)
app.use((err, req, res, next) => {
  // Uniform 404 response for authorization/missing document errors (AGENTS.md Security Invariant 2)
  if (err.name === 'NotFoundError' || err.status === 404) {
    return res.status(404).json({ error: 'Document not found' });
  }

  // Handle Multer upload size limit
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File size exceeds 10 MB limit' });
  }

  console.error('Unhandled application error:', err.message);

  const status = err.status || 500;
  const message = status === 500 ? 'Internal server error' : err.message;

  res.status(status).json({ error: message });
});

module.exports = app;
