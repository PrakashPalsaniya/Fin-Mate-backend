const axios = require("axios");
const crypto = require("crypto");
const Income = require("../models/Income.js");
const Expense = require("../models/Expense.js");
const redis = require("../config/redis.js");
const { Types } = require("mongoose");
const {
  getGeminiUrl,
  isGeminiQuotaError,
  logGeminiError,
} = require("../utils/geminiClient.js");
const CACHE_TTL = 60 * 60 * 24; // 24 hours in seconds

// STABLE hash function - only uses totals and sorted categories
const generateDataHash = (financialData) => {
  // Sort categories alphabetically for consistency
  const sortedExpenseCategories = [...financialData.expenseCategories]
    .sort((a, b) => String(a.category).localeCompare(String(b.category)))
    .map(c => ({
      category: c.category,
      amount: Math.round(c.amount)
    }));

  const sortedIncomeCategories = [...financialData.incomeCategories]
    .sort((a, b) => String(a.category).localeCompare(String(b.category)))
    .map(c => ({
      category: c.category,
      amount: Math.round(c.amount)
    }));

  const dataString = JSON.stringify({
    totalIncome: Math.round(financialData.totalIncome),
    totalExpenses: Math.round(financialData.totalExpenses),
    expenseCategories: sortedExpenseCategories,
    incomeCategories: sortedIncomeCategories
  });
  
  return crypto.createHash('sha256').update(dataString).digest('hex').substring(0, 16);
};

const stripCodeFences = (text = "") =>
  String(text)
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

const sanitizeJSONText = (text = "") =>
  stripCodeFences(text)
    .replace(/^\uFEFF/, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

// Helper function to extract the first complete JSON object from text
const extractFirstJSONObjectString = (text) => {
  const cleanText = sanitizeJSONText(text);
  const firstOpen = cleanText.indexOf("{");
  if (firstOpen === -1) {
    throw new Error("No JSON object found in response");
  }

  let braceCount = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = firstOpen; i < cleanText.length; i++) {
    const char = cleanText[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === "{") {
        braceCount++;
      } else if (char === "}") {
        braceCount--;

        if (braceCount === 0) {
          return cleanText.substring(firstOpen, i + 1);
        }
      }
    }
  }

  throw new Error("Could not find complete JSON object");
};

