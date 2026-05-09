const DEFAULT_TRANSACTION_ICON = "LuUtensils";

const TRANSACTION_ICON_MAP = {
    income: {
        salary: "LuWalletMinimal",
        freelance: "LuLaptop",
        business: "LuBuilding",
        investment: "LuTrendingUp",
        others: DEFAULT_TRANSACTION_ICON,
    },
    expense: {
        rent: "LuHome",
        entertainment: "LuGamepad2",
        food: DEFAULT_TRANSACTION_ICON,
        transport: "LuCar",
        utilities: "LuZap",
        healthcare: "LuHeart",
        education: "LuGraduationCap",
        shopping: "LuShoppingBag",
        others: DEFAULT_TRANSACTION_ICON,
    },
};

const getTransactionIcon = (transactionType, category) => {
    const normalizedType = String(transactionType || "").trim().toLowerCase();
    const normalizedCategory = String(category || "").trim().toLowerCase();
    const iconMap = TRANSACTION_ICON_MAP[normalizedType] || {};

    return iconMap[normalizedCategory] || DEFAULT_TRANSACTION_ICON;
};

module.exports = {
    DEFAULT_TRANSACTION_ICON,
    TRANSACTION_ICON_MAP,
    getTransactionIcon,
};
