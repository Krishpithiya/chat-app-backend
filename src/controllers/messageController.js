const Message = require('../models/Message');
const Chat = require('../models/Chat');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const { assertMember } = require('../services/chatAccessService');
// Required lazily-accessed (not destructured) to avoid a circular-require
// timing issue: socket/index.js -> handlers -> this controller -> socket/index.js.
const socketModule = require('../socket');

const MAX_MESSAGE_LENGTH = 4000;

function messageToJSON(msg, currentUserId) {
  const deletedForEveryone = msg.deletedForEveryone;
  const hiddenForMe = msg.deletedFor?.some((id) => id.toString() === currentUserId.toString());

  return {
    id: msg._id,
    chatId: msg.chatId,
    senderId: msg.senderId?._id || msg.senderId,
    sender: msg.senderId?.toPublicJSON ? msg.senderId.toPublicJSON() : undefined,
    type: msg.type,
    text: deletedForEveryone ? null : hiddenForMe ? null : msg.text,
    deletedForEveryone,
    hiddenForMe: !!hiddenForMe,
    deliveredTo: msg.deliveredTo,
    readBy: msg.readBy,
    replyTo: msg.replyTo && msg.replyTo._id
      ? {
          id: msg.replyTo._id,
          text: msg.replyTo.deletedForEveryone ? null : msg.replyTo.text,
          senderId: msg.replyTo.senderId,
          deletedForEveryone: msg.replyTo.deletedForEveryone,
        }
      : msg.replyTo || null,
    editedAt: msg.editedAt,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
  };
}

// GET /api/chats/:chatId/messages?before=<messageId>&limit=30
const getMessages = asyncHandler(async (req, res) => {
  await assertMember(req.params.chatId, req.user._id);

  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  const before = req.query.before;

  const query = { chatId: req.params.chatId };
  if (before) {
    query._id = { $lt: before };
  }

  const messages = await Message.find(query)
    .sort({ _id: -1 })
    .limit(limit)
    .populate('senderId', 'name username profileImage')
    .populate('replyTo', 'text senderId deletedForEveryone');

  const ordered = messages.reverse(); // oldest -> newest for rendering
  const hasMore = messages.length === limit;

  sendSuccess(
    res,
    200,
    { messages: ordered.map((m) => messageToJSON(m, req.user._id)) },
    { hasMore, nextCursor: hasMore ? ordered[0].id : null }
  );
});

// POST /api/chats/:chatId/messages  { text, replyTo? }
const sendMessage = asyncHandler(async (req, res) => {
  const chat = await assertMember(req.params.chatId, req.user._id);

  let { text, replyTo } = req.body;
  if (typeof text !== 'string') throw new ApiError(400, 'text is required');
  text = text.trim();
  if (!text) throw new ApiError(400, 'Message cannot be empty');
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new ApiError(400, `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`);
  }

  if (replyTo) {
    const original = await Message.findOne({ _id: replyTo, chatId: chat._id });
    if (!original) throw new ApiError(400, 'The message you are replying to was not found in this chat');
  }

  // senderId always comes from the authenticated user, never the client body.
  let message = await Message.create({
    chatId: chat._id,
    senderId: req.user._id,
    text,
    replyTo: replyTo || null,
    deliveredTo: [req.user._id],
    readBy: [req.user._id],
  });

  chat.lastMessage = message._id;

  // Increment unread counters for every member except the sender.
  chat.members.forEach((memberId) => {
    const key = memberId.toString();
    if (key === req.user._id.toString()) return;
    const current = chat.unreadCounts.get(key) || 0;
    chat.unreadCounts.set(key, current + 1);
  });
  await chat.save();

  message = await message.populate('senderId', 'name username profileImage');
  message = await message.populate('replyTo', 'text senderId deletedForEveryone');

  const payload = messageToJSON(message, req.user._id);
  socketModule.emitToChat(chat._id, 'message:new', { chatId: chat._id, message: payload });

  sendSuccess(res, 201, { message: payload });
});

// PATCH /api/messages/:messageId  { text }
const editMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.messageId);
  if (!message) throw new ApiError(404, 'Message not found');

  if (message.senderId.toString() !== req.user._id.toString()) {
    throw new ApiError(403, 'You can only edit your own messages');
  }
  if (message.deletedForEveryone) {
    throw new ApiError(400, 'Cannot edit a deleted message');
  }

  let { text } = req.body;
  if (typeof text !== 'string' || !text.trim()) {
    throw new ApiError(400, 'text is required');
  }
  text = text.trim();
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new ApiError(400, `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`);
  }

  message.text = text;
  message.editedAt = new Date();
  await message.save();

  const populated = await message.populate('senderId', 'name username profileImage');
  const payload = messageToJSON(populated, req.user._id);

  socketModule.emitToChat(message.chatId, 'message:edited', { chatId: message.chatId, message: payload });

  sendSuccess(res, 200, { message: payload });
});

// DELETE /api/messages/:messageId?scope=me|everyone
const deleteMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.messageId);
  if (!message) throw new ApiError(404, 'Message not found');

  const scope = req.query.scope === 'everyone' ? 'everyone' : 'me';
  const isOwner = message.senderId.toString() === req.user._id.toString();

  // Membership check: only chat members may act on the message at all.
  await assertMember(message.chatId, req.user._id);

  if (scope === 'everyone') {
    if (!isOwner) {
      throw new ApiError(403, 'You can only delete your own messages for everyone');
    }
    message.deletedForEveryone = true;
    message.text = '';
    await message.save();
    socketModule.emitToChat(message.chatId, 'message:deleted', {
      chatId: message.chatId,
      messageId: message._id,
      scope: 'everyone',
    });
  } else {
    if (!message.deletedFor.some((id) => id.toString() === req.user._id.toString())) {
      message.deletedFor.push(req.user._id);
      await message.save();
    }
    // "Delete for me" is per-user and does not need to be broadcast to others.
  }

  sendSuccess(res, 200, { messageId: message._id, scope });
});

module.exports = { getMessages, sendMessage, editMessage, deleteMessage, messageToJSON };
