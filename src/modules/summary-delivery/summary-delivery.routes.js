const express = require("express");
const { protect } = require("../../shared/middlewares/auth.middleware.js");
const { summarySendRateLimiter } = require("../../shared/middlewares/rate-limit.middleware.js");
const {
    getSummaryHistory,
    sendSummaryNow,
} = require("./summary-delivery.controller.js");

const router = express.Router();

router.get("/history", protect, getSummaryHistory);
router.post("/send", protect, summarySendRateLimiter, sendSummaryNow);

module.exports = router;
