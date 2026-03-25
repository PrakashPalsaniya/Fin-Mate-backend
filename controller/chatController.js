const axios = require("axios");
const { Types } = require("mongoose");
const Income = require("../models/Income.js");
const Expense = require("../models/Expense.js");
const {
  getGeminiUrl,
  isGeminiQuotaError,
  logGeminiError,
} = require("../utils/geminiClient.js");

const financeBuddyChat = async (req, res) => {
  const { message, language } = req.body || {};

  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(400).json({ message: "User ID not found" });
    }

    if (!message || message.trim() === "") {
      return res.status(400).json({ message: "Message cannot be empty" });
    }

    const userObjectId = new Types.ObjectId(String(userId));
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
      { $limit: 3 },
    ]);

    const incomeCategories = await Income.aggregate([
      { $match: { userId: userObjectId } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } },
      { $limit: 2 },
    ]);

    const recentExpenses = await Expense.find({ userId })
      .sort({ date: -1 })
      .limit(5)
      .select("title amount category date");

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

    const languageInstruction = language === "hinglish"
      ? `LANGUAGE: Respond ONLY in Hinglish (Hindi-English mix). Examples:
      - "Dekh bhai, tera spending bahut zyada hai"
      - "Tu monthly Rs 5000 save kar sakta hai easily"
      - "Ek trick hai - daily expenses ko track kar"
      - "Tera top expense Entertainment hai, isme thoda control rakh"
      Use words like: dekh, bhai, tera/tere, hai, ye, vo, kya, kaise, kar, bacha, zyada, kam, achha, bura, chalega, hoga, etc.`
      : "LANGUAGE: Respond in natural, conversational English.";

    const prompt = `You are "Finance Buddy" - a chill, friendly AI who helps with money stuff. You're like that smart friend who's good with finances but doesn't lecture.

USER'S FINANCIAL CONTEXT:
- Monthly Income (last 30 days): Rs ${recentIncome.toLocaleString("en-IN")}
- Monthly Expenses (last 30 days): Rs ${recentExpense.toLocaleString("en-IN")}
- Current Balance: Rs ${totalBalance.toLocaleString("en-IN")}
- Savings Rate: ${savingsRate.toFixed(0)}%
- Top Spending: ${topExpenseCategory} (Rs ${topExpenseAmount.toLocaleString("en-IN")})
${incomeCategories.length > 0 ? `- Top Income Sources: ${incomeCategories.map((item) => `${item._id} (Rs ${item.total.toLocaleString("en-IN")})`).join(", ")}` : ""}
${recentExpenses.length > 0 ? `- Recent Expenses: ${recentExpenses.slice(0, 3).map((item) => `${item.title} (Rs ${item.amount})`).join(", ")}` : ""}

YOUR TONE & STYLE:
- Talk like a friend, not a financial advisor
- Be supportive and encouraging, never judgmental
- Use "you/your" (or "tu/tera" in Hinglish), make it personal
- Give one specific, actionable tip when relevant
- Keep it short (2-4 sentences max)
- Reference their actual data when it makes sense
- If they ask about debt, budgeting, saving, or spending, give practical steps with numbers from their data

DON'T:
- Just list their stats back at them
- Give generic advice without specifics
- Sound formal or robotic
- Write long paragraphs

${languageInstruction}

EXAMPLES OF GOOD RESPONSES:

English:
Q: "How can I save more money?"
A: "Looking at your spending, you're dropping Rs ${topExpenseAmount.toLocaleString("en-IN")} on ${topExpenseCategory}. If you cut that by 20%, you'd save around Rs ${Math.round(topExpenseAmount * 0.2).toLocaleString("en-IN")} monthly. That's a simple place to start."

Q: "Should I invest?"
A: "You're saving about ${savingsRate.toFixed(0)}% right now, which is a good base. Before investing, try building 3 months of expenses first, around Rs ${Math.round(recentExpense * 3).toLocaleString("en-IN")}. After that, a small SIP could make sense."

Hinglish:
Q: "Paisa kaise bachau?"
A: "Dekh bhai, tera ${topExpenseCategory} mein Rs ${topExpenseAmount.toLocaleString("en-IN")} ja raha hai. Isko thoda cut karega toh monthly saving dikhegi. Start wahi se kar."

Q: "Mujhe debt clear karna hai"
A: "Sahi move hai. Tera monthly income Rs ${recentIncome.toLocaleString("en-IN")} hai aur expenses Rs ${recentExpense.toLocaleString("en-IN")}, matlab roughly Rs ${(recentIncome - recentExpense).toLocaleString("en-IN")} bach raha. Is extra amount ko debt pe focus kar aur ${topExpenseCategory} thoda control kar."

NOW ANSWER THIS:
User's question: "${message}"

Remember: Be helpful, specific, and use their real numbers. Make it conversational.`;

    const response = await axios.post(
      getGeminiUrl(),
      {
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.9,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 400,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const botReply =
      response.data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Something went wrong on my end. Try asking again.";

    res.json({
      success: true,
      reply: botReply.trim(),
      userMessage: message,
    });
  } catch (err) {
    if (isGeminiQuotaError(err)) {
      logGeminiError("Finance Buddy Chat quota fallback", err);
      return res.status(200).json({
        success: true,
        reply:
          "Finance Buddy is temporarily unavailable because the AI limit has been reached. Please try again in a few minutes.",
        userMessage: message,
        fallback: true,
      });
    }

    logGeminiError("Finance Buddy Chat error", err);
    res.status(500).json({
      message: "Something went wrong. Please try again later.",
      success: false,
    });
  }
};

module.exports = {
  financeBuddyChat,
};
