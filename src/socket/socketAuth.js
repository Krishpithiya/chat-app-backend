const cookie = require('cookie');
const { verifyToken } = require('../services/tokenService');
const User = require('../models/User');
const env = require('../config/env');

// Socket.IO middleware: authenticates the connecting socket using the same
// JWT used by the REST API (read from the http-only cookie, or an auth token
// passed explicitly by the client as a fallback).
async function socketAuthMiddleware(socket, next) {
  try {
    let token = socket.handshake.auth?.token;

    if (!token && socket.handshake.headers.cookie) {
      const cookies = cookie.parse(socket.handshake.headers.cookie);
      token = cookies[env.COOKIE_NAME];
    }

    if (!token) {
      return next(new Error('Authentication required'));
    }

    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);
    if (!user) {
      return next(new Error('User no longer exists'));
    }

    socket.userId = user._id.toString();
    socket.user = user;
    next();
  } catch (err) {
    next(new Error('Authentication failed'));
  }
}

module.exports = socketAuthMiddleware;
