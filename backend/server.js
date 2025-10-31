import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// Routes
import authRoutes from './routes/auth.js';
import wasteRoutes from './routes/waste.js';
import trainingRoutes from './routes/training.js';
import facilityRoutes from './routes/facilities.js';
import adminRoutes from './routes/admin.js';
import userRoutes from './routes/users.js';

dotenv.config();

const app = express();

// ✅ CORS Configuration - Updated with new domain
app.use(
  cors({
    origin: process.env.NODE_ENV === 'production' 
      ? [
          'https://ecomanager-two.vercel.app',
          'https://ecomanager-gamma.vercel.app',
          'https://ecomanager-kappa.vercel.app',
          'https://ecomanager-oigp.vercel.app', // Added new domain
          /^https:\/\/ecomanager-.*\.vercel\.app$/ // Pattern for all deployment previews
        ]
      : 'http://localhost:5173',
    credentials: true,
  })
);

// ✅ Security - Updated for Vercel
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false // Disable for API
}));

// ✅ Rate Limiter - More lenient for production
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 200 : 100,
  message: 'Too many requests, try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// ✅ Body Parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ✅ MongoDB Connection (Optimized for Serverless)
let cachedDb = null;

const connectDB = async () => {
  if (cachedDb && mongoose.connection.readyState === 1) {
    console.log('📊 Using cached MongoDB connection');
    return cachedDb;
  }
  
  try {
    const options = {
      serverSelectionTimeoutMS: 10000, // Increased timeout
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 2,
      retryWrites: true,
      retryReads: true,
    };

    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    const conn = await mongoose.connect(process.env.MONGODB_URI, options);
    cachedDb = conn;
    console.log('✅ MongoDB connected successfully');
    return conn;
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    throw err;
  }
};

// ✅ Middleware to ensure DB connection before requests
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error('Database connection failed:', error);
    res.status(503).json({ 
      success: false, 
      message: 'Service temporarily unavailable - Database connection failed',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

// ✅ Root Route - PUBLIC (no auth required)
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'EcoManager API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    status: 'online',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      waste: '/api/waste',
      training: '/api/training',
      facilities: '/api/facilities',
      admin: '/api/admin',
      users: '/api/users',
    }
  });
});

// ✅ Health Check - PUBLIC
app.get('/api/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  res.json({
    success: true,
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: {
      status: dbStatus[dbState] || 'unknown',
      readyState: dbState
    },
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// ✅ API Routes
app.use('/api/auth', authRoutes);
app.use('/api/waste', wasteRoutes);
app.use('/api/training', trainingRoutes);
app.use('/api/facilities', facilityRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);

// ✅ 404 Handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    message: 'Route not found',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
    availableEndpoints: [
      'GET /',
      'GET /api/health',
      'POST /api/auth/login',
      'POST /api/auth/register',
      'GET /api/facilities',
      'GET /api/waste/reports',
      'GET /api/training/modules'
    ]
  });
});

// ✅ Error Handler
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  
  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: Object.values(err.errors).map(e => e.message)
    });
  }
  
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
  
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }

  if (err.name === 'MulterError') {
    return res.status(400).json({
      success: false,
      message: 'File upload error',
      error: err.message
    });
  }

  // Generic error response
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? 'Something went wrong!' 
      : err.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// ✅ Local Development Server
const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'production') {
  const startServer = async () => {
    try {
      await connectDB();
      app.listen(PORT, () => {
        console.log('╔═══════════════════════════════════╗');
        console.log('🚀 Server started successfully!');
        console.log('╚═══════════════════════════════════╝');
        console.log(`📡 Server URL: http://localhost:${PORT}`);
        console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`💾 Database: Connected`);
        console.log('═══════════════════════════════════');
      });
    } catch (error) {
      console.error('❌ Failed to start server:', error.message);
      process.exit(1);
    }
  };
  startServer();
}

// ✅ Export for Vercel
export default app;