const express = require("express");
const { financeBuddyChat } = require("../controller/chatController");
const { protect } = require("../middlewares/authMiddleware");
const { chatRateLimiter } = require("../middlewares/rateLimitMiddleware.js");

const router = express.Router();

// POST /api/chat - Send a message to Finance Buddy
router.post("/", protect, chatRateLimiter, financeBuddyChat);

module.exports = router;
