import express from 'express';
import multer from 'multer';
import path from 'path';
import User from '../models/User.js';
import WasteReport from '../models/WasteReport.js';
import { TrainingProgress } from '../models/Training.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Memory storage ONLY - no disk operations
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

const safeParse = (data) => {
  if (!data) return {};
  try {
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    return {};
  }
};

router.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -refreshToken');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const [reportCount, completedTraining] = await Promise.all([
      WasteReport.countDocuments({ reporter: user._id }),
      TrainingProgress.countDocuments({ user: user._id, 'trainingData.isCompleted': true })
    ]);

    res.json({
      success: true,
      data: {
        user: {
          ...user.toObject(),
          statistics: {
            reportsSubmitted: reportCount,
            trainingCompleted: completedTraining
          }
        }
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
});

router.put('/profile', authenticate, upload.single('avatar'), async (req, res) => {
  try {
    const { name, phone, address, profile, preferences } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (name) user.name = name;
    if (phone) user.phone = phone;
    if (address) user.address = { ...user.address, ...safeParse(address) };
    if (profile) user.profile = { ...user.profile, ...safeParse(profile) };
    if (preferences) user.preferences = { ...user.preferences, ...safeParse(preferences) };

    if (req.file) {
      const base64Image = req.file.buffer.toString('base64');
      const dataUrl = `data:${req.file.mimetype};base64,${base64Image}`;
      if (!user.profile) user.profile = {};
      user.profile.avatar = dataUrl;
    }

    await user.save();
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.refreshToken;

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: userResponse }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
});

router.get('/leaderboard', authenticate, async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const leaderboard = await User.find({ isActive: true })
      .select('name rewards.totalEarned rewards.level')
      .sort({ 'rewards.totalEarned': -1 })
      .limit(parseInt(limit));

    const userRank = await User.countDocuments({
      isActive: true,
      'rewards.totalEarned': { $gt: req.user.rewards?.totalEarned || 0 }
    }) + 1;

    res.json({
      success: true,
      data: {
        leaderboard: leaderboard.map((u, index) => ({
          rank: index + 1,
          name: u.name,
          points: u.rewards?.totalEarned || 0,
          level: u.rewards?.level || 1
        })),
        userRank,
        userPoints: req.user.rewards?.totalEarned || 0
      }
    });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch leaderboard' });
  }
});

export default router;