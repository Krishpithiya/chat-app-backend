const { Server } = require('socket.io');
const env = require('../config/env');
const socketAuthMiddleware = require('./socketAuth');
const registerMessageHandlers = require('./handlers/messageHandlers');
const registerTypingHandlers = require('./handlers/typingHandlers');
const registerPresenceHandlers = require('./handlers/presenceHandlers');
const { userRoom, chatRoom } = require('./rooms');

let ioInstance = null;

function initSocket(httpServer) {
  const allowedOrigins = (env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((url) => url.trim().replace(/\/$/, ''));

  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const cleanOrigin = origin.replace(/\/$/, '');
        if (
          allowedOrigins.includes(cleanOrigin) ||
          allowedOrigins.includes('*') ||
          env.NODE_ENV !== 'production'
        ) {
          return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    },
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    console.log(`[socket] connected: user=${socket.userId} socket=${socket.id}`);

    registerPresenceHandlers(io, socket);
    registerMessageHandlers(io, socket);
    registerTypingHandlers(io, socket);

    socket.on('disconnect', (reason) => {
      console.log(`[socket] disconnected: user=${socket.userId} reason=${reason}`);
    });
  });

  ioInstance = io;
  return io;
}

function getIO() {
  if (!ioInstance) {
    throw new Error('Socket.IO has not been initialized yet');
  }
  return ioInstance;
}

// Helpers used by REST controllers to push real-time updates without
// needing to know about Socket.IO internals directly.
function emitToChat(chatId, event, payload) {
  if (!ioInstance) return;
  ioInstance.to(chatRoom(chatId)).emit(event, payload);
}

function emitToUser(userId, event, payload) {
  if (!ioInstance) return;
  ioInstance.to(userRoom(userId)).emit(event, payload);
}

module.exports = { initSocket, getIO, emitToChat, emitToUser };
