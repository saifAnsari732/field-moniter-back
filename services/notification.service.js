const { Notification } = require('../models/index');

/**
 * Creates a notification in MongoDB and emits it in real-time over WebSockets
 * @param {object} io - Socket.io server instance
 * @param {object} details - { recipient, sender, type, title, message, data }
 */
const sendNotification = async (io, { recipient, sender, type, title, message, data }) => {
  try {
    const notification = await Notification.create({
      recipient,
      sender,
      type,
      title,
      message,
      data,
    });

    if (io) {
      console.log(`📡 Emitting real-time notification to user_${recipient}: "${title}"`);
      io.to(`user_${recipient}`).emit('notification', notification);
    } else {
      console.log(`⚠️ Notification created but Socket.io instance was not passed for user_${recipient}`);
    }
    
    return notification;
  } catch (err) {
    console.error('❌ Error in sendNotification service:', err);
    throw err;
  }
};

module.exports = { sendNotification };
