const mongoose = require('mongoose');
const Chat = require('../models/Chat');
const User = require('../models/User');
const Message = require('../models/Message');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const { assertMember, assertAdmin, isMember, isAdmin } = require('../services/chatAccessService');
// Required lazily-accessed (not destructured) to avoid a circular-require
// timing issue: socket/index.js -> handlers -> controllers -> socket/index.js.
const socketModule = require('../socket');

function chatToJSON(chat, currentUserId) {
  const unread = chat.unreadCounts ? chat.unreadCounts.get(currentUserId.toString()) || 0 : 0;
  return {
    id: chat._id,
    type: chat.type,
    name: chat.name,
    image: chat.image,
    description: chat.description,
    createdBy: chat.createdBy,
    admins: chat.admins,
    members: chat.members.map((m) =>
      m.toPublicJSON ? m.toPublicJSON() : m
    ),
    lastMessage: chat.lastMessage || null,
    unreadCount: unread,
    updatedAt: chat.updatedAt,
    createdAt: chat.createdAt,
  };
}

// GET /api/chats - list all chats for current user, sorted by recent activity
const listChats = asyncHandler(async (req, res) => {
  const chats = await Chat.find({ members: req.user._id })
    .sort({ updatedAt: -1 })
    .populate('members', 'name username profileImage isOnline lastSeen')
    .populate({
      path: 'lastMessage',
      select: 'text senderId createdAt deletedForEveryone deletedFor type',
    });

  sendSuccess(res, 200, { chats: chats.map((c) => chatToJSON(c, req.user._id)) });
});

// POST /api/chats  { type: 'private', userId } OR { type: 'group', name, memberIds: [] }
const createChat = asyncHandler(async (req, res) => {
  const { type } = req.body;

  if (type === 'private') {
    const { userId } = req.body;
    if (!userId) throw new ApiError(400, 'userId is required for private chats');
    if (userId === req.user._id.toString()) {
      throw new ApiError(400, 'You cannot start a chat with yourself');
    }

    const otherUser = await User.findById(userId);
    if (!otherUser) throw new ApiError(404, 'User not found');

    if (
      otherUser.blockedUsers.some((id) => id.toString() === req.user._id.toString()) ||
      req.user.blockedUsers.some((id) => id.toString() === userId)
    ) {
      throw new ApiError(403, 'You cannot message this user');
    }

    // Enforce "only one private chat between the same two users"
    let chat = await Chat.findOne({
      type: 'private',
      members: { $all: [req.user._id, userId], $size: 2 },
    });

    if (!chat) {
      chat = await Chat.create({
        type: 'private',
        createdBy: req.user._id,
        members: [req.user._id, userId],
        admins: [],
      });
    }

    chat = await chat.populate('members', 'name username profileImage isOnline lastSeen');
    return sendSuccess(res, 201, { chat: chatToJSON(chat, req.user._id) });
  }

  if (type === 'group') {
    const { name, memberIds } = req.body;
    if (!name || !name.trim()) throw new ApiError(400, 'Group name is required');
    if (!Array.isArray(memberIds) || memberIds.length < 1) {
      throw new ApiError(400, 'At least one other member is required to create a group');
    }

    const uniqueMemberIds = [...new Set(memberIds.filter((id) => id !== req.user._id.toString()))];
    const users = await User.find({ _id: { $in: uniqueMemberIds } });
    if (users.length !== uniqueMemberIds.length) {
      throw new ApiError(400, 'One or more selected members do not exist');
    }

    const allMembers = [req.user._id.toString(), ...uniqueMemberIds];

    let chat = await Chat.create({
      type: 'group',
      name: name.trim(),
      createdBy: req.user._id,
      admins: [req.user._id],
      members: allMembers,
    });

    chat = await chat.populate('members', 'name username profileImage isOnline lastSeen');
    return sendSuccess(res, 201, { chat: chatToJSON(chat, req.user._id) });
  }

  throw new ApiError(400, "type must be 'private' or 'group'");
});

// GET /api/chats/:chatId
const getChat = asyncHandler(async (req, res) => {
  await assertMember(req.params.chatId, req.user._id);
  const chat = await Chat.findById(req.params.chatId)
    .populate('members', 'name username profileImage isOnline lastSeen')
    .populate('admins', 'name username')
    .populate({ path: 'lastMessage', select: 'text senderId createdAt deletedForEveryone type' });

  sendSuccess(res, 200, { chat: chatToJSON(chat, req.user._id) });
});

// PATCH /api/chats/:chatId  { name, description }  -- admin only, group only
const updateChat = asyncHandler(async (req, res) => {
  const chat = await assertAdmin(req.params.chatId, req.user._id);
  const { name, description } = req.body;

  if (name !== undefined) {
    if (!name.trim()) throw new ApiError(400, 'Group name cannot be empty');
    chat.name = name.trim();
  }
  if (description !== undefined) {
    chat.description = description.trim();
  }
  await chat.save();

  const populated = await chat.populate('members', 'name username profileImage isOnline lastSeen');
  socketModule.emitToChat(chat._id, 'chat:updated', { chatId: chat._id, name: chat.name, description: chat.description });

  sendSuccess(res, 200, { chat: chatToJSON(populated, req.user._id) });
});

