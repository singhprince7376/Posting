const express = require('express');
const app = express();
const path = require('path');
const bcrypt = require('bcrypt');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const mongoose = require('mongoose');
mongoose.set('debug', true);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mydatabase', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
}).catch((error) => {
  console.error('Error connecting to MongoDB:', error);
});

const fs = require('fs');

const User = require('./models/user');
const Post = require('./models/post');
const Notification = require('./models/notification');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.set('view engine', 'ejs');

// Middleware to set user and newNotificationCount for all views
app.use(async (req, res, next) => {
    res.locals.user = null;
    res.locals.newNotificationCount = 0;
    res.locals.currentPage = '';
    try {
        const token = req.cookies.authToken;
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.userId);
            if (user) {
                res.locals.user = user;
                const newNotifications = await Notification.countDocuments({ user: user._id, read: false });
                res.locals.newNotificationCount = newNotifications;
            }
        }
    } catch (e) {
        // Ignore errors
    }
    next();
});


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
      cb(null, path.join(__dirname, 'public', 'image'));
  },
  filename: (req, file, cb) => {
      const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
      cb(null, uniqueName);
  }
});

const upload = multer({ storage });

const authenticateUser = async (req, res, next) => {
    try {
        const token = req.cookies.authToken;
        if (!token) return res.redirect('/login');

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.userId);

        if (!req.user) return res.redirect('/login');
        next();
    } catch (error) {
        return res.redirect('/login');
    }
};

app.get('/', (req, res) => res.render('ragistration'));
app.get('/login', (req, res) => res.render('login'));

app.post('/register', async (req, res) => {
    try {
        let { name, email, password, age } = req.body;
        let existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).send({ message: "User already exists." });

        let hashedPassword = await bcrypt.hash(password, 10);
        let newUser = await User.create({ name, email, password: hashedPassword, age });
        const token = jwt.sign({ userId: newUser._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.cookie("authToken", token, { httpOnly: true });
        res.redirect('/profile');
    } catch (error) {
        res.status(500).send({ message: "Error registering user", error });
    }
});

app.post('/login', async (req, res) => {
    try {
        let { email, password } = req.body;
        let user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).send("Invalid email or password.");
        }
        let token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET);
        res.cookie("authToken", token, { httpOnly: true });
        res.redirect('/profile');
    } catch (error) {
        res.status(500).send("Error logging in.");
    }
});

app.post('/updateProfilePic', authenticateUser, upload.single('profilePic'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send({ message: "No file uploaded" });
        req.user.profilePic = "/image/" + req.file.filename;
        await req.user.save();
        res.redirect('/profile');
    } catch (error) {
        res.status(500).send({ message: "Error updating profile picture", error });
    }
});

app.get('/all-posts', async (req, res) => {
  try {
      const posts = await Post.find().populate('user', 'name profilePic').populate('comments.user', 'name').sort({ createdAt: -1 });
      // ✅ Populating 'user' instead of 'userId' and comments.user
      let user = null;
      try {
          const token = req.cookies.authToken;
          if (token) {
              const decoded = jwt.verify(token, process.env.JWT_SECRET);
              user = await User.findById(decoded.userId);
          }
      } catch (e) {}
      res.locals.currentPage = 'all-posts';
      res.render('allPosts', { posts, user });
  } catch (error) {
      res.status(500).send({ message: "Error fetching all posts", error });
  }
});

app.get('/profile', authenticateUser, async (req, res) => {
    try {
        const userPosts = await Post.find({ user: req.user._id }).populate('comments.user', 'name').sort({ createdAt: -1 });
        res.render('profile', { user: req.user, posts: userPosts || [], currentPage: 'profile' });
    } catch (error) {
        res.status(500).send({ message: "Error fetching posts", error });
    }
});

app.post('/post', authenticateUser, upload.single('image'), async (req, res) => {
    try {
        const { title, content } = req.body;
        if (!title || !content) return res.status(400).send({ message: "Title and content are required." });
        const image = req.file ? "/image/" + req.file.filename : null;
        const post = await Post.create({ user: req.user._id, title, content, image });

        // Notify followers
        const followers = await User.find({ _id: { $in: req.user.followers } });
        for (const follower of followers) {
            await Notification.create({
                user: follower._id,
                type: 'post',
                fromUser: req.user._id,
                post: post._id
            });
        }

        res.redirect('/profile');
    } catch (error) {
        res.status(500).send({ message: "Error creating post", error });
    }
});

app.post('/post/:id/like', authenticateUser, async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).send({ message: "Post not found" });

        const userId = req.user._id.toString();
        const likeIndex = post.likes.indexOf(userId);
        if (likeIndex > -1) {
            post.likes.splice(likeIndex, 1);
        } else {
            post.likes.push(userId);
            // Create notification for post owner if not liking own post
            if (post.user.toString() !== req.user._id.toString()) {
                await Notification.create({
                    user: post.user,
                    type: 'like',
                    fromUser: req.user._id,
                    post: post._id
                });
            }
        }
        await post.save();
        res.redirect('/all-posts');
    } catch (error) {
        res.status(500).send({ message: "Error liking post", error });
    }
});

app.post('/post/:id/comment', authenticateUser, async (req, res) => {
    try {
        const { content } = req.body;
        if (!content) return res.status(400).send({ message: "Comment content is required." });

        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).send({ message: "Post not found" });

        post.comments.push({ user: req.user._id, content });
        await post.save();

        // Create notification for post owner if not commenting on own post
        if (post.user.toString() !== req.user._id.toString()) {
            await Notification.create({
                user: post.user,
                type: 'comment',
                fromUser: req.user._id,
                post: post._id
            });
        }

        res.redirect('/all-posts');
    } catch (error) {
        res.status(500).send({ message: "Error adding comment", error });
    }
});

