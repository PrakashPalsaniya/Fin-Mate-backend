const axios = require("axios");
const crypto = require("crypto");
const Income = require("../models/Income.js");
const Expense = require("../models/Expense.js");
const AISummaryCache = require("../models/AISummaryCache.js");
const { Types } = require("mongoose");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Helper function to generate hash from financial data
const generateDataHash = (financialData) => {
  const dataString = JSON.stringify({
    totalIncome: financialData.totalIncome,
    totalExpenses: financialData.totalExpenses,
    expenseCategories: financialData.expenseCategories,
    incomeCategories: financialData.incomeCategories
  });
  
  return crypto.createHash('sha256').update(dataString).digest('hex');
};

// Helper function to extract first valid JSON from text
const extractFirstValidJSON = (text) => {
  // Remove markdown code blocks if present
  let cleanText = text.replace(/``````\s*/g, '');
  
  // Find the first opening brace
  const firstOpen = cleanText.indexOf('{');
  if (firstOpen === -1) {
    throw new Error('No JSON object found in response');
  }

  // Try to find the matching closing brace
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  
  for (let i = firstOpen; i < cleanText.length; i++) {
    const char = cleanText[i];
    
    // Handle escape sequences in strings
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    // Track if we're inside a string
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    // Only count braces outside of strings
    if (!inString) {
      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        
        // Found matching closing brace
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
    console.log("userObjectId:", userObjectId);

    // Fetch Income and Expense Data
    const [totalIncomeResult] = await Income.aggregate([
      { $match: { userId: userObjectId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const [totalExpenseResult] = await Expense.aggregate([
      { $match: { userId: userObjectId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const totalIncome = totalIncomeResult?.total || 0;
    const totalExpenses = totalExpenseResult?.total || 0;
    const totalBalance = totalIncome - totalExpenses;
    const savingsRate =
      totalIncome > 0
        ? ((totalIncome - totalExpenses) / totalIncome) * 100
        : 0;

    // Expense categories
    const expenseCategories = await Expense.aggregate([
      { $match: { userId: userObjectId } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } },
    ]);

    // Income categories
    const incomeCategories = await Income.aggregate([
      { $match: { userId: userObjectId } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } },
    ]);

    // Recent transactions
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
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

    // Prepare data
    const financialData = {
      totalIncome,
      totalExpenses,
      totalBalance,
      savingsRate: parseFloat(savingsRate.toFixed(2)),
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

    // Generate hash of current financial data
    const currentDataHash = generateDataHash(financialData);
    console.log("Current data hash:", currentDataHash);

    // Check if we have a cached summary with the same hash
    const cachedSummary = await AISummaryCache.findOne({
      userId: userObjectId,
      dataHash: currentDataHash
    });

    if (cachedSummary) {
      console.log("✅ Cache HIT - Returning cached AI summary");
      return res.json({
        success: true,
        data: financialData,
        aiSummary: cachedSummary.aiSummary,
        generatedAt: cachedSummary.generatedAt.toISOString(),
        cached: true,
        message: "Returned cached summary (data unchanged)"
      });
    }

    console.log("❌ Cache MISS - Generating new AI summary");

    // Gemini Prompt with stronger JSON instructions
    const prompt = `You are an expert AI financial assistant. Analyze the following user's financial data and create an engaging, compact, and useful summary that looks visually appealing inside a dashboard card.

✅ Structure your response as JSON in this EXACT format (no extra text before or after):
{
  "summaryTitle": "Short catchy title about the user's financial situation",
  "highlights": [
    "💰 Key insight #1 about income/spending balance",
    "📊 Key insight #2 about growth or savings rate",
    "⚡ Key insight #3 on unusual trends or smart moves"
  ],
  "smartMoves": [
    "✅ Practical tip #1 to save or invest better",
    "✅ Practical tip #2 about spending or budgeting",
    "✅ Practical tip #3 about long-term financial habits"
  ],
  "aiScore": {
    "financialHealth": "Good | Moderate | Poor",
    "savingsEfficiency": "High | Medium | Low",
    "riskLevel": "Low | Medium | High"
  },
  "nextSteps": [
    "🚀 Simple, actionable suggestion #1 for the user",
    "💡 Simple, actionable suggestion #2 for upcoming month"
  ]
}

✨ Tone:
- Use emojis and compact bullet points (max 2 lines each).
- Be realistic, positive, and insightful — no generic advice.
- Do NOT add long explanations, just clear and useful insights.
-Every Balance Shown IN INR whether expense ,income or balance 
📊 Financial Data:
${JSON.stringify(financialData, null, 2)}

IMPORTANT: Return ONLY ONE valid JSON object. Do not generate multiple variations. No markdown formatting, no extra text.`;

    // Gemini REST API Call with response schema
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
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
          responseMimeType: "application/json"
        }
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    // Extract text safely
    const rawText =
      response.data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!rawText) {
      console.error("No response text from Gemini");
      return res.status(500).json({ 
        message: "No response from AI", 
        success: false 
      });
    }

    console.log("Raw Gemini response:", rawText.substring(0, 200) + "...");

    let parsed;
    try {
      // Try extracting first valid JSON
      parsed = extractFirstValidJSON(rawText);
      console.log("✅ Successfully parsed AI response");
    } catch (e) {
      console.error("Parsing failed:", e.message);
      console.error("Raw text:", rawText);
      return res.status(500).json({ 
        message: "Failed to parse AI response", 
        error: e.message,
        raw: rawText,
        success: false 
      });
    }

    // Save to cache
    try {
      await AISummaryCache.findOneAndUpdate(
        { userId: userObjectId },
        {
          userId: userObjectId,
          dataHash: currentDataHash,
          financialData: financialData,
          aiSummary: parsed,
          generatedAt: new Date()
        },
        { upsert: true, new: true }
      );
      console.log("✅ Cached new AI summary");
    } catch (cacheError) {
      console.error("Failed to cache summary:", cacheError);
    }

    res.json({
      success: true,
      data: financialData,
      aiSummary: parsed,
      generatedAt: new Date().toISOString(),
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
