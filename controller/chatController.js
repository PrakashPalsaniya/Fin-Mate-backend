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
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalIncomeResult] = await Income.aggregate([
      { $match: { userId: userObjectId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const [recentIncomeResult] = await Income.aggregate([
      { $match: { userId: userObjectId, date: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const [totalExpenseResult] = await Expense.aggregate([
      { $match: { userId: userObjectId } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const [recentExpenseResult] = await Expense.aggregate([
      { $match: { userId: userObjectId, date: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const expenseCategories = await Expense.aggregate([
      { $match: { userId: userObjectId } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } },
      { $limit: 3 }
    ]);

    const incomeCategories = await Income.aggregate([
      { $match: { userId: userObjectId } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } },
      { $limit: 2 }
    ]);

    // Recent transactions for context
    const recentExpenses = await Expense.find({ userId })
      .sort({ date: -1 })
      .limit(5)
      .select('title amount category date');

    const totalIncome = totalIncomeResult?.total || 0;
    const totalExpenses = totalExpenseResult?.total || 0;
    const recentIncome = recentIncomeResult?.total || 0;
    const recentExpense = recentExpenseResult?.total || 0;
    const totalBalance = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0
      ? ((totalIncome - totalExpenses) / totalIncome) * 100
      : 0;

    const topExpenseCategory = expenseCategories[0]?._id || "N/A";
    const topExpenseAmount = expenseCategories[0]?.total || 0;

    // Fetch user's goals data
    const goals = await Goal.find({ userId: userObjectId }).sort({ priority: -1, deadline: 1 });
    const totalGoals = goals.length;
    const activeGoals = goals.filter(goal => goal.progressPercentage < 100);
    const completedGoals = goals.filter(goal => goal.progressPercentage >= 100).length;
    const totalTargetAmount = goals.reduce((sum, goal) => sum + (goal.targetAmount || 0), 0);
    const totalCurrentAmount = goals.reduce((sum, goal) => sum + (goal.currentAmount || 0), 0);
    const shortfall = totalTargetAmount - totalCurrentAmount;

    // Get most urgent goal
    const urgentGoal = activeGoals.length > 0 ? activeGoals[0] : null;

    // Determine language instruction
    const languageInstruction = language === 'hinglish'
      ? `LANGUAGE: Respond ONLY in Hinglish (Hindi-English mix). Examples:
      - "Dekh bhai, tera spending bahut zyada hai"
      - "Tu monthly ₹5000 save kar sakta hai easily"
      - "Ek trick hai - daily expenses ko track kar"
      - "Tera top expense Entertainment hai, isme thoda control rakh"
      Use words like: dekh, bhai, tera/tere, hai, ye, vo, kya, kaise, kar, bacha, zyada, kam, achha, bura, chalega, hoga, etc.`
      : 'LANGUAGE: Respond in natural, conversational English.';

    // Enhanced context-aware prompt
    const prompt = `You are "Finance Buddy" - a chill, friendly AI who helps with money stuff. You're like that smart friend who's good with finances but doesn't lecture.

USER'S FINANCIAL CONTEXT:
💰 Monthly Income (last 30 days): ₹${recentIncome.toLocaleString('en-IN')}
💸 Monthly Expenses (last 30 days): ₹${recentExpense.toLocaleString('en-IN')}
💎 Current Balance: ₹${totalBalance.toLocaleString('en-IN')}
📊 Savings Rate: ${savingsRate.toFixed(0)}%
🎯 Top Spending: ${topExpenseCategory} (₹${topExpenseAmount.toLocaleString('en-IN')})

${recentExpenses.length > 0 ? `Recent Expenses: ${recentExpenses.slice(0, 3).map(e => `${e.title} (₹${e.amount})`).join(', ')}` : ''}

GOALS STATUS:
${totalGoals > 0 ? `
- Total Goals: ${totalGoals} (${activeGoals.length} active, ${completedGoals} done ✅)
- Need to save: ₹${shortfall.toLocaleString('en-IN')} more
${urgentGoal ? `- Next Goal: "${urgentGoal.name}" - ₹${urgentGoal.currentAmount.toLocaleString('en-IN')} / ₹${urgentGoal.targetAmount.toLocaleString('en-IN')} (${urgentGoal.progressPercentage.toFixed(0)}% done)` : ''}
` : '- No goals set yet'}

YOUR TONE & STYLE:
✅ Talk like a friend, not a financial advisor
✅ Be supportive and encouraging, never judgmental
✅ Use "you/your" (or "tu/tera" in Hinglish), make it personal
✅ Give ONE specific, actionable tip when relevant
✅ Keep it SHORT (2-4 sentences max)
✅ Use emojis occasionally but not excessively
✅ Reference their ACTUAL data when it makes sense
✅ If they ask about debt, budgeting, saving - give practical steps with numbers from their data

❌ DON'T just list their stats back at them
❌ DON'T give generic advice like "make a budget" without specifics
❌ DON'T be formal or robotic
❌ DON'T write long paragraphs

${languageInstruction}

EXAMPLES OF GOOD RESPONSES:

English:
Q: "How can I save more money?"
A: "Looking at your spending, you're dropping ₹${topExpenseAmount.toLocaleString('en-IN')} on ${topExpenseCategory}. If you cut that by just 20%, you'd save ₹${Math.round(topExpenseAmount * 0.2).toLocaleString('en-IN')} monthly. That's ₹${Math.round(topExpenseAmount * 0.2 * 12).toLocaleString('en-IN')} a year! 💰"

Q: "Should I invest?"
A: "You're saving ${savingsRate.toFixed(0)}% right now, which is solid! Before investing, make sure you have 3-6 months of expenses (around ₹${Math.round(recentExpense * 3).toLocaleString('en-IN')}) as emergency fund. After that, start with a mutual fund SIP of ₹2000-3000 monthly."

Hinglish:
Q: "Paisa kaise bachau?"
A: "Dekh bhai, tera ${topExpenseCategory} mein ₹${topExpenseAmount.toLocaleString('en-IN')} ja raha hai. Isko 20% kam kar de, toh monthly ₹${Math.round(topExpenseAmount * 0.2).toLocaleString('en-IN')} bach jayega. Easy hai! 💪"

Q: "Mujhe debt clear karna hai"
A: "Solid goal! Tera monthly income ₹${recentIncome.toLocaleString('en-IN')} hai aur expenses ₹${recentExpense.toLocaleString('en-IN')}. Matlab ₹${(recentIncome - recentExpense).toLocaleString('en-IN')} bach raha. Isko debt pe lagao, aur side se top expense ${topExpenseCategory} ko control karo."

NOW ANSWER THIS:
User's question: "${message}"

Remember: Be helpful, specific, and use their real numbers. Make it conversational!`;

    // Call Gemini API with higher token limit for better responses
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
          temperature: 0.9, // Higher for more natural conversation
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 400, // Increased for better responses
        }
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const botReply = response.data.candidates?.[0]?.content?.parts?.[0]?.text ||
                     "Yo, something went wrong on my end. Try asking again? 🤔";

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