// POST /api/chats/:chatId/members  { userId }  -- admin only
const addMember = asyncHandler(async (req, res) => {
  const chat = await assertAdmin(req.params.chatId, req.user._id);
  const { userId } = req.body;
  if (!userId) throw new ApiError(400, 'userId is required');

  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, 'User not found');

  if (isMember(chat, userId)) {
    throw new ApiError(409, 'User is already a member of this group');
  }

  chat.members.push(userId);
  await chat.save();

  const populated = await chat.populate('members', 'name username profileImage isOnline lastSeen');
  socketModule.emitToChat(chat._id, 'chat:updated', { chatId: chat._id, reason: 'member_added', userId });
  socketModule.emitToUser(userId, 'chat:updated', { chatId: chat._id, reason: 'added_to_group' });

  sendSuccess(res, 200, { chat: chatToJSON(populated, req.user._id) });
});

// DELETE /api/chats/:chatId/members/:userId  -- admin only
const removeMember = asyncHandler(async (req, res) => {
  const chat = await assertAdmin(req.params.chatId, req.user._id);
  const { userId } = req.params;

  if (!isMember(chat, userId)) {
    throw new ApiError(404, 'User is not a member of this group');
  }

  chat.members = chat.members.filter((m) => m.toString() !== userId);
  chat.admins = chat.admins.filter((a) => a.toString() !== userId);
  await chat.save();

  const populated = await chat.populate('members', 'name username profileImage isOnline lastSeen');
  socketModule.emitToChat(chat._id, 'chat:updated', { chatId: chat._id, reason: 'member_removed', userId });
  socketModule.emitToUser(userId, 'chat:updated', { chatId: chat._id, reason: 'removed_from_group' });

  sendSuccess(res, 200, { chat: chatToJSON(populated, req.user._id) });
});

// POST /api/chats/:chatId/admins { userId } -- admin only, promote
const promoteAdmin = asyncHandler(async (req, res) => {
  const chat = await assertAdmin(req.params.chatId, req.user._id);
  const { userId } = req.body;
  if (!isMember(chat, userId)) throw new ApiError(400, 'User must be a group member first');
  if (!isAdmin(chat, userId)) {
    chat.admins.push(userId);
    await chat.save();
  }
  socketModule.emitToChat(chat._id, 'chat:updated', { chatId: chat._id, reason: 'admin_promoted', userId });
  sendSuccess(res, 200, { admins: chat.admins });
});

// DELETE /api/chats/:chatId/admins/:userId -- admin only, demote
const demoteAdmin = asyncHandler(async (req, res) => {
  const chat = await assertAdmin(req.params.chatId, req.user._id);
  const { userId } = req.params;

  // Prevent removing the last admin, so a group is never left without one.
  if (chat.admins.length === 1 && chat.admins[0].toString() === userId) {
    throw new ApiError(400, 'A group must have at least one admin');
  }

  chat.admins = chat.admins.filter((a) => a.toString() !== userId);
  await chat.save();
  socketModule.emitToChat(chat._id, 'chat:updated', { chatId: chat._id, reason: 'admin_demoted', userId });
  sendSuccess(res, 200, { admins: chat.admins });
});

// POST /api/chats/:chatId/leave
const leaveChat = asyncHandler(async (req, res) => {
  const chat = await assertMember(req.params.chatId, req.user._id);
  if (chat.type !== 'group') throw new ApiError(400, 'You can only leave group chats');

  chat.members = chat.members.filter((m) => m.toString() !== req.user._id.toString());
  chat.admins = chat.admins.filter((a) => a.toString() !== req.user._id.toString());

  // If admins are now empty but members remain, promote the earliest remaining member.
  if (chat.admins.length === 0 && chat.members.length > 0) {
    chat.admins.push(chat.members[0]);
  }

  await chat.save();
  socketModule.emitToChat(chat._id, 'chat:updated', { chatId: chat._id, reason: 'member_left', userId: req.user._id });

  sendSuccess(res, 200, { message: 'Left group' });
});

// POST /api/chats/:chatId/read - mark all messages in this chat as read by current user
const markChatRead = asyncHandler(async (req, res) => {
  const chat = await assertMember(req.params.chatId, req.user._id);

  const result = await Message.updateMany(
    {
      chatId: chat._id,
      senderId: { $ne: req.user._id },
      readBy: { $ne: req.user._id },
    },
    { $addToSet: { readBy: req.user._id } }
  );

  chat.unreadCounts.set(req.user._id.toString(), 0);
  await chat.save();

  socketModule.emitToChat(chat._id, 'message:read', {
    chatId: chat._id,
    readerId: req.user._id,
  });

  sendSuccess(res, 200, { modifiedCount: result.modifiedCount });
});

module.exports = {
  listChats,
  createChat,
  getChat,
  updateChat,
  addMember,
  removeMember,
  promoteAdmin,
  demoteAdmin,
  leaveChat,
  markChatRead,
  chatToJSON,
};
