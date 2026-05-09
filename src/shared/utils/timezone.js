const padNumber = (value) => String(value).padStart(2, "0");

const getZonedDateParts = (date = new Date(), timeZone = "UTC") => {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        weekday: "long",
        hour12: false,
    });

    const partMap = formatter.formatToParts(date).reduce((accumulator, part) => {
        if (part.type !== "literal") {
            accumulator[part.type] = part.value;
        }

        return accumulator;
    }, {});

    const year = Number(partMap.year);
    const month = Number(partMap.month);
    const day = Number(partMap.day);
    const hour = Number(partMap.hour);
    const minute = Number(partMap.minute);
    const second = Number(partMap.second);

    return {
        year,
        month,
        day,
        hour,
        minute,
        second,
        weekday: String(partMap.weekday || "").trim().toLowerCase(),
        dateKey: `${partMap.year}-${partMap.month}-${partMap.day}`,
        monthKey: `${partMap.year}-${partMap.month}`,
        timeKey: `${padNumber(hour)}:${padNumber(minute)}`,
    };
};

const parseTimeString = (value = "08:00") => {
    const [hourString = "08", minuteString = "00"] = String(value || "").split(":");

    return {
        hour: Number(hourString),
        minute: Number(minuteString),
    };
};

const isLocalTimeAtOrAfter = (zonedParts, targetTime) => {
    const { hour: targetHour, minute: targetMinute } = parseTimeString(targetTime);

    if (zonedParts.hour > targetHour) {
        return true;
    }

    if (zonedParts.hour < targetHour) {
        return false;
    }

    return zonedParts.minute >= targetMinute;
};

const getWeekStartDateKey = (date = new Date(), timeZone = "UTC", weekStartsOn = "monday") => {
    const zonedParts = getZonedDateParts(date, timeZone);
    const weekdayOrder = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
    ];
    const currentWeekdayIndex = weekdayOrder.indexOf(zonedParts.weekday);
    const weekStartIndex = weekdayOrder.indexOf(String(weekStartsOn || "monday").toLowerCase());
    const dateOnly = new Date(Date.UTC(zonedParts.year, zonedParts.month - 1, zonedParts.day));
    let offset = currentWeekdayIndex - weekStartIndex;

    if (offset < 0) {
        offset += 7;
    }

    dateOnly.setUTCDate(dateOnly.getUTCDate() - offset);
    return dateOnly.toISOString().split("T")[0];
};

module.exports = {
    getWeekStartDateKey,
    getZonedDateParts,
    isLocalTimeAtOrAfter,
    parseTimeString,
};
