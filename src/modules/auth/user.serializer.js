const { normalizeUserSettings } = require("../settings/settings.utils.js");
const { serializeTelegramAccount } = require("../telegram/telegram.utils.js");

const serializeUser = (user) => ({
    id: user._id,
    fullName: user.fullName,
    email: user.email,
    authProvider: user.authProvider,
    settings: normalizeUserSettings(user.settings || {}),
    telegram: serializeTelegramAccount(user.telegram),
});

module.exports = {
    serializeUser,
};
