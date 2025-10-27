import express from 'express';
import multer from 'multer';
import path from 'path';
import User from '../models/User.js';
import WasteReport from '../models/WasteReport.js';
import { TrainingProgress } from '../models/Training.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// ✅ Memory storage for Vercel (read-only filesystem)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed'));
    }
  }
});

// ✅ Safe JSON parser
const safeParse = (data) => {
  if (!data) return {};
  try {
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (error) {
    console.warn('JSON parse error:', error.message);
    return {};
  }
};

// 🔹 GET /api/users/profile - Get user profile with statistics
router.get('/profile', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -refreshToken');
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Fetch user statistics in parallel
    const [reportCount, completedTraining] = await Promise.all([
      WasteReport.countDocuments({ reporter: user._id }),
      TrainingProgress.countDocuments({ 
        user: user._id, 
        'trainingData.isCompleted': true 
      })
    ]);

    const userObject = user.toObject();

    res.json({
      success: true,
      data: {
        user: {
          ...userObject,
          statistics: {
            reportsSubmitted: reportCount,
            trainingCompleted: completedTraining
          }
        }
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 🔹 PUT /api/users/profile - Update user profile
router.put('/profile', authenticate, upload.single('avatar'), async (req, res) => {
  try {
    const { name, phone, address, profile, preferences } = req.body;
    
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    // Update basic fields
    if (name && name.trim()) user.name = name.trim();
    if (phone && phone.trim()) user.phone = phone.trim();
    
    // Update nested objects safely
    if (address) {
      const parsedAddress = safeParse(address);
      user.address = { ...(user.address || {}), ...parsedAddress };
    }
    
    if (profile) {
      const parsedProfile = safeParse(profile);
      user.profile = { ...(user.profile || {}), ...parsedProfile };
    }
    
    if (preferences) {
      const parsedPreferences = safeParse(preferences);
      user.preferences = { ...(user.preferences || {}), ...parsedPreferences };
    }

    // Handle avatar upload
    if (req.file) {
      try {
        // Convert to base64 data URL
        const base64Image = req.file.buffer.toString('base64');
        const dataUrl = `data:${req.file.mimetype};base64,${base64Image}`;
        
        // Ensure profile object exists
        if (!user.profile) {
          user.profile = {};
        }
        
        user.profile.avatar = dataUrl;
        
        // TODO: For production, use cloud storage instead:
        // 
        // Option 1: Vercel Blob Storage
        // const { put } = await import('@vercel/blob');
        // const blob = await put(`avatars/${user._id}.${file.mimetype.split('/')[1]}`, req.file.buffer, {
        //   access: 'public',
        // });
        // user.profile.avatar = blob.url;
        //
        // Option 2: Cloudinary
        // const cloudinary = require('cloudinary').v2;
        // const result = await cloudinary.uploader.upload(dataUrl, {
        //   folder: 'avatars',
        //   public_id: user._id,
        // });
        // user.profile.avatar = result.secure_url;
        //
        // Option 3: AWS S3
        // const s3 = new AWS.S3();
        // const params = {
        //   Bucket: process.env.S3_BUCKET,
        //   Key: `avatars/${user._id}`,
        //   Body: req.file.buffer,
        //   ContentType: req.file.mimetype,
        // };
        // const result = await s3.upload(params).promise();
        // user.profile.avatar = result.Location;
        
      } catch (uploadError) {
        console.error('Avatar upload error:', uploadError);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to process avatar image' 
        });
      }
    }

    // Save updated user
    await user.save();
    
    // Prepare response without sensitive data
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
    
    // Handle Mongoose validation errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 🔹 GET /api/users/leaderboard - Get top users by points
router.get('/leaderboard', authenticate, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const parsedLimit = Math.min(parseInt(limit) || 10, 100); // Max 100

    // Fetch top users
    const leaderboard = await User.find({ isActive: true })
      .select('name rewards.totalEarned rewards.level profile.avatar')
      .sort({ 'rewards.totalEarned': -1 })
      .limit(parsedLimit)
      .lean(); // Use lean() for better performance

    // Calculate current user's rank
    const userRank = await User.countDocuments({
      isActive: true,
      'rewards.totalEarned': { $gt: req.user.rewards?.totalEarned || 0 }
    }) + 1;

    res.json({
      success: true,
      data: {
        leaderboard: leaderboard.map((user, index) => ({
          rank: index + 1,
          name: user.name,
          avatar: user.profile?.avatar || null,
          points: user.rewards?.totalEarned || 0,
          level: user.rewards?.level || 1
        })),
        currentUser: {
          rank: userRank,
          points: req.user.rewards?.totalEarned || 0,
          level: req.user.rewards?.level || 1
        }
      }
    });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 🔹 DELETE /api/users/profile/avatar - Remove avatar
router.delete('/profile/avatar', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    if (user.profile && user.profile.avatar) {
      user.profile.avatar = null;
      await user.save();
    }

    res.json({
      success: true,
      message: 'Avatar removed successfully'
    });
  } catch (error) {
    console.error('Delete avatar error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to remove avatar' 
    });
  }
});

export default router;