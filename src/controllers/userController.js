const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');

// GET /api/users/search?q=john
const searchUsers = asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    return sendSuccess(res, 200, { users: [] });
  }
  if (q.length > 60) {
    throw new ApiError(400, 'Search query too long');
  }

  const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const users = await User.find({
    _id: { $ne: req.user._id },
    $or: [{ username: regex }, { name: regex }],
  })
    .limit(20)
    .select('name username profileImage isOnline lastSeen');

  sendSuccess(res, 200, { users: users.map((u) => u.toPublicJSON()) });
});

// GET /api/users/:userId
const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }
  sendSuccess(res, 200, { user: user.toPublicJSON() });
});

// POST /api/users/:userId/block
const blockUser = asyncHandler(async (req, res) => {
  const targetId = req.params.userId;
  if (targetId === req.user._id.toString()) {
    throw new ApiError(400, 'You cannot block yourself');
  }
  const target = await User.findById(targetId);
  if (!target) {
    throw new ApiError(404, 'User not found');
  }

  if (!req.user.blockedUsers.some((id) => id.toString() === targetId)) {
    req.user.blockedUsers.push(targetId);
    await req.user.save();
  }

  sendSuccess(res, 200, { blockedUsers: req.user.blockedUsers });
});

// DELETE /api/users/:userId/block
const unblockUser = asyncHandler(async (req, res) => {
  const targetId = req.params.userId;
  req.user.blockedUsers = req.user.blockedUsers.filter((id) => id.toString() !== targetId);
  await req.user.save();
  sendSuccess(res, 200, { blockedUsers: req.user.blockedUsers });
});

// GET /api/users/me/blocked
const getBlockedUsers = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate(
    'blockedUsers',
    'name username profileImage'
  );
  sendSuccess(res, 200, { users: user.blockedUsers.map((u) => u.toPublicJSON()) });
});

module.exports = { searchUsers, getUserById, blockUser, unblockUser, getBlockedUsers };
