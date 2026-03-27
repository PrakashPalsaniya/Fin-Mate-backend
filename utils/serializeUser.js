const { normalizeUserSettings } = require("./userSettings.js");
const { serializeTelegramAccount } = require("./serializeTelegramAccount.js");

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
