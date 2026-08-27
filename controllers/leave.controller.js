const { Leave, Notification } = require('../models/index');
const User = require('../models/User.model');

// @desc Apply for leave
exports.applyLeave = async (req, res) => {
  try {
    const { type, startDate, endDate, reason } = req.body;
    
    // Calculate duration in days
    const start = new Date(startDate);
    const end = new Date(endDate);
    const duration = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

    const leave = await Leave.create({
      employee: req.user._id,
      type,
      startDate,
      endDate,
      reason,
      duration
    });



    // Notify admins
    const io = req.app.get('io');
    io.to('admins').emit('new_leave_request', {
      leave,
      employeeName: req.user.name
    });

    res.status(201).json({ success: true, leave });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc Get my leaves
exports.getMyLeaves = async (req, res) => {
  try {
    const leaves = await Leave.find({ employee: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, leaves });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc Get all leaves (admin)
exports.getAllLeaves = async (req, res) => {
  try {
    const { status, employeeId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (employeeId) filter.employee = employeeId;

    const leaves = await Leave.find(filter)
      .populate('employee', 'name employeeId department avatar')
      .sort({ createdAt: -1 });
    
    res.json({ success: true, leaves });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc Update leave status (admin)
exports.updateLeaveStatus = async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;
    const leave = await Leave.findByIdAndUpdate(req.params.id, {
      status,
      approvedBy: req.user._id,
      approvedAt: new Date(),
      ...(rejectionReason && { rejectionReason })
    }, { new: true }).populate('employee', 'name socketId');

    if (!leave) return res.status(404).json({ success: false, message: 'Leave request not found' });

    // Notify employee
    const io = req.app.get('io');
    if (leave.employee.socketId) {
      io.to(leave.employee.socketId).emit('leave_status_update', {
        leaveId: leave._id,
        status
      });
    }

    // Create and send real-time notification
    const { sendNotification } = require('../services/notification.service');
    await sendNotification(io, {
      recipient: leave.employee._id,
      sender: req.user._id,
      type: 'leave',
      title: `Leave ${status.charAt(0).toUpperCase() + status.slice(1)}`,
      message: `Your leave request for ${new Date(leave.startDate).toLocaleDateString()} has been ${status}.`,
      data: { leaveId: leave._id }
    });

    res.json({ success: true, leave });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc Delete leave
exports.deleteLeave = async (req, res) => {
  try {
    await Leave.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Leave deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

