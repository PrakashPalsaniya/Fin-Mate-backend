const dotenv = require("dotenv");
dotenv.config();

const cors = require("cors")
const path = require("path")
const session = require("express-session")

const express = require("express")
const app = express()

const connectDB = require("./config/db.js")
const passport = require("./config/passport.js")
const client = require("./config/redis.js")
const authRoutes = require("./routes/authRoutes.js")
const incomeRoutes = require("./routes/incomeRoutes.js")
const expenseRoutes = require("./routes/expenseRoutes.js")
const dashboardRoutes = require("./routes/dashboardRoutes.js")
const aiSummaryRoutes = require("./routes/aiSummaryRoutes.js")
const chatRoutes = require("./routes/chatRoutes.js")
const goalRoutes = require("./routes/goalRoutes.js")


// Middleware to handle CORS
app.use(
    cors({
        origin: "*",
        // This line tells your server who is allowed to make requests to it (like sending or getting data).
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
        allowedHeaders: ["Content-type", "Authorization"],
    })
)

app.use(express.json());

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true in production with HTTPS
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

connectDB();

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/income", incomeRoutes);
app.use("/api/v1/expense", expenseRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/ai-summary", aiSummaryRoutes);
app.use("/api/v1/chat", chatRoutes);
app.use("/api/v1/goals", goalRoutes);

// Serve uploads folder
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get('/', (req, res) => {
    res.send('Hello, World!');
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    if (client.isConnected()) {
        await client.quit();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Shutting down gracefully...');
    if (client.isConnected()) {
        await client.quit();
    }
    process.exit(0);
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
    console.log(`server running on port ${port}`)
})