const parseAIJSON = (text) => {
  const candidates = [];

  const addCandidate = (value) => {
    const normalized = sanitizeJSONText(value);
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  addCandidate(text);

  try {
    addCandidate(extractFirstJSONObjectString(text));
  } catch (error) {
    // Ignore and keep trying other candidates.
  }

  const strippedText = stripCodeFences(text);
  if (strippedText !== text) {
    addCandidate(strippedText);

    try {
      addCandidate(extractFirstJSONObjectString(strippedText));
    } catch (error) {
      // Ignore and keep trying other candidates.
    }
  }

  const expandedCandidates = [];
  candidates.forEach((candidate) => {
    if (!expandedCandidates.includes(candidate)) {
      expandedCandidates.push(candidate);
    }

    const withoutTrailingCommas = candidate.replace(/,\s*([}\]])/g, "$1");
    if (
      withoutTrailingCommas !== candidate &&
      !expandedCandidates.includes(withoutTrailingCommas)
    ) {
      expandedCandidates.push(withoutTrailingCommas);
    }
  });

  let lastError = new Error("No parseable JSON found in AI response");

  for (const candidate of expandedCandidates) {
    try {
      const parsed = JSON.parse(candidate);

      if (Array.isArray(parsed)) {
        if (parsed[0] && typeof parsed[0] === "object") {
          return parsed[0];
        }
        throw new Error("AI response JSON array did not contain an object");
      }

      if (parsed && typeof parsed === "object") {
        return parsed.aiSummary && typeof parsed.aiSummary === "object"
          ? parsed.aiSummary
          : parsed;
      }

      throw new Error("AI response JSON was not an object");
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Failed to parse AI JSON: ${lastError.message}`);
};

const collapseWhitespace = (value = "") =>
  String(value).replace(/\s+/g, " ").trim();

const stripListPrefix = (value = "") =>
  collapseWhitespace(value).replace(/^[-*•\d.)\s]+/, "");

const clampText = (value = "", maxLength = 220) => {
  const cleaned = stripListPrefix(value);

  if (!cleaned || cleaned.length <= maxLength) {
    return cleaned;
  }

  const candidate = cleaned.slice(0, maxLength + 1);
  const lastSpace = candidate.lastIndexOf(" ");
  const cutoff = lastSpace > maxLength * 0.6 ? lastSpace : maxLength;

  return `${candidate
    .slice(0, cutoff)
    .trim()
    .replace(/[,:;.!-]+$/, "")}...`;
};

const normalizeString = (value, fallback, maxLength = 220) => {
  const selected =
    typeof value === "string" && value.trim() ? value : fallback;

  return clampText(selected, maxLength);
};

const normalizeStringArray = (value, fallback, options = {}) => {
  const { maxItems = 3, maxLength = 120 } = options;
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];

  const cleaned = source
    .map((item) => clampText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);

  if (cleaned.length > 0) {
    return cleaned;
  }

  return (Array.isArray(fallback) ? fallback : [])
    .map((item) => clampText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
};

const formatCurrency = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));

const fillList = (items, fallbacks, maxItems = 3) => {
  const result = [...items];

  for (const fallback of fallbacks) {
    if (result.length >= maxItems) {
      break;
    }

    if (!result.includes(fallback)) {
      result.push(fallback);
    }
  }

  return result.slice(0, maxItems);
};

const buildSummaryOverview = (financialData) => {
  const {
    totalExpenses = 0,
    totalBalance = 0,
    savingsRate = 0,
    trends = {},
    spendingVelocity = {},
    expenseCategories = [],
    incomeCategories = [],
  } = financialData;

  const topExpense = expenseCategories[0] || null;
  const topIncome = incomeCategories[0] || null;
  const topExpenseShare =
    topExpense && totalExpenses > 0
      ? Math.round((topExpense.amount / totalExpenses) * 100)
      : null;

  const expenseTrendLabel =
    trends.expenseChange === null || trends.expenseChange === undefined
      ? "Building your first monthly baseline"
      : `Expenses ${
          trends.expenseChange > 0
            ? "rose"
            : trends.expenseChange < 0
              ? "fell"
              : "stayed flat"
        } ${Math.abs(trends.expenseChange)}%`;

  const focusLabel = totalBalance < 0
    ? "Reduce outflow this month"
    : topExpense && topExpenseShare !== null && topExpenseShare >= 35
      ? `Watch ${topExpense.category}`
      : savingsRate >= 20
        ? "Protect your current surplus"
        : "Strengthen monthly savings";

  return {
    headlineTone:
      totalBalance < 0 ? "caution" : savingsRate >= 20 ? "strong" : "steady",
    balanceLabel:
      totalBalance >= 0 ? "Positive cash flow" : "Cash flow under pressure",
    focusLabel,
    expenseTrendLabel,
    topExpense: topExpense
      ? {
          category: topExpense.category,
          amount: topExpense.amount,
          share: topExpenseShare,
        }
      : null,
    topIncome: topIncome
      ? {
          category: topIncome.category,
          amount: topIncome.amount,
        }
      : null,
    dailySpend: Number(spendingVelocity.dailyAverage || 0),
    projectedMonthlyExpense: Number(spendingVelocity.projected || 0),
  };
};

const buildFallbackAISummary = (financialData) => {
  const {
    totalIncome = 0,
    totalExpenses = 0,
    totalBalance = 0,
    savingsRate = 0,
    trends = {},
    spendingVelocity = {},
    expenseCategories = [],
  } = financialData;

  const hasActivity = totalIncome > 0 || totalExpenses > 0;
  const topExpense = expenseCategories[0] || null;
  const topExpenseShare =
    topExpense && totalExpenses > 0
      ? Math.round((topExpense.amount / totalExpenses) * 100)
      : null;

  const summaryTitle = !hasActivity
    ? "No recent money activity to analyze yet"
    : totalBalance >= 0
      ? "You stayed ahead of your spending this month"
      : "Your spending is outpacing your income right now";

  const trendSummary =
    trends.expenseChange === null || trends.expenseChange === undefined
      ? "This looks like your first tracked month, so the main focus is building a clean baseline."
      : `Expenses ${
          trends.expenseChange > 0
            ? "rose"
            : trends.expenseChange < 0
              ? "fell"
              : "were flat"
        } ${Math.abs(trends.expenseChange)}% versus the previous 30 days.`;

  const insightsSummary = !hasActivity
    ? "There is no income or expense activity in the last 30 days yet. Add a few transactions and the AI summary will become much more specific."
    : `In the last 30 days you earned ${formatCurrency(totalIncome)} and spent ${formatCurrency(
        totalExpenses
      )}, leaving ${formatCurrency(totalBalance)}. ${
        topExpense
          ? `Your biggest expense bucket was ${topExpense.category} at ${formatCurrency(
              topExpense.amount
            )}${topExpenseShare !== null ? ` (${topExpenseShare}% of spending)` : ""}.`
          : "Your spending is spread across a few smaller categories."
      } ${trendSummary}`;

  const highlightItems = !hasActivity
    ? [
        "No income or expense transactions were found for the last 30 days.",
        "The fastest way to unlock better insights is to add your regular income first.",
        "Track even a few daily expenses so the next summary can spot patterns."
      ]
    : fillList(
        [
          `Net position: ${formatCurrency(totalBalance)} from ${formatCurrency(
            totalIncome
          )} income and ${formatCurrency(totalExpenses)} expenses.`,
          topExpense
            ? `Largest expense category: ${topExpense.category} at ${formatCurrency(
                topExpense.amount
              )}${topExpenseShare !== null ? ` (${topExpenseShare}% of total spending)` : ""}.`
            : "",
          spendingVelocity.dailyAverage
            ? `Current spending pace is about ${formatCurrency(
                spendingVelocity.dailyAverage
              )} per day.`
            : ""
        ].filter(Boolean),
        [
          "Keep tracking transactions consistently to improve the accuracy of future summaries.",
          "Compare this 30-day window with the next one to spot real habits, not one-off purchases."
        ]
      );

  const smartMoveItems = fillList(
    [
      totalBalance > 0
        ? `Move ${formatCurrency(Math.max(Math.round(totalBalance * 0.2), 1))} into savings before the next month starts.`
        : "",
      topExpense && topExpenseShare >= 35
        ? `Set a cap for ${topExpense.category} near ${formatCurrency(
            Math.round(topExpense.amount * 0.9)
          )} next month to trim your biggest expense bucket.`
        : "",
      totalBalance < 0
        ? `Cut at least ${formatCurrency(Math.abs(Math.round(totalBalance)))} from next month's spending plan to get back to break-even.`
        : "",
      totalIncome > 0
        ? `Keep a daily spending ceiling near ${formatCurrency(
            Math.max(Math.round(totalIncome / 30), 1)
          )} so expenses stay aligned with income.`
        : ""
    ].filter(Boolean),
    [
      "Review your top three expense categories and decide which one gets a stricter limit next month.",
      "Schedule one weekly money check-in so adjustments happen before overspending builds up.",
      "Automate at least one recurring transfer for savings or bill payments."
    ]
  );

  const nextStepItems = fillList(
    [
      "Review your spending categories this week and confirm which ones are essential versus flexible.",
      totalBalance >= 0
        ? `Pick a savings target of ${formatCurrency(
            Math.max(Math.round(totalBalance * 0.3), 1)
          )} for the next 30 days.`
        : `Plan a reduction of ${formatCurrency(
            Math.abs(Math.round(totalBalance))
          )} across upcoming discretionary expenses.`,
      "Refresh this summary after adding new transactions so the advice updates with current data."
    ].filter(Boolean),
    [
      "Add every major income source and bill for the next month to make the trend analysis more reliable."
    ]
  );

  const financialHealth =
    totalBalance < 0 || savingsRate < 0
      ? "Needs Attention"
      : savingsRate >= 30
        ? "Excellent"
        : savingsRate >= 15
          ? "Good"
          : "Fair";

  const savingsEfficiency =
    savingsRate >= 30
      ? "Outstanding"
      : savingsRate >= 20
        ? "High"
        : savingsRate >= 10
          ? "Moderate"
          : "Low";

  const riskLevel =
    totalBalance < 0 || (trends.expenseChange || 0) >= 20
      ? "High"
      : savingsRate < 10 || (trends.expenseChange || 0) >= 10
        ? "Moderate"
        : savingsRate >= 30
          ? "Very Low"
          : "Low";

  return {
    summaryTitle,
    insightsSummary,
    highlights: highlightItems,
    smartMoves: smartMoveItems,
    aiScore: {
      financialHealth,
      savingsEfficiency,
      riskLevel,
    },
    nextSteps: nextStepItems,
  };
};

