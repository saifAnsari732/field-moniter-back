const jwt = require('jsonwebtoken');
const User = require('../models/User.model');

const HEARTBEAT_TIMEOUT = 60000; // 60 seconds
const heartbeatTimers = new Map(); // Track heartbeat timers per socket

module.exports = (io) => {
  // Auth middleware for socket
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Authentication error'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user) return next(new Error('User not found'));
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.user;
    console.log(`🔌 ${user.name} connected [${user.role}] - ${socket.id}`);

    // Update user socket ID and online status
    await User.findByIdAndUpdate(user._id, { socketId: socket.id, isOnline: true });

    // Join role-based rooms
    if (user.role === 'admin' || user.role === 'hr') {
      socket.join('admins');
      // Send current online employees to admin
      const onlineEmployees = await User.find({ isOnline: true, role: 'employee' })
        .select('name employeeId isTracking isOnline lastSeen avatar department');
      socket.emit('online_employees', onlineEmployees);
    }
    socket.join(`user_${user._id}`);

    // ─── Heartbeat Mechanism ────────────────────────────────────────────────────
    const setupHeartbeatTimeout = () => {
      if (heartbeatTimers.has(socket.id)) {
        clearTimeout(heartbeatTimers.get(socket.id));
      }

      const timer = setTimeout(() => {
        console.log(`⏱️ Heartbeat timeout for ${user.name}, disconnecting...`);
        socket.disconnect(true);
      }, HEARTBEAT_TIMEOUT);

      heartbeatTimers.set(socket.id, timer);
    };

    socket.on('heartbeat', (data) => {
      // Reset heartbeat timeout on client heartbeat
      setupHeartbeatTimeout();
      socket.emit('heartbeat_ack', { timestamp: Date.now() });
    });

    setupHeartbeatTimeout();

    // ─── No-Movement Detection ──────────────────────────────────────────────────
    const NO_MOVE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
    const MOVE_THRESHOLD_METERS = 20; // less than 20m = not moved

    // Haversine distance in meters
    function haversineMeters(lat1, lng1, lat2, lng2) {
      const R = 6371000;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    let lastKnownPos = null;        // { lat, lng }
    let noMoveTimer = null;         // setTimeout handle
    let stationaryAlertSent = false; // avoid spam

    function resetNoMoveTimer(lat, lng) {
      if (noMoveTimer) clearTimeout(noMoveTimer);
      stationaryAlertSent = false;
      noMoveTimer = setTimeout(() => {
        if (stationaryAlertSent) return;
        stationaryAlertSent = true;
        // Alert employee
        socket.emit('alert', {
          title: '⚠️ Movement Alert',
          message: 'You have been stationary for 5 minutes. Please start moving or update your status.',
          type: 'stationary'
        });
        // Alert admins
        io.to('admins').emit('employee_stationary', {
          employeeId: user._id,
          name: user.name,
          avatar: user.avatar,
          department: user.department,
          lat,
          lng,
          timestamp: Date.now(),
          message: `${user.name} has been stationary for 5 minutes.`
        });
        console.log(`⚠️ Stationary alert sent for ${user.name}`);
      }, NO_MOVE_TIMEOUT);
    }

    // ─── Tracking Events ────────────────────────────────────────────────────────
    socket.on('location_ping', async (data) => {
      const { lat, lng } = data;

      // Check movement
      if (lastKnownPos && lat && lng) {
        const dist = haversineMeters(lastKnownPos.lat, lastKnownPos.lng, lat, lng);
        if (dist >= MOVE_THRESHOLD_METERS) {
          // Employee moved — reset timer
          lastKnownPos = { lat, lng };
          resetNoMoveTimer(lat, lng);
        }
        // else: still stationary, timer keeps running
      } else if (lat && lng) {
        // First ping
        lastKnownPos = { lat, lng };
        resetNoMoveTimer(lat, lng);
      }

      // Real-time location broadcast to admins
      io.to('admins').emit('employee_location', {
        employeeId: user._id,
        name: user.name,
        avatar: user.avatar,
        department: user.department,
        ...data,
      });
    });


    socket.on('tracking_started', (data) => {
      io.to('admins').emit('employee_tracking_started', {
        employeeId: user._id,
        name: user.name,
        avatar: user.avatar,
        ...data,
      });
    });

    socket.on('tracking_stopped', (data) => {
      // Clear no-movement timer
      if (noMoveTimer) { clearTimeout(noMoveTimer); noMoveTimer = null; }
      lastKnownPos = null;
      stationaryAlertSent = false;
      io.to('admins').emit('employee_tracking_stopped', {
        employeeId: user._id,
        name: user.name,
        ...data,
      });
    });

    // ─── Chat / Notifications ────────────────────────────────────────────────────
    socket.on('send_notification', async (data) => {
      const { recipientId, title, message, type } = data;
      io.to(`user_${recipientId}`).emit('notification', {
        title,
        message,
        type,
        from: user.name,
      });
    });

    socket.on('admin_alert', (data) => {
      io.to(`user_${data.employeeId}`).emit('alert', {
        message: data.message,
        from: 'Admin',
      });
    });

    // ─── Disconnect ─────────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      console.log(`🔌 ${user.name} disconnected`);

      // Clear heartbeat timer
      if (heartbeatTimers.has(socket.id)) {
        clearTimeout(heartbeatTimers.get(socket.id));
        heartbeatTimers.delete(socket.id);
      }
      // Clear no-movement timer
      if (noMoveTimer) { clearTimeout(noMoveTimer); noMoveTimer = null; }

      await User.findByIdAndUpdate(user._id, {
        isOnline: false,
        lastSeen: new Date(),
        socketId: null,
      });

      io.to('admins').emit('employee_offline', {
        employeeId: user._id,
        name: user.name,
      });
    });

    // ─── Error Handling ─────────────────────────────────────────────────────────
    socket.on('error', (error) => {
      console.error(`Socket error for ${user.name}:`, error);
    });

    // Confirm connection to client
    socket.emit('connected', {
      message: 'Connected to server',
      userId: user._id,
      timestamp: Date.now(),
    });
  });

  // Cleanup on server shutdown
  io.on('disconnect', (socket) => {
    if (heartbeatTimers.has(socket.id)) {
      clearTimeout(heartbeatTimers.get(socket.id));
      heartbeatTimers.delete(socket.id);
    }
  });
};