app.post('/post/:id/edit', authenticateUser, async (req, res) => {
    try {
        const { title, content } = req.body;
        if (!title || !content) return res.status(400).send({ message: "Title and content are required." });

        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).send({ message: "Post not found" });
        if (post.user.toString() !== req.user._id.toString()) return res.status(403).send({ message: "Not authorized" });

        post.title = title;
        post.content = content;
        await post.save();
        res.redirect('/profile');
    } catch (error) {
        res.status(500).send({ message: "Error updating post", error });
    }
});

app.post('/post/:id/delete', authenticateUser, async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).send({ message: "Post not found" });
        if (post.user.toString() !== req.user._id.toString()) return res.status(403).send({ message: "Not authorized" });

        await Post.findByIdAndDelete(req.params.id);
        res.redirect('/profile');
    } catch (error) {
        res.status(500).send({ message: "Error deleting post", error });
    }
});


app.post('/post/:postId/comment/:commentId/like', authenticateUser, async (req, res) => {
    try {
        const post = await Post.findById(req.params.postId);
        if (!post) return res.status(404).send({ message: "Post not found." });
        const comment = post.comments.id(req.params.commentId);
        if (!comment) return res.status(404).send({ message: "Comment not found." });
        const userId = req.user._id;
        const likeIndex = comment.likes.indexOf(userId);
        if (likeIndex > -1) {
            comment.likes.splice(likeIndex, 1);
        } else {
            comment.likes.push(userId);
        }
        await post.save();
        res.redirect('back');
    } catch (error) {
        res.status(500).send({ message: "Error toggling like", error });
    }
});

app.post('/post/:postId/comment/:commentId/delete', authenticateUser, async (req, res) => {
    try {
        const post = await Post.findById(req.params.postId);
        if (!post) return res.status(404).send({ message: "Post not found." });
        const comment = post.comments.id(req.params.commentId);
        if (!comment) return res.status(404).send({ message: "Comment not found." });
        if (post.user.toString() !== req.user._id.toString() && comment.user.toString() !== req.user._id.toString()) {
            return res.status(403).send({ message: "Unauthorized." });
        }
        post.comments.pull(req.params.commentId);
        await post.save();
        res.redirect('back');
    } catch (error) {
        res.status(500).send({ message: "Error deleting comment", error });
    }
});




app.get('/logout', (req, res) => {
    res.clearCookie("authToken");
    res.redirect('/login');
});

// Search users by name
app.get('/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) {
            return res.redirect('/all-posts');
        }
        const users = await User.find({ name: { $regex: query, $options: 'i' } });
        res.render('searchResults', { users, query });
    } catch (error) {
        res.status(500).send({ message: "Error searching users", error });
    }
});

// View user profile by id
app.get('/user/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).send("User not found");
        const posts = await Post.find({ user: user._id }).populate('comments.user', 'name').sort({ createdAt: -1 });
        let currentUser = null;
        try {
            const token = req.cookies.authToken;
            if (token) {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                currentUser = await User.findById(decoded.userId);
            }
        } catch (e) {}
        const isFollowing = currentUser && currentUser.following.includes(user._id);
        res.render('userProfile', { user, posts, currentUser, isFollowing, currentPage: 'userProfile' });
    } catch (error) {
        res.status(500).send({ message: "Error fetching user profile", error });
    }
});

// Follow/Unfollow user
app.post('/user/:id/follow', authenticateUser, async (req, res) => {
    try {
        const userToFollow = await User.findById(req.params.id);
        if (!userToFollow) return res.status(404).send({ message: "User not found" });
        if (userToFollow._id.toString() === req.user._id.toString()) return res.status(400).send({ message: "Cannot follow yourself" });

        const isFollowing = req.user.following.includes(userToFollow._id);
        if (isFollowing) {
            req.user.following.pull(userToFollow._id);
            userToFollow.followers.pull(req.user._id);
        } else {
            req.user.following.push(userToFollow._id);
            userToFollow.followers.push(req.user._id);
            // Create notification
            await Notification.create({
                user: userToFollow._id,
                type: 'follow',
                fromUser: req.user._id
            });
        }
        await req.user.save();
        await userToFollow.save();
        res.redirect(`/user/${req.params.id}`);
    } catch (error) {
        res.status(500).send({ message: "Error following user", error });
    }
});

// View followers
app.get('/user/:id/followers', async (req, res) => {
    try {
        const user = await User.findById(req.params.id).populate('followers', 'name profilePic');
        if (!user) return res.status(404).send("User not found");
        let currentUser = null;
        try {
            const token = req.cookies.authToken;
            if (token) {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                currentUser = await User.findById(decoded.userId);
            }
        } catch (e) {}
        res.render('followers', { user, followers: user.followers, currentUser });
    } catch (error) {
        res.status(500).send({ message: "Error fetching followers", error });
    }
});

// View notifications
app.get('/notifications', authenticateUser, async (req, res) => {
    try {
        const notifications = await Notification.find({ user: req.user._id })
            .populate('fromUser', 'name profilePic')
            .populate('post', 'title')
            .sort({ createdAt: -1 });
        // Mark all notifications as read
        await Notification.updateMany({ user: req.user._id, read: false }, { read: true });
        // Update the count in locals
        res.locals.newNotificationCount = 0;
        res.render('notifications', { notifications });
    } catch (error) {
        res.status(500).send({ message: "Error fetching notifications", error });
    }
});

app.post('/notifications/clear', authenticateUser, async (req, res) => {
    try {
        await Notification.deleteMany({ user: req.user._id });
        res.redirect('/notifications');
    } catch (error) {
        res.status(500).send({ message: "Error clearing notifications", error });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
