const Chat = require('../models/Chat');
const ApiError = require('../utils/ApiError');

// Central place for "is this user allowed to touch this chat" logic so that
// both REST controllers and Socket.IO handlers enforce identical rules.

async function getChatOrThrow(chatId) {
  const chat = await Chat.findById(chatId);
  if (!chat) {
    throw new ApiError(404, 'Chat not found');
  }
  return chat;
}

function isMember(chat, userId) {
  return chat.members.some((m) => m.toString() === userId.toString());
}

function isAdmin(chat, userId) {
  return chat.admins.some((a) => a.toString() === userId.toString());
}

async function assertMember(chatId, userId) {
  const chat = await getChatOrThrow(chatId);
  if (!isMember(chat, userId)) {
    throw new ApiError(403, 'You are not a member of this chat');
  }
  return chat;
}

async function assertAdmin(chatId, userId) {
  const chat = await assertMember(chatId, userId);
  if (chat.type !== 'group') {
    throw new ApiError(400, 'Only group chats support admin actions');
  }
  if (!isAdmin(chat, userId)) {
    throw new ApiError(403, 'Only group admins can perform this action');
  }
  return chat;
}

module.exports = {
  getChatOrThrow,
  isMember,
  isAdmin,
  assertMember,
  assertAdmin,
};
