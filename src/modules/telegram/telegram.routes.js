const express = require("express");
const { protect } = require("../../shared/middlewares/auth.middleware.js");
const {
    getTelegramStatus,
    handleTelegramWebhook,
    startTelegramLink,
    unlinkTelegram,
} = require("./telegram.controller.js");

const router = express.Router();

router.post("/webhook", handleTelegramWebhook);
router.get("/status", protect, getTelegramStatus);
router.post("/link/start", protect, startTelegramLink);
router.delete("/link", protect, unlinkTelegram);

module.exports = router;
