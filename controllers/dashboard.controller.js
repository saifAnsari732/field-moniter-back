const { Attendance, Meeting, Expense, Task } = require('../models');
const User = require('../models/User.model');
const moment = require('moment');

exports.getEmployeeStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const today = moment().format('YYYY-MM-DD');

    // 1. Get Attendance for today
    const attendance = await Attendance.findOne({ employee: userId, date: today });

    // 2. Get Meeting count for today
    const meetingCount = await Meeting.countDocuments({
      employee: userId,
      date: {
        $gte: moment().startOf('day').toDate(),
        $lte: moment().endOf('day').toDate()
      }
    });

    // 3. Get Expense total for today
    const expenses = await Expense.find({
      employee: userId,
      date: {
        $gte: moment().startOf('day').toDate(),
        $lte: moment().endOf('day').toDate()
      },
      status: { $ne: 'rejected' }
    });
    const expenseTotal = expenses.reduce((sum, exp) => sum + exp.amount, 0);

    // 4. Get User details for travel rate & allowance
    const user = await User.findById(userId).select('TA DA');

    // 5. Calculate Travel Pay
    const distance = attendance?.totalDistanceTraveled || 0;
    const travelPay = (distance * (user.TA || 0)).toFixed(2);

    // Calculate total distance across all dates
    const allAttendance = await Attendance.aggregate([
      { $match: { employee: user._id } },
      { $group: { _id: null, total: { $sum: '$totalDistanceTraveled' } } }
    ]);
    const totalDistanceAllDates = allAttendance.length > 0 ? allAttendance[0].total : 0;

    res.json({
      success: true,
      stats: {
        distanceToday: distance.toFixed(2),
        totalDistanceAllDates: totalDistanceAllDates.toFixed(2),
        meetingCount,
        expenseTotal,
        travelRate: user.TA || 0,
        dailyAllowance: user.DA || 0,
        status: attendance?.status || 'absent',
        travelPay,
        todayDistanceMeters: (distance * 1000).toFixed(0)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
