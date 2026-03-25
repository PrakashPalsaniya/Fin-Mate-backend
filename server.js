const path = require("path")
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, ".env") });

const cors = require("cors")
const session = require("express-session")
const express = require("express")

const app = express()

const connectDB = require("./config/db.js")
const passport = require("./config/passport.js")
const client = require("./config/redis.js")
const authRoutes = require("./routes/authRoutes.js")
const incomeRoutes = require("./routes/incomeRoutes.js")
const expenseRoutes = require("./routes/expenseRoutes.js")
const budgetRoutes = require("./routes/budgetRoutes.js")
const dashboardRoutes = require("./routes/dashboardRoutes.js")
const aiSummaryRoutes = require("./routes/aiSummaryRoutes.js")
const chatRoutes = require("./routes/chatRoutes.js")
const settingsRoutes = require("./routes/settingsRoutes.js")
const telegramRoutes = require("./routes/telegramRoutes.js")
const summaryDeliveryRoutes = require("./routes/summaryDeliveryRoutes.js")
const { startSummaryScheduler, stopSummaryScheduler } = require("./services/summarySchedulerService.js")

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

const allowedOrigins = getAllowedOrigins();
const isProduction = process.env.NODE_ENV === "production";

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
        allowedHeaders: ["Content-type", "Authorization"],
        credentials: true,
    })
)

app.use(express.json());

app.get("/", (_req, res) => {
    res.status(200).json({
        ok: true,
        service: "finmate-backend",
    });
});

app.use(session({
    secret: process.env.SESSION_SECRET || "your-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: isProduction,
        sameSite: "lax",
        httpOnly: true,
    }
}));

app.use(passport.initialize());
app.use(passport.session());

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

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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

    const port = process.env.PORT || 5000;
    app.listen(port, () => {
        console.log(`server running on port ${port}`)
    });

    startSummaryScheduler();
    client.connect().catch((error) => {
        console.error("Redis startup skipped, using in-memory storage:", error.message);
    });
};

startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
});
