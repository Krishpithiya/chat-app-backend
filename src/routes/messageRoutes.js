const express = require('express');
const { editMessage, deleteMessage } = require('../controllers/messageController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.patch('/:messageId', editMessage);
router.delete('/:messageId', deleteMessage);

module.exports = router;
