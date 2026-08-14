const User = require('../../models/User');
const Chat = require('../../models/Chat');
const { userRoom, chatRoom } = require('../rooms');

// Tracks how many active sockets/tabs each user currently has open, so that
// closing one tab does not mark the user offline while another tab is
// still connected.
const activeConnectionsByUser = new Map();

async function broadcastPresenceToContacts(io, userId, isOnline, lastSeen) {
  // Notify every chat this user is a member of (rooms already scope this
  // to people who should legitimately see the user's presence).
  const chats = await Chat.find({ members: userId }).select('_id');
  chats.forEach((chat) => {
    io.to(chatRoom(chat._id)).emit('presence:update', { userId, isOnline, lastSeen });
  });
}

module.exports = function registerPresenceHandlers(io, socket) {
  socket.join(userRoom(socket.userId));

  const count = (activeConnectionsByUser.get(socket.userId) || 0) + 1;
  activeConnectionsByUser.set(socket.userId, count);

  if (count === 1) {
    User.findByIdAndUpdate(socket.userId, { isOnline: true }).then(() => {
      broadcastPresenceToContacts(io, socket.userId, true, null);
    });
  }

  socket.on('disconnect', async () => {
    const remaining = (activeConnectionsByUser.get(socket.userId) || 1) - 1;

    if (remaining <= 0) {
      activeConnectionsByUser.delete(socket.userId);
      const lastSeen = new Date();
      await User.findByIdAndUpdate(socket.userId, { isOnline: false, lastSeen });
      await broadcastPresenceToContacts(io, socket.userId, false, lastSeen);
    } else {
      activeConnectionsByUser.set(socket.userId, remaining);
    }
  });
};
