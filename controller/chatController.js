const axios = require("axios");
const Income = require("../models/Income.js");
const Expense = require("../models/Expense.js");
const Goal = require("../models/Goal.js");
const { Types } = require("mongoose");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const financeBuddyChat = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { message, language } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "User ID not found" });
    }

    if (!message || message.trim() === "") {
      return res.status(400).json({ message: "Message cannot be empty" });
    }

    const userObjectId = new Types.ObjectId(String(userId));

    // Fetch user's financial data
    const [totalIncomeResult] = await Income.aggregate([
      { $match: { userId: userObjectId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const [totalExpenseResult] = await Expense.aggregate([
      { $match: { userId: userObjectId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const expenseCategories = await Expense.aggregate([
      { $match: { userId: userObjectId } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } },
      { $limit: 1 }
    ]);

    const incomeCategories = await Income.aggregate([
      { $match: { userId: userObjectId } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } },
      { $limit: 1 }
    ]);

    const totalIncome = totalIncomeResult?.total || 0;
    const totalExpenses = totalExpenseResult?.total || 0;
    const totalBalance = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0
      ? ((totalIncome - totalExpenses) / totalIncome) * 100
      : 0;

    const topExpenseCategory = expenseCategories[0]?._id || "N/A";
    const topIncomeSource = incomeCategories[0]?._id || "N/A";

    // Fetch user's goals data
    const goals = await Goal.find({ userId: userObjectId });
    const totalGoals = goals.length;
    const activeGoals = goals.filter(goal => goal.progressPercentage < 100).length;
    const completedGoals = goals.filter(goal => goal.progressPercentage >= 100).length;
    const totalTargetAmount = goals.reduce((sum, goal) => sum + (goal.targetAmount || 0), 0);
    const totalCurrentAmount = goals.reduce((sum, goal) => sum + (goal.currentAmount || 0), 0);
    const averageProgress = totalGoals > 0 ? goals.reduce((sum, goal) => sum + (goal.progressPercentage || 0), 0) / totalGoals : 0;
    const highPriorityGoals = goals.filter(goal => goal.priority === 'high').length;

    // Determine language instruction
    const languageInstruction = language === 'hinglish'
      ? 'Respond only in Hinglish language (mix of Hindi and English words). Use Hindi words like "dekh", "teri", "hai", "ye", "vo", "aisa", "achha", "kam", "zyada", "kar", "bacha", "kharche", "income", "expense", "balance", "savings", "budget", "tips", etc. mixed with English. Do not use pure English sentences - always mix Hindi and English words.'
      : 'Respond in English language.';

    // Create context-aware prompt
    const prompt = `You are a helpful and friendly AI financial assistant named "Finance Buddy".

The user's financial data is:
- Total Income: ₹${totalIncome}
- Total Expenses: ₹${totalExpenses}
- Current Balance: ₹${totalBalance}
- Savings Rate: ${savingsRate.toFixed(1)}%
- Top Expense Category: ${topExpenseCategory}
- Top Income Source: ${topIncomeSource}

Goals Information:
- Total Goals: ${totalGoals}
- Active Goals: ${activeGoals}
- Completed Goals: ${completedGoals}
- Total Target Amount: ₹${totalTargetAmount}
- Total Current Amount: ₹${totalCurrentAmount}
- Average Progress: ${averageProgress.toFixed(1)}%
- High Priority Goals: ${highPriorityGoals}

Answer the user's question in a **friendly, human tone**, keeping your responses **short, clear, and actionable**.
Provide practical advice, budgeting tips, or insights based on the user's data.

**Rules:**
1. Avoid long theory or general financial tips; focus on the user's actual data.
2. Include numbers when possible (like percentages, savings suggestions, or amounts).
3. Make it conversational, like a helpful friend giving advice.
4. Keep responses under 5 sentences.
5. Always refer to the user's data when giving suggestions.
6. Use emojis sparingly to keep it friendly.
7. ${languageInstruction}

User's question: "${message}"`;

    // Call Gemini API
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
          maxOutputTokens: 300,
        }
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const botReply = response.data.candidates?.[0]?.content?.parts?.[0]?.text ||
                     "Sorry, I couldn't generate a response. Please try again!";

    res.json({
      success: true,
      reply: botReply.trim(),
      userMessage: message
    });

  } catch (err) {
    console.error("Finance Buddy Chat error:", err);
    res.status(500).json({
      message: "Server Error",
      error: err.message,
      success: false,
    });
  }
};

module.exports = {
  financeBuddyChat,
};
