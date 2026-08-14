const express = require('express');
const {
  searchUsers,
  getUserById,
  blockUser,
  unblockUser,
  getBlockedUsers,
} = require('../controllers/userController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/search', searchUsers);
router.get('/me/blocked', getBlockedUsers);
router.post('/:userId/block', blockUser);
router.delete('/:userId/block', unblockUser);
router.get('/:userId', getUserById);

module.exports = router;
