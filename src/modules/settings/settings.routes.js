const express = require("express");
const { protect } = require("../../shared/middlewares/auth.middleware.js");
const { getSettings, updateSettings } = require("./settings.controller.js");

const router = express.Router();

router.get("/", protect, getSettings);
router.patch("/", protect, updateSettings);

module.exports = router;
