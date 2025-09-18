const { name } = require('ejs');
const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  age: { type: Number, required: true },
  password: { type: String, required: true },
  profilePic: { type: String, default: "/image/default.png" }, // Just store filename
  posts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Post' }], // Correct field name
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

const User = mongoose.model('User', userSchema);  
module.exports = User;