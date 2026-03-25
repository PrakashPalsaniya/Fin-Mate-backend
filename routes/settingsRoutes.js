const express = require("express");
const { protect } = require("../middlewares/authMiddleware.js");
const { getSettings, updateSettings } = require("../controller/settingsController.js");

const router = express.Router();

router.get("/", protect, getSettings);
router.patch("/", protect, updateSettings);

module.exports = router;