const normalizeAISummary = (parsedSummary, financialData) => {
  const fallback = buildFallbackAISummary(financialData);
  const source =
    parsedSummary && typeof parsedSummary === "object" && !Array.isArray(parsedSummary)
      ? parsedSummary
      : {};

  return {
    summaryTitle: normalizeString(source.summaryTitle, fallback.summaryTitle, 88),
    insightsSummary: normalizeString(
      source.insightsSummary,
      fallback.insightsSummary,
      260
    ),
    highlights: normalizeStringArray(source.highlights, fallback.highlights, {
      maxItems: 3,
      maxLength: 120,
    }),
    smartMoves: normalizeStringArray(source.smartMoves, fallback.smartMoves, {
      maxItems: 3,
      maxLength: 120,
    }),
    aiScore: {
      financialHealth: normalizeString(
        source.aiScore?.financialHealth,
        fallback.aiScore.financialHealth,
        32
      ),
      savingsEfficiency: normalizeString(
        source.aiScore?.savingsEfficiency,
        fallback.aiScore.savingsEfficiency,
        32
      ),
      riskLevel: normalizeString(
        source.aiScore?.riskLevel,
        fallback.aiScore.riskLevel,
        32
      ),
    },
    nextSteps: normalizeStringArray(source.nextSteps, fallback.nextSteps, {
      maxItems: 3,
      maxLength: 120,
    }),
  };
};

