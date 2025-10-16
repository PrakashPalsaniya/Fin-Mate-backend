const express = require("express");
const { financeBuddyChat } = require("../controller/chatController");
const { protect } = require("../middlewares/authMiddleware");

const router = express.Router();

// POST /api/chat - Send a message to Finance Buddy
router.post("/", protect, financeBuddyChat);

module.exports = router;
