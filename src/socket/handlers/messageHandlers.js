const Message = require('../../models/Message');
const Chat = require('../../models/Chat');
const { assertMember } = require('../../services/chatAccessService');
const { chatRoom } = require('../rooms');

module.exports = function registerMessageHandlers(io, socket) {
  // A malicious user must not be able to join another person's chat by
  // guessing a chatId - membership is verified against the database on
  // every join request, using the authenticated socket.userId.
  socket.on('chat:join', async ({ chatId }, callback) => {
    try {
      if (!chatId) return callback?.({ success: false, message: 'chatId is required' });
      await assertMember(chatId, socket.userId);
      socket.join(chatRoom(chatId));
      callback?.({ success: true });
    } catch (err) {
      callback?.({ success: false, message: err.message || 'Unable to join chat' });
    }
  });

  socket.on('chat:leave', ({ chatId }) => {
    if (chatId) socket.leave(chatRoom(chatId));
  });

  // Delivery acknowledgement: client confirms a message reached its device.
  socket.on('message:delivered', async ({ chatId, messageId }) => {
    try {
      await assertMember(chatId, socket.userId);
      const message = await Message.findOne({ _id: messageId, chatId });
      if (!message) return;
      if (!message.deliveredTo.some((id) => id.toString() === socket.userId)) {
        message.deliveredTo.push(socket.userId);
        await message.save();
        io.to(chatRoom(chatId)).emit('message:delivered', {
          chatId,
          messageId,
          userId: socket.userId,
        });
      }
    } catch (err) {
      // Silently ignore - delivery receipts are best-effort.
    }
  });

  // Read receipt for a single message (used while a chat is open and new
  // messages stream in). Bulk "mark all as read" happens via the REST route.
  socket.on('message:read', async ({ chatId, messageId }) => {
    try {
      await assertMember(chatId, socket.userId);
      const message = await Message.findOne({ _id: messageId, chatId });
      if (!message) return;
      if (!message.readBy.some((id) => id.toString() === socket.userId)) {
        message.readBy.push(socket.userId);
        if (!message.deliveredTo.some((id) => id.toString() === socket.userId)) {
          message.deliveredTo.push(socket.userId);
        }
        await message.save();

        const chat = await Chat.findById(chatId);
        if (chat) {
          chat.unreadCounts.set(socket.userId, 0);
          await chat.save();
        }

        io.to(chatRoom(chatId)).emit('message:read', {
          chatId,
          messageId,
          userId: socket.userId,
        });
      }
    } catch (err) {
      // best-effort
    }
  });
};

