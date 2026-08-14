const { assertMember } = require('../../services/chatAccessService');
const { chatRoom } = require('../rooms');

// Typing state is intentionally NOT persisted to MongoDB - it is purely
// transient and broadcast directly between connected sockets.
module.exports = function registerTypingHandlers(io, socket) {
  socket.on('typing:start', async ({ chatId }) => {
    try {
      await assertMember(chatId, socket.userId);
      socket.to(chatRoom(chatId)).emit('typing:start', {
        chatId,
        userId: socket.userId,
      });
    } catch (err) {
      // ignore - non-members simply can't broadcast typing state
    }
  });

  socket.on('typing:stop', async ({ chatId }) => {
    try {
      await assertMember(chatId, socket.userId);
      socket.to(chatRoom(chatId)).emit('typing:stop', {
        chatId,
        userId: socket.userId,
      });
    } catch (err) {
      // ignore
    }
  });
};
