const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const { getTelegramWebhookUrl } = require("../services/telegram/telegramConfig.js");
const { setWebhook } = require("../services/telegram/telegramApi.js");

const run = async () => {
    const webhookUrl = getTelegramWebhookUrl();

    if (!webhookUrl) {
        throw new Error("TELEGRAM_WEBHOOK_URL is required to set the Telegram webhook.");
    }

    const result = await setWebhook({
        url: webhookUrl,
    });

    console.log("Telegram webhook updated successfully.");
    console.log(JSON.stringify(result, null, 2));
};

run().catch((error) => {
    console.error("Failed to set Telegram webhook:", error.message);
    process.exit(1);
});
