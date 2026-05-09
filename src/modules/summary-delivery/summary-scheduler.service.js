const User = require("../auth/user.model.js");
const {
    deliverSummary,
    getScheduledSummaryContexts,
} = require("./summary-delivery.service.js");

const SUMMARY_SCHEDULER_ENABLED =
    String(process.env.SUMMARY_SCHEDULER_ENABLED || "true").trim().toLowerCase() !== "false";
const SUMMARY_SCHEDULER_INTERVAL_MS = Number(process.env.SUMMARY_SCHEDULER_INTERVAL_MS || 60000);

let schedulerInterval = null;
let schedulerRunning = false;

const getUsersWithSummaryPreferences = () =>
    User.find({
        $or: [
            { "settings.notifications.dailySummary": true },
            { "settings.notifications.weeklySummary": true },
            { "settings.notifications.monthlySummary": true },
        ],
    })
        .select("fullName email settings telegram")
        .lean();

const processDueSummaryDeliveries = async (now = new Date()) => {
    if (schedulerRunning) {
        return;
    }

    schedulerRunning = true;

    try {
        const users = await getUsersWithSummaryPreferences();

        for (const user of users) {
            const dueContexts = getScheduledSummaryContexts(user, now);

            for (const context of dueContexts) {
                const result = await deliverSummary({
                    user,
                    frequency: context.frequency,
                    source: "scheduled",
                    deliveryKey: context.deliveryKey,
                    scheduledDateKey: context.scheduledDateKey,
                    now,
                });

                if (result.channels.some((channel) => channel.status === "sent")) {
                    console.log(
                        `Summary delivery sent for user ${user._id} (${context.frequency})`
                    );
                }
            }
        }
    } catch (error) {
        console.error("Summary scheduler run failed:", error.message);
    } finally {
        schedulerRunning = false;
    }
};

const startSummaryScheduler = () => {
    if (!SUMMARY_SCHEDULER_ENABLED || schedulerInterval) {
        return;
    }

    setTimeout(() => {
        processDueSummaryDeliveries().catch((error) => {
            console.error("Initial summary scheduler run failed:", error.message);
        });
    }, 10000);

    schedulerInterval = setInterval(() => {
        processDueSummaryDeliveries().catch((error) => {
            console.error("Scheduled summary run failed:", error.message);
        });
    }, SUMMARY_SCHEDULER_INTERVAL_MS);

    console.log(`Summary scheduler started (interval ${SUMMARY_SCHEDULER_INTERVAL_MS}ms)`);
};

const stopSummaryScheduler = () => {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
    }
};

module.exports = {
    processDueSummaryDeliveries,
    startSummaryScheduler,
    stopSummaryScheduler,
};
