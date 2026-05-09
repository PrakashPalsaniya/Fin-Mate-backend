const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const cors = require("cors");
const express = require("express");

const connectDB = require("./shared/config/db.js");
const passport = require("./shared/config/passport.js");
const client = require("./shared/config/redis.js");
const aiSummaryRoutes = require("./modules/ai/ai.routes.js");
const authRoutes = require("./modules/auth/auth.routes.js");
const budgetRoutes = require("./modules/budget/budget.routes.js");
const chatRoutes = require("./modules/chat/chat.routes.js");
const dashboardRoutes = require("./modules/dashboard/dashboard.routes.js");
const expenseRoutes = require("./modules/expense/expense.routes.js");
const incomeRoutes = require("./modules/income/income.routes.js");
const settingsRoutes = require("./modules/settings/settings.routes.js");
const summaryDeliveryRoutes = require("./modules/summary-delivery/summary-delivery.routes.js");
const telegramRoutes = require("./modules/telegram/telegram.routes.js");
const { startSummaryScheduler, stopSummaryScheduler } = require("./modules/summary-delivery/summary-scheduler.service.js");

const app = express();
const JSON_BODY_LIMIT = String(process.env.JSON_BODY_LIMIT || "100kb").trim();
const isProduction = process.env.NODE_ENV === "production";

const normalizeOrigin = (origin = "") => String(origin || "").trim().replace(/\/+$/, "");

const getAllowedOrigins = () => {
    const configuredOrigins =
        process.env.CLIENT_URL ||
        process.env.FRONTEND_URL ||
        "http://localhost:5173";

    return configuredOrigins
        .split(",")
        .map((origin) => normalizeOrigin(origin))
        .filter(Boolean);
};

const looksLikePlaceholderSecret = (value = "") =>
    /^(your-|change-this|replace-this|example|test)/i.test(String(value || "").trim());

const requireConfiguredEnv = (name, { allowPlaceholder = false } = {}) => {
    const value = String(process.env[name] || "").trim();

    if (!value) {
        throw new Error(`${name} is required`);
    }

    if (!allowPlaceholder && looksLikePlaceholderSecret(value)) {
        throw new Error(`${name} must be replaced with a real secret before starting the server`);
    }

    return value;
};

const validateServerConfiguration = () => {
    requireConfiguredEnv("JWT_SECRET");

    if (isProduction) {
        const frontendOrigins = [
            String(process.env.CLIENT_URL || "").trim(),
            String(process.env.FRONTEND_URL || "").trim(),
        ].filter(Boolean);

        if (frontendOrigins.length === 0) {
            throw new Error("CLIENT_URL or FRONTEND_URL must be configured in production");
        }

        if (String(process.env.TELEGRAM_BOT_TOKEN || "").trim()) {
            requireConfiguredEnv("TELEGRAM_WEBHOOK_SECRET");
        }
    }
};

const allowedOrigins = getAllowedOrigins();

validateServerConfiguration();

app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
});

app.use(
    cors({
        origin: (origin, callback) => {
            const normalizedOrigin = normalizeOrigin(origin);

            if (!origin || allowedOrigins.includes(normalizedOrigin)) {
                return callback(null, true);
            }

            console.error("Blocked by CORS:", normalizedOrigin);
            return callback(new Error("Origin not allowed by CORS"));
        },
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true,
    })
);

app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: JSON_BODY_LIMIT }));
app.use(passport.initialize());

app.get("/", (_req, res) => {
    res.status(200).json({
        ok: true,
        service: "finmate-backend",
    });
});

try {
    console.log("Loading authRoutes...");
    app.use("/api/v1/auth", authRoutes);

    console.log("Loading incomeRoutes...");
    app.use("/api/v1/income", incomeRoutes);

    console.log("Loading expenseRoutes...");
    app.use("/api/v1/expense", expenseRoutes);

    console.log("Loading budgetRoutes...");
    app.use("/api/v1/budgets", budgetRoutes);

    console.log("Loading dashboardRoutes...");
    app.use("/api/v1/dashboard", dashboardRoutes);

    console.log("Loading aiSummaryRoutes...");
    app.use("/api/v1/ai-summary", aiSummaryRoutes);

    console.log("Loading chatRoutes...");
    app.use("/api/v1/chat", chatRoutes);

    console.log("Loading settingsRoutes...");
    app.use("/api/v1/settings", settingsRoutes);

    console.log("Loading telegramRoutes...");
    app.use("/api/v1/telegram", telegramRoutes);

    console.log("Loading summaryDeliveryRoutes...");
    app.use("/api/v1/summary-delivery", summaryDeliveryRoutes);
} catch (error) {
    console.error("Error loading routes:", error);
    process.exit(1);
}

process.on("SIGINT", async () => {
    console.log("Shutting down gracefully...");
    stopSummaryScheduler();
    if (client.isConnected()) {
        await client.quit();
    }
    process.exit(0);
});

process.on("SIGTERM", async () => {
    console.log("Shutting down gracefully...");
    stopSummaryScheduler();
    if (client.isConnected()) {
        await client.quit();
    }
    process.exit(0);
});

const startServer = async () => {
    await connectDB();
    await client.connect();

    const port = process.env.PORT || 5000;
    app.listen(port, () => {
        console.log(`server running on port ${port}`);
    });

    startSummaryScheduler();
};

startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
});
