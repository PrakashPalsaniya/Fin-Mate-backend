const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const { getWebhookInfo } = require("../src/modules/telegram/services/telegramApi.js");

const run = async () => {
    const result = await getWebhookInfo();
    console.log(JSON.stringify(result, null, 2));
};

run().catch((error) => {
    console.error("Failed to fetch Telegram webhook info:", error.message);
    process.exit(1);
});
