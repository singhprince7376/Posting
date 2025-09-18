const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // The user who receives the notification
    type: { type: String, enum: ['like', 'comment', 'follow', 'post'], required: true },
    fromUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // The user who triggered the notification
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' }, // Optional, related post
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', notificationSchema);
