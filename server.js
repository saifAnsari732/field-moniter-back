const express = require('express');

// 🛡️ Global Crash Protection to prevent server from shutting down on MilesWeb
process.on('uncaughtException', (err) => {
  console.error('🔥 CRITICAL: Uncaught Exception caught to prevent crash:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 CRITICAL: Unhandled Rejection caught to prevent crash. Reason:', reason);
});

const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

dotenv.config();

const app = express();
const server = http.createServer(app);
app.set('trust proxy', 1);

// Allowed origins list for CORS
const allowedOrigins = [
  'https://tm24news.com',
  'https://tm24news.in',
  'https://www.tm24news.in', 
  "http://localhost:8081",
  "http://localhost:3000",
  "http://localhost:3001",
  'https://www.tm24news.com',
  'https://kisanteamweb.it.com',
  'https://tm-24news.vercel.app',
  'https://tm24news.vercel.app',
  'https://crm-front-sand.vercel.app'
];

// 🔴 यहाँ EXPRESS API के लिए CORS लगाना ज़रूरी है (इसे अपने कोड में जोड़ें):
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1 || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      callback(null, true); 
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }, 
  credentials: true
}));

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or postman)
      if (!origin || allowedOrigins.indexOf(origin) !== -1 || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: false, // Required for cross-origin images/resources
}));
app.use(compression());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.indexOf(origin) !== -1 || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // limit each IP to 500 requests per windowMs
  message: { success: false, message: 'Too many requests from this IP, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false, 
});
app.use('/api/', limiter);

// Make io accessible to routes
app.set('io', io);
 
// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/employees', require('./routes/employee.routes'));
app.use('/api/tracking', require('./routes/tracking.routes'));
app.use('/api/meetings', require('./routes/meeting.routes'));
app.use('/api/expenses', require('./routes/expense.routes'));
app.use('/api/attendance', require('./routes/attendance.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/manager', require('./routes/manager.routes'));
  app.use('/api/upload', require('./routes/upload.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));
app.use('/api/leaves', require('./routes/leave.routes'));
app.use('/api/tasks', require('./routes/task.routes'));
// Mock dashboard route since local backend is missing dashboard.routes.js

app.get('/api/dashboard/stats', (req, res) => {
  res.json({
    success: true,
    stats: {
      todayAttendance: { status: 'present' },
      monthlyAttendance: { present: 20, absent: 2, leave: 1 },
      totalExpenses: 500,
      completedMeetings: 10
    }
  });
});
app.use('/api/leads', require('./routes/lead.routes'));
//  news api
app.use('/api', require('./routes/newsRouts'));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));

// Socket.IO Logic
const socketHandler = require('./socket/socket.handler');
socketHandler(io);

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://ansarisaifuddin732_db_user:M2oWIFAFysw7DpGi@cluster0.gbipgw2.mongodb.net/')
  .then(async () => {
    console.log('✅ MongoDB connected');

    // ── Reset all stuck online status on startup ──────────────────────────────
    try {
      const User = require('./models/User.model');
      await User.updateMany({ isOnline: true }, { isOnline: false, socketId: null });
      console.log('🔄 Reset all online users to offline on startup.');
    } catch (err) {
      console.error('Failed to reset online status:', err.message);
    }

    // ── No-Movement Cron (REST API tracking) ─────────────────────────────────
    // TEST MODE: 2 minutes interval, targeting SAIFUDDIN ANSARI specifically
    // Change back to 5 * 60 * 1000 after testing
    try {
      const User = require('./models/User.model');
      const { LiveLocation } = require('./models/index');

      const NO_MOVE_MS   = 2 * 60 * 1000; // ⚠️ TEST: 2 min (change to 5*60*1000 in prod)
      const CRON_INTERVAL = 2 * 60 * 1000; // ⚠️ TEST: run every 2 min

      // TEST: specific employee ID (SAIFUDDIN ANSARI)
      const TEST_EMP_ID = '6a869f68a49bfc4e9cf7359a';

      setInterval(async () => {
        try {
          const now   = Date.now();
          const today = new Date().toISOString().slice(0, 10);

          // Find active sessions not updated in NO_MOVE_MS
          const staleSessions = await LiveLocation.find({
            isActive: true,
            date: today,
            employee: TEST_EMP_ID,            // ⚠️ TEST: only this employee
            updatedAt: { $lt: new Date(now - NO_MOVE_MS) }
          }).populate('employee', '_id name socketId isTracking');

          // If no stale session found but employee is tracking, still alert (for test)
          let targets = staleSessions;
          if (targets.length === 0) {
            // Force test alert to this employee even without a stale session
            const testEmp = await User.findById(TEST_EMP_ID).select('_id name socketId isTracking');
            if (testEmp) targets = [{ employee: testEmp }];
          }

          for (const session of targets) {
            const emp = session.employee;
            if (!emp) continue;

            // Send alert to employee room (works even if socketId changes)
            io.to(`user_${emp._id}`).emit('alert', {
              title: '⚠️ Movement Alert',
              message: 'You have been stationary for 2 minutes (TEST). Please start moving!',
              type: 'stationary'
            });

            // Notify admins
            io.to('admins').emit('employee_stationary', {
              employeeId: emp._id,
              name: emp.name,
              timestamp: Date.now(),
              message: `[TEST] ${emp.name} stationary alert triggered.`
            });

            console.log(`⚠️ [TEST Cron] Alert sent → ${emp.name}`);
          }
        } catch (cronErr) {
          console.error('No-movement cron error:', cronErr.message);
        }
      }, CRON_INTERVAL);

      console.log('⏰ [TEST] No-movement cron started (2-min interval, SAIFUDDIN ANSARI).');
    } catch (err) {
      console.error('Failed to start no-movement cron:', err.message);
    }
  })
  .catch(err => console.error('❌ MongoDB error:', err));


// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal S-erver Error',
  });
});
 
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

module.exports = { app, server, io };
