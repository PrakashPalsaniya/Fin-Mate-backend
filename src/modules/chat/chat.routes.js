const express = require("express");
const { financeBuddyChat } = require("./chat.controller.js");
const { protect } = require("../../shared/middlewares/auth.middleware.js");
const { chatRateLimiter } = require("../../shared/middlewares/rate-limit.middleware.js");

const router = express.Router();

// POST /api/chat - Send a message to Finance Buddy
router.post("/", protect, chatRateLimiter, financeBuddyChat);

module.exports = router;
