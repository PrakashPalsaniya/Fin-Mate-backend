const express = require("express");
const { protect } = require("../middlewares/authMiddleware.js");
const {
    getTelegramStatus,
    handleTelegramWebhook,
    startTelegramLink,
    unlinkTelegram,
} = require("../controller/telegramController.js");

const router = express.Router();

router.post("/webhook", handleTelegramWebhook);
router.get("/status", protect, getTelegramStatus);
router.post("/link/start", protect, startTelegramLink);
router.delete("/link", protect, unlinkTelegram);

module.exports = router;