const generateAISummary = async (req, res) => {
  try {
    console.log("AI Summary request received");
    const userId = req.user?.id;

    if (!userId) {
      return res.status(400).json({ message: "User ID not found" });
    }

    const userObjectId = new Types.ObjectId(String(userId));
    console.log("User ID:", userId);

    // Date ranges for analysis
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    // Fetch Current Month Income and Expense Data
    const [totalIncomeResult] = await Income.aggregate([
      { $match: { userId: userObjectId, date: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const [totalExpenseResult] = await Expense.aggregate([
      { $match: { userId: userObjectId, date: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    // Previous month data for trend analysis
    const [previousMonthIncomeResult] = await Income.aggregate([
      { 
        $match: { 
          userId: userObjectId,
          date: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo }
        }
      },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const [previousMonthExpenseResult] = await Expense.aggregate([
      { 
        $match: { 
          userId: userObjectId,
          date: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo }
        }
      },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const totalIncome = totalIncomeResult?.total || 0;
    const totalExpenses = totalExpenseResult?.total || 0;
    const totalBalance = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0 
      ? ((totalIncome - totalExpenses) / totalIncome) * 100 
      : 0;

    // Calculate trends
    const previousIncome = previousMonthIncomeResult?.total || 0;
    const previousExpenses = previousMonthExpenseResult?.total || 0;
    
    const incomeChange = previousIncome > 0 
      ? ((totalIncome - previousIncome) / previousIncome * 100).toFixed(1)
      : null;
    
    const expenseChange = previousExpenses > 0
      ? ((totalExpenses - previousExpenses) / previousExpenses * 100).toFixed(1)
      : null;

    // Expense categories
    const expenseCategories = await Expense.aggregate([
      { $match: { userId: userObjectId, date: { $gte: thirtyDaysAgo } } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } },
    ]);

    // Income categories
    const incomeCategories = await Income.aggregate([
      { $match: { userId: userObjectId, date: { $gte: thirtyDaysAgo } } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } },
    ]);

    // Recent transactions
    const recentExpenses = await Expense.find({
      userId,
      date: { $gte: thirtyDaysAgo },
    })
      .sort({ date: -1 })
      .limit(10);

    const recentIncomes = await Income.find({
      userId,
      date: { $gte: thirtyDaysAgo },
    })
      .sort({ date: -1 })
      .limit(10);

    // Calculate spending velocity
    const daysInMonth = 30;
    const dailyExpenseRate = (totalExpenses / daysInMonth).toFixed(0);
    const projectedMonthlyExpense = dailyExpenseRate * 30;

    // Prepare enhanced financial data
    const financialData = {
      totalIncome,
      totalExpenses,
      totalBalance,
      savingsRate: parseFloat(savingsRate.toFixed(2)),
      trends: {
        incomeChange: incomeChange ? parseFloat(incomeChange) : null,
        expenseChange: expenseChange ? parseFloat(expenseChange) : null,
        incomeDirection: incomeChange > 0 ? 'increased' : incomeChange < 0 ? 'decreased' : 'stable',
        expenseDirection: expenseChange > 0 ? 'increased' : expenseChange < 0 ? 'decreased' : 'stable'
      },
      spendingVelocity: {
        dailyAverage: parseFloat(dailyExpenseRate),
        projected: projectedMonthlyExpense,
        remainingBudget: totalIncome - projectedMonthlyExpense
      },
      expenseCategories: expenseCategories.map((c) => ({
        category: c._id,
        amount: c.total,
      })),
      incomeCategories: incomeCategories.map((c) => ({
        category: c._id,
        amount: c.total,
      })),
      recentExpenses: recentExpenses.map((e) => ({
        title: e.title,
        category: e.category,
        amount: e.amount,
        date: e.date.toISOString().split("T")[0],
      })),
      recentIncomes: recentIncomes.map((i) => ({
        title: i.title,
        category: i.category,
        amount: i.amount,
        date: i.date.toISOString().split("T")[0],
      })),
    };
    const overview = buildSummaryOverview(financialData);

    // HYBRID CACHE KEY: Date + Data Hash
    // Regenerates when EITHER date changes OR data changes
    const today = new Date().toISOString().split('T')[0];
    const dataHash = generateDataHash(financialData);
    const cacheKey = `ai_summary:${userId}:${today}:${dataHash}`;
    
    console.log("Date:", today);
    console.log("Data hash:", dataHash);
    console.log("Cache key:", cacheKey);

    // Check Redis cache first
    try {
      const cachedData = await redis.get(cacheKey);
      
      if (cachedData) {
        const parsedCache = JSON.parse(cachedData);
        console.log("✅ Redis Cache HIT - Returning cached summary");
        
        return res.json({
          success: true,
          data: financialData,
          overview,
          aiSummary: normalizeAISummary(parsedCache.aiSummary, financialData),
          generatedAt: parsedCache.generatedAt,
          cached: true,
          message: "Cached summary (data unchanged today)"
        });
      }
    } catch (cacheError) {
      console.error("Redis cache read error:", cacheError);
    }

    console.log("❌ Cache MISS - Generating new AI summary");

    // Clean up old cache entries for this user today (optional)
    try {
      const pattern = `ai_summary:${userId}:${today}:*`;
      let cursor = '0';
      let keysToDelete = [];
      
      do {
        const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = result[0];
        keysToDelete = keysToDelete.concat(result[1]);
      } while (cursor !== '0');

      if (keysToDelete.length > 0 && keysToDelete.length < 10) { // Safety check
        await redis.del(...keysToDelete);
        console.log(`🗑️  Deleted ${keysToDelete.length} old cache entries`);
      }
    } catch (err) {
      console.error("Failed to delete old keys:", err);
    }

    // Enhanced conversational prompt
    const prompt = `You are a personal financial coach analyzing data for a real user. Be conversational, specific, and actionable—like talking to a friend about their money.

USER'S FINANCIAL SNAPSHOT (Last 30 Days):
💰 Total Income: ₹${totalIncome.toLocaleString('en-IN')}
💸 Total Expenses: ₹${totalExpenses.toLocaleString('en-IN')}
💎 Current Balance: ₹${totalBalance.toLocaleString('en-IN')}
📊 Savings Rate: ${savingsRate.toFixed(1)}%
📈 Daily Spending: ₹${dailyExpenseRate}/day

SPENDING BREAKDOWN:
${expenseCategories.length > 0 ? expenseCategories.map(c => `- ${c._id}: ₹${c.total.toLocaleString('en-IN')} (${((c.total/totalExpenses)*100).toFixed(0)}%)`).join('\n') : '- No expenses recorded'}

INCOME SOURCES:
${incomeCategories.length > 0 ? incomeCategories.map(c => `- ${c._id}: ₹${c.total.toLocaleString('en-IN')}`).join('\n') : '- No income recorded'}

TRENDS (vs Previous Month):
${incomeChange ? `- Income ${incomeChange > 0 ? '↑' : '↓'} ${Math.abs(incomeChange)}%` : '- First month tracked'}
${expenseChange ? `- Expenses ${expenseChange > 0 ? '↑' : '↓'} ${Math.abs(expenseChange)}%` : '- First month tracked'}

RECENT ACTIVITY:
${recentExpenses.length > 0 ? `Top Expenses: ${recentExpenses.slice(0, 3).map(e => `${e.title} (₹${e.amount.toLocaleString('en-IN')})`).join(', ')}` : 'No recent expenses'}

INSTRUCTIONS:
1. **Be SPECIFIC with numbers**: Don't say "good savings"—say "Your ${savingsRate.toFixed(1)}% savings rate means you're keeping ₹${totalBalance.toLocaleString('en-IN')} out of ₹${totalIncome.toLocaleString('en-IN')} earned"
2. **Identify THE biggest insight**: What's the most important thing they should know?
3. **Give ACTIONABLE steps with exact amounts**: Instead of "save more", say "Move ₹10,000 to a recurring deposit earning 7% annually"
4. **Notice patterns in categories**: If a category dominates expenses, call it out specifically
5. **Be encouraging but realistic**: Acknowledge challenges if expenses are climbing
6. **Use conversational tone**: Write like you're texting a friend, not generating a report
7. **Keep it compact for app cards**: the summary title should be 6-10 words and the main summary should stay under 60 words
8. **Make list items easy to scan**: each entry in highlights, smartMoves, and nextSteps must stay under 18 words
9. **Return clean display text**: no markdown, no bullet symbols, and no emojis inside the JSON values

Respond in this EXACT JSON format:
{
  "summaryTitle": "One punchy sentence about their financial situation",
  "insightsSummary": "2-3 conversational sentences that capture the big picture with specific numbers",
  "highlights": [
    "Use SPECIFIC numbers and comparisons from their actual data",
    "Call out the BIGGEST expense category with percentage if applicable",
    "Mention trend with context if data exists"
  ],
  "smartMoves": [
    "Specific action tied to their actual data with real numbers",
    "Investment suggestion with exact amount based on their balance",
    "Automation tip that makes sense for their situation"
  ],
  "aiScore": {
    "financialHealth": "Excellent | Good | Fair | Needs Attention",
    "savingsEfficiency": "Outstanding | High | Moderate | Low",
    "riskLevel": "Very Low | Low | Moderate | High"
  },
  "nextSteps": [
    "Concrete action with deadline based on their financial situation",
    "Specific money move with numbers",
    "Practical tracking suggestion"
  ]
}

CRITICAL: Use ₹ symbol and Indian number formatting. Be SPECIFIC to their data, not generic advice. If they have no expenses or income, acknowledge it and give starter advice.`;

    let response;

    try {
      response = await axios.post(
        getGeminiUrl(),
        {
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.8,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 2048,
            responseMimeType: "application/json"
          }
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    } catch (error) {
      if (isGeminiQuotaError(error)) {
        logGeminiError("AI Summary quota fallback", error);

        const generatedAt = new Date().toISOString();

        return res.json({
          success: true,
          data: financialData,
          overview,
          aiSummary: buildFallbackAISummary(financialData),
          generatedAt,
          cached: false,
          fallback: true,
          notice: "AI limit reached. Showing a simplified summary for now.",
          message: "AI limit reached. Showing a simplified summary for now."
        });
      }

      throw error;
    }

    const rawText = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!rawText) {
      console.error("No response text from Gemini");
      return res.status(500).json({ 
        message: "No response from AI", 
        success: false 
      });
    }

    console.log("Raw Gemini response preview:", rawText.substring(0, 150) + "...");

    let parsed;
    let usedFallbackSummary = false;
    try {
      parsed = normalizeAISummary(parseAIJSON(rawText), financialData);
      console.log("✅ Successfully parsed AI response");
    } catch (e) {
      console.error("Parsing failed:", e.message);
      console.error("Raw text:", rawText);
      parsed = buildFallbackAISummary(financialData);
      usedFallbackSummary = true;
      console.log("Using fallback AI summary based on financial data");
    }

    const generatedAt = new Date().toISOString();

    // Save to Redis cache with TTL
    if (!usedFallbackSummary) {
      try {
        const cacheData = {
          aiSummary: parsed,
          generatedAt
        };
      
        await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(cacheData));
        console.log(`✅ Cached AI summary in Redis (TTL: ${CACHE_TTL}s = 24h)`);
      } catch (cacheError) {
        console.error("Failed to cache in Redis:", cacheError);
      }
    } else {
      console.log("Skipping cache because fallback summary was used");
    }

    res.json({
      success: true,
      data: financialData,
      overview,
      aiSummary: parsed,
      generatedAt,
      cached: false,
      fallback: usedFallbackSummary,
      message: usedFallbackSummary
        ? "Generated fallback AI summary"
        : "Generated new AI summary"
    });
  } catch (err) {
    logGeminiError("AI Summary generation error", err);
    res.status(500).json({
      message: "Something went wrong. Please try again later.",
      success: false,
    });
  }
};

module.exports = {
  generateAISummary,
};
