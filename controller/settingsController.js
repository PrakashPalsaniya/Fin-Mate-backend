const User = require("../models/User.js");
const { serializeUser } = require("../utils/serializeUser.js");
const { mergeUserSettings, normalizeUserSettings } = require("../utils/userSettings.js");

exports.getSettings = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        return res.status(200).json({
            settings: normalizeUserSettings(user.settings || {}),
        });
    } catch (error) {
        return res.status(500).json({
            message: "Failed to load settings",
            error: error.message,
        });
    }
};

exports.updateSettings = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const updates = req.body?.settings ?? req.body ?? {};
        user.settings = mergeUserSettings(user.settings || {}, updates);
        await user.save();

        return res.status(200).json({
            message: "Settings updated successfully",
            settings: normalizeUserSettings(user.settings),
            user: serializeUser(user),
        });
    } catch (error) {
        return res.status(500).json({
            message: "Failed to update settings",
            error: error.message,
        });
    }
};
