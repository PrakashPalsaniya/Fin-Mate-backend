const WEEKDAY_OPTIONS = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
];

const DEFAULT_USER_SETTINGS = Object.freeze({
    timezone: "Asia/Kolkata",
    notifications: {
        emailEnabled: true,
        telegramEnabled: true,
        dailySummary: false,
        weeklySummary: true,
        monthlySummary: true,
        transactionAlerts: false,
    },
    summaries: {
        dailyTime: "08:00",
        weeklyDay: "monday",
        monthlyDay: 1,
    },
});

const cloneDefaultUserSettings = () =>
    JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS));

const isValidTimezone = (value) => {
    try {
        Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
        return true;
    } catch (error) {
        return false;
    }
};

const isValidTime = (value) =>
    /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(value || "").trim());

const normalizeUserSettings = (input = {}) => {
    const defaults = cloneDefaultUserSettings();
    const notifications = input.notifications || {};
    const summaries = input.summaries || {};
    const timezoneCandidate = String(input.timezone || "").trim();
    const monthlyDayCandidate = Number(summaries.monthlyDay);

    return {
        timezone: isValidTimezone(timezoneCandidate) ? timezoneCandidate : defaults.timezone,
        notifications: {
            emailEnabled:
                typeof notifications.emailEnabled === "boolean"
                    ? notifications.emailEnabled
                    : defaults.notifications.emailEnabled,
            telegramEnabled:
                typeof notifications.telegramEnabled === "boolean"
                    ? notifications.telegramEnabled
                    : defaults.notifications.telegramEnabled,
            dailySummary:
                typeof notifications.dailySummary === "boolean"
                    ? notifications.dailySummary
                    : defaults.notifications.dailySummary,
            weeklySummary:
                typeof notifications.weeklySummary === "boolean"
                    ? notifications.weeklySummary
                    : defaults.notifications.weeklySummary,
            monthlySummary:
                typeof notifications.monthlySummary === "boolean"
                    ? notifications.monthlySummary
                    : defaults.notifications.monthlySummary,
            transactionAlerts:
                typeof notifications.transactionAlerts === "boolean"
                    ? notifications.transactionAlerts
                    : defaults.notifications.transactionAlerts,
        },
        summaries: {
            dailyTime: isValidTime(summaries.dailyTime)
                ? String(summaries.dailyTime).trim()
                : defaults.summaries.dailyTime,
            weeklyDay: WEEKDAY_OPTIONS.includes(
                String(summaries.weeklyDay || "").trim().toLowerCase()
            )
                ? String(summaries.weeklyDay).trim().toLowerCase()
                : defaults.summaries.weeklyDay,
            monthlyDay:
                Number.isInteger(monthlyDayCandidate) &&
                monthlyDayCandidate >= 1 &&
                monthlyDayCandidate <= 28
                    ? monthlyDayCandidate
                    : defaults.summaries.monthlyDay,
        },
    };
};

const mergeUserSettings = (currentSettings = {}, updates = {}) => {
    const normalizedCurrent = normalizeUserSettings(currentSettings);
    const merged = {
        ...normalizedCurrent,
        ...updates,
        notifications: {
            ...normalizedCurrent.notifications,
            ...(updates.notifications || {}),
        },
        summaries: {
            ...normalizedCurrent.summaries,
            ...(updates.summaries || {}),
        },
    };

    return normalizeUserSettings(merged);
};

module.exports = {
    DEFAULT_USER_SETTINGS,
    WEEKDAY_OPTIONS,
    normalizeUserSettings,
    mergeUserSettings,
};
