const express = require('express');
const {
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
} = require('../controllers/chatController');
const { getMessages, sendMessage } = require('../controllers/messageController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', listChats);
router.post('/', createChat);
router.get('/:chatId', getChat);
router.patch('/:chatId', updateChat);

router.post('/:chatId/members', addMember);
router.delete('/:chatId/members/:userId', removeMember);
router.post('/:chatId/admins', promoteAdmin);
router.delete('/:chatId/admins/:userId', demoteAdmin);
router.post('/:chatId/leave', leaveChat);

router.post('/:chatId/read', markChatRead);

router.get('/:chatId/messages', getMessages);
router.post('/:chatId/messages', sendMessage);

module.exports = router;
