const bcrypt = require('bcryptjs');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const { signToken, setAuthCookie, clearAuthCookie } = require('../services/tokenService');

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const USERNAME_RE = /^[a-z0-9_.]{3,30}$/;

const register = asyncHandler(async (req, res) => {
  const { name, username, email, password } = req.body;

  if (!name || !username || !email || !password) {
    throw new ApiError(400, 'Name, username, email and password are all required');
  }
  if (password.length < 6) {
    throw new ApiError(400, 'Password must be at least 6 characters long');
  }
  const normalizedUsername = String(username).trim().toLowerCase();
  const normalizedEmail = String(email).trim().toLowerCase();

  if (!USERNAME_RE.test(normalizedUsername)) {
    throw new ApiError(400, 'Username must be 3-30 characters: letters, numbers, dots, underscores');
  }
  if (!EMAIL_RE.test(normalizedEmail)) {
    throw new ApiError(400, 'Invalid email address');
  }

  const existing = await User.findOne({
    $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
  });
  if (existing) {
    if (existing.email === normalizedEmail) throw new ApiError(409, 'Email is already registered');
    throw new ApiError(409, 'Username is already taken');
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await User.create({
    name: String(name).trim(),
    username: normalizedUsername,
    email: normalizedEmail,
    passwordHash,
  });

  const token = signToken(user._id);
  setAuthCookie(res, token);

  sendSuccess(res, 201, { user: user.toSafeJSON(), token });
});

const login = asyncHandler(async (req, res) => {
  const { emailOrUsername, password } = req.body;
  if (!emailOrUsername || !password) {
    throw new ApiError(400, 'emailOrUsername and password are required');
  }

  const identifier = String(emailOrUsername).trim().toLowerCase();
  const user = await User.findOne({
    $or: [{ email: identifier }, { username: identifier }],
  }).select('+passwordHash');

  if (!user) {
    throw new ApiError(401, 'Invalid credentials');
  }

  const valid = await user.comparePassword(password);
  if (!valid) {
    throw new ApiError(401, 'Invalid credentials');
  }

  user.isOnline = true;
  await user.save();

  const token = signToken(user._id);
  setAuthCookie(res, token);

  sendSuccess(res, 200, { user: user.toSafeJSON(), token });
});

const logout = asyncHandler(async (req, res) => {
  if (req.user) {
    req.user.isOnline = false;
    req.user.lastSeen = new Date();
    await req.user.save();
  }
  clearAuthCookie(res);
  sendSuccess(res, 200, { message: 'Logged out' });
});

const getMe = asyncHandler(async (req, res) => {
  sendSuccess(res, 200, { user: req.user.toSafeJSON() });
});

module.exports = { register, login, logout, getMe };
