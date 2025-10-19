const axios = require("axios");
const crypto = require("crypto");
const Income = require("../models/Income.js");
const Expense = require("../models/Expense.js");
const redis = require("../config/redis.js");
const { Types } = require("mongoose");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
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

// Helper function to extract first valid JSON from text
const extractFirstValidJSON = (text) => {
  let cleanText = text.replace(/``````\s*/g, '');
  
  const firstOpen = cleanText.indexOf('{');
  if (firstOpen === -1) {
    throw new Error('No JSON object found in response');
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
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        
        if (braceCount === 0) {
          const jsonStr = cleanText.substring(firstOpen, i + 1);
          try {
            return JSON.parse(jsonStr);
          } catch (e) {
            throw new Error(`Failed to parse extracted JSON: ${e.message}`);
          }
        }
      }
    }
  }
  
  throw new Error('Could not find complete JSON object');
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
          aiSummary: parsedCache.aiSummary,
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
    "Specific goal suggestion with numbers",
    "Practical tracking suggestion"
  ]
}

CRITICAL: Use ₹ symbol and Indian number formatting. Be SPECIFIC to their data, not generic advice. If they have no expenses or income, acknowledge it and give starter advice.`;

    // Gemini REST API Call
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
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
    try {
      parsed = extractFirstValidJSON(rawText);
      console.log("✅ Successfully parsed AI response");
    } catch (e) {
      console.error("Parsing failed:", e.message);
      console.error("Raw text:", rawText);
      return res.status(500).json({ 
        message: "Failed to parse AI response", 
        error: e.message,
        success: false 
      });
    }

    const generatedAt = new Date().toISOString();

    // Save to Redis cache with TTL
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

    res.json({
      success: true,
      data: financialData,
      aiSummary: parsed,
      generatedAt,
      cached: false,
      message: "Generated new AI summary"
    });
  } catch (err) {
    console.error("AI Summary generation error:", err);
    res.status(500).json({
      message: "Server Error",
      error: err.message,
      success: false,
    });
  }
};

module.exports = {
  generateAISummary,
};
