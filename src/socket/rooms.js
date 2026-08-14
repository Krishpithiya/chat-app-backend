function chatRoom(chatId) {
  return `chat:${chatId}`;
}

function userRoom(userId) {
  return `user:${userId}`;
}

module.exports = { chatRoom, userRoom };
