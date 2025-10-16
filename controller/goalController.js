const Goal = require("../models/Goal.js");
const Income = require("../models/Income.js");
const Expense = require("../models/Expense.js");
const AISummaryCache = require("../models/AISummaryCache.js");
const { Types } = require("mongoose");
const axios = require("axios");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Create a new goal
const createGoal = async (req, res) => {
  try {
    const userId = req.user?.id;
    const {
      title,
      description,
      goalType,
      priority,
      duration,
      targetAmount,
      targetDate,
      category,
      milestones
    } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "User ID not found" });
    }

    // Validate required fields
    if (!title || !goalType || !targetAmount || !targetDate) {
      return res.status(400).json({
        message: "Title, goal type, target amount, and target date are required"
      });
    }

    const goal = await Goal.create({
      userId,
      title,
      description,
      goalType,
      priority: priority || "medium",
      duration: duration || "short_term",
      targetAmount,
      targetDate,
      category,
      milestones: milestones || []
    });

    res.status(201).json({
      success: true,
      message: "Goal created successfully",
      goal
    });
  } catch (err) {
    console.error("Create goal error:", err);
    res.status(500).json({
      message: "Server Error",
      error: err.message,
      success: false
    });
  }
};

// Get all goals for a user
const getGoals = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { status, priority, goalType } = req.query;

    if (!userId) {
      return res.status(400).json({ message: "User ID not found" });
    }

    const filter = { userId };
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (goalType) filter.goalType = goalType;

    const goals = await Goal.find(filter).sort({ priority: -1, targetDate: 1 });

    res.json({
      success: true,
      count: goals.length,
      goals
    });
  } catch (err) {
    console.error("Get goals error:", err);
    res.status(500).json({
      message: "Server Error",
      error: err.message,
      success: false
    });
  }
};

// Get single goal by ID
const getGoalById = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "User ID not found" });
    }

    const goal = await Goal.findOne({ _id: id, userId });

    if (!goal) {
      return res.status(404).json({ message: "Goal not found" });
    }

    res.json({
      success: true,
      goal
    });
  } catch (err) {
    console.error("Get goal error:", err);
    res.status(500).json({
      message: "Server Error",
      error: err.message,
      success: false
    });
  }
};

// Update goal progress
const updateGoalProgress = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const { amount } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "User ID not found" });
    }

    const goal = await Goal.findOne({ _id: id, userId });

    if (!goal) {
      return res.status(404).json({ message: "Goal not found" });
    }

    // Update current amount by adding the new amount
    goal.currentAmount = Math.min(goal.currentAmount + amount, goal.targetAmount);

    // Check if goal is completed
    if (goal.currentAmount >= goal.targetAmount) {
      goal.status = "completed";
    }

    // Check and update milestone achievements
    goal.milestones.forEach(milestone => {
      if (!milestone.achieved && goal.currentAmount >= milestone.amount) {
        milestone.achieved = true;
        milestone.achievedDate = new Date();
      }
    });

    await goal.save();

    res.json({
      success: true,
      message: "Goal progress updated",
      goal
    });
  } catch (err) {
    console.error("Update goal progress error:", err);
    res.status(500).json({
      message: "Server Error",
      error: err.message,
      success: false
    });
  }
};

// Update goal details
const updateGoal = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "User ID not found" });
    }

    const goal = await Goal.findOneAndUpdate(
      { _id: id, userId },
      { $set: req.body },
      { new: true, runValidators: true }
    );

    if (!goal) {
      return res.status(404).json({ message: "Goal not found" });
    }

    res.json({
      success: true,
      message: "Goal updated successfully",
      goal
    });
  } catch (err) {
    console.error("Update goal error:", err);
    res.status(500).json({
      message: "Server Error",
      error: err.message,
      success: false
    });
  }
};

// Delete goal
const deleteGoal = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "User ID not found" });
    }

    const goal = await Goal.findOneAndDelete({ _id: id, userId });

    if (!goal) {
      return res.status(404).json({ message: "Goal not found" });
    }

    res.json({
      success: true,
      message: "Goal deleted successfully"
    });
  } catch (err) {
    console.error("Delete goal error:", err);
    res.status(500).json({
      message: "Server Error",
      error: err.message,
      success: false
    });
  }
};

// Get AI-powered goal insights
const getGoalInsights = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "User ID not found" });
    }

    const userObjectId = new Types.ObjectId(String(userId));
    const goal = await Goal.findOne({ _id: id, userId });

    if (!goal) {
      return res.status(404).json({ message: "Goal not found" });
    }

    // Fetch recent financial data (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalIncomeResult] = await Income.aggregate([
      { $match: { userId: userObjectId, date: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const [totalExpenseResult] = await Expense.aggregate([
      { $match: { userId: userObjectId, date: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const categoryExpenses = await Expense.aggregate([
      { $match: { userId: userObjectId, date: { $gte: thirtyDaysAgo } } },
      { $group: { _id: "$category", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } }
    ]);

    const monthlyIncome = totalIncomeResult?.total || 0;
    const monthlyExpenses = totalExpenseResult?.total || 0;
    const monthlySavings = monthlyIncome - monthlyExpenses;

    // Calculate estimated completion date
    const remainingAmount = goal.targetAmount - goal.currentAmount;
    const estimatedMonths = monthlySavings > 0
      ? Math.ceil(remainingAmount / monthlySavings)
      : null;

    const estimatedCompletion = estimatedMonths
      ? new Date(Date.now() + estimatedMonths * 30 * 24 * 60 * 60 * 1000)
      : null;

    // Create AI prompt for insights
    const prompt = `You are a financial advisor analyzing a user's goal progress.

Goal Details:
- Goal: ${goal.title}
- Type: ${goal.goalType}
- Target Amount: ₹${goal.targetAmount}
- Current Progress: ₹${goal.currentAmount} (${goal.progressPercentage.toFixed(1)}%)
- Days Remaining: ${goal.daysRemaining}
- Priority: ${goal.priority}

User's Financial Data (Last 30 Days):
- Monthly Income: ₹${monthlyIncome}
- Monthly Expenses: ₹${monthlyExpenses}
- Monthly Savings: ₹${monthlySavings}
- Top Expense Categories: ${categoryExpenses.slice(0, 3).map(c => `${c._id}: ₹${c.total}`).join(', ')}

Provide:
1. **On Track Status**: Is the user on track? (Yes/No and why)
2. **3 Actionable Suggestions**: Practical, specific tips to achieve this goal faster
3. **Risk Alert**: Any spending patterns that could derail progress?

Keep response under 200 words. Be direct, friendly, and actionable. Use ₹ symbol.

Format as JSON:
{
  "onTrack": true/false,
  "trackingStatus": "Brief explanation",
  "suggestions": ["Tip 1", "Tip 2", "Tip 3"],
  "riskAlert": "Any warning or null if none"
}`;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500,
          responseMimeType: "application/json"
        }
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const rawText = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let insights;

    try {
      insights = JSON.parse(rawText);
    } catch (e) {
      insights = {
        onTrack: monthlySavings > 0,
        trackingStatus: "Unable to generate detailed insights",
        suggestions: ["Continue monitoring your progress", "Review spending patterns", "Consider increasing savings rate"],
        riskAlert: null
      };
    }

    // Update goal with insights
    goal.aiInsights = {
      lastAnalyzed: new Date(),
      suggestions: insights.suggestions || [],
      estimatedCompletion: estimatedCompletion,
      onTrack: insights.onTrack
    };

    await goal.save();

    res.json({
      success: true,
      insights: {
        ...insights,
        estimatedCompletion,
        monthlyRequiredSavings: goal.daysRemaining > 0
          ? Math.ceil((goal.targetAmount - goal.currentAmount) / (goal.daysRemaining / 30))
          : 0,
        currentMonthlySavings: monthlySavings
      }
    });

  } catch (err) {
    console.error("Get goal insights error:", err);
    res.status(500).json({
      message: "Server Error",
      error: err.message,
      success: false
    });
  }
};

// Get dashboard summary of all goals
const getGoalsSummary = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(400).json({ message: "User ID not found" });
    }

    const goals = await Goal.find({ userId, status: "active" }).sort({ priority: -1 });

    const summary = {
      totalGoals: goals.length,
      highPriority: goals.filter(g => g.priority === "high").length,
      totalTargetAmount: goals.reduce((sum, g) => sum + g.targetAmount, 0),
      totalCurrentAmount: goals.reduce((sum, g) => sum + g.currentAmount, 0),
      averageProgress: goals.length > 0
        ? goals.reduce((sum, g) => sum + g.progressPercentage, 0) / goals.length
        : 0,
      upcomingMilestones: goals.flatMap(g =>
        g.milestones
          .filter(m => !m.achieved && new Date(m.targetDate) > new Date() && new Date(m.targetDate) <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
          .map(m => ({
            goalId: g._id,
            goalTitle: g.title,
            amount: m.amount,
            targetDate: m.targetDate,
            description: m.description
          }))
      )
    };

    res.json({
      success: true,
      summary
    });
  } catch (err) {
    console.error("Get goals summary error:", err);
    res.status(500).json({
      message: "Server Error",
      error: err.message,
      success: false
    });
  }
};

const crypto = require("crypto");

// Helper function to generate hash from goals data
const generateGoalsDataHash = (goalsData) => {
  const dataString = JSON.stringify({
    totalGoals: goalsData.totalGoals,
    totalTargetAmount: goalsData.totalTargetAmount,
    totalCurrentAmount: goalsData.totalCurrentAmount,
    goals: goalsData.goals.map(g => ({
      title: g.title,
      goalType: g.goalType,
      priority: g.priority,
      targetAmount: g.targetAmount,
      currentAmount: g.currentAmount,
      targetDate: g.targetDate
    }))
  });

  return crypto.createHash('sha256').update(dataString).digest('hex');
};

// Get AI-powered insights for all goals combined
const getGoalsAIInsights = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(400).json({ message: "User ID not found" });
    }

    const userObjectId = new Types.ObjectId(String(userId));

    // Fetch all active goals
    const goals = await Goal.find({ userId, status: "active" }).sort({ priority: -1, targetDate: 1 });

    if (goals.length === 0) {
      return res.json({
        success: true,
        insights: {
          summaryTitle: "No Active Goals",
          highlights: ["You don't have any active goals yet"],
          smartMoves: ["Create your first financial goal to get started"],
          aiScore: {
            goalAchievement: "N/A",
            progressEfficiency: "N/A",
            riskLevel: "N/A"
          },
          nextSteps: ["Add goals to track your financial progress"]
        },
        goalsData: {
          totalGoals: 0,
          goals: []
        }
      });
    }

    // Calculate aggregated data
    const goalsData = {
      totalGoals: goals.length,
      highPriority: goals.filter(g => g.priority === "high").length,
      totalTargetAmount: goals.reduce((sum, g) => sum + g.targetAmount, 0),
      totalCurrentAmount: goals.reduce((sum, g) => sum + g.currentAmount, 0),
      averageProgress: goals.length > 0
        ? goals.reduce((sum, g) => sum + g.progressPercentage, 0) / goals.length
        : 0,
      goals: goals.map(g => ({
        title: g.title,
        goalType: g.goalType,
        priority: g.priority,
        targetAmount: g.targetAmount,
        currentAmount: g.currentAmount,
        progressPercentage: g.progressPercentage,
        daysRemaining: g.daysRemaining,
        targetDate: g.targetDate
      }))
    };

    // Generate hash of current goals data
    const currentDataHash = generateGoalsDataHash(goalsData);

    // Check if we have a cached summary with the same hash
    const cachedInsights = await AISummaryCache.findOne({
      userId: userObjectId,
      dataHash: currentDataHash,
      dataType: "goals"
    });

    if (cachedInsights) {
      console.log("✅ Cache HIT - Returning cached goals AI insights");
      return res.json({
        success: true,
        insights: cachedInsights.aiSummary,
        goalsData,
        generatedAt: cachedInsights.generatedAt.toISOString(),
        cached: true,
        message: "Returned cached goals insights (data unchanged)"
      });
    }

    console.log("❌ Cache MISS - Generating new goals AI insights");

    // Create AI prompt for combined goals insights
    const prompt = `You are an expert financial advisor analyzing a user's combined goals progress.

Goals Summary:
- Total Goals: ${goalsData.totalGoals}
- High Priority Goals: ${goalsData.highPriority}
- Total Target Amount: ₹${goalsData.totalTargetAmount}
- Total Current Amount: ₹${goalsData.totalCurrentAmount}
- Average Progress: ${goalsData.averageProgress.toFixed(1)}%

Individual Goals:
${goalsData.goals.map(g => `- ${g.title} (${g.goalType}): ₹${g.currentAmount}/₹${g.targetAmount} (${g.progressPercentage.toFixed(1)}%) - ${g.daysRemaining >= 0 ? `${g.daysRemaining} days left` : 'Overdue'} - Priority: ${g.priority}`).join('\n')}

Provide:
1. **Summary Title**: A catchy title about their overall goals progress
2. **3 Key Highlights**: Main insights about their goals portfolio
3. **3 Smart Moves**: Practical advice for better goal management
4. **AI Score**: Evaluate goal achievement, progress efficiency, and risk level
5. **3 Next Steps**: Actionable recommendations

Keep response under 250 words. Be direct, friendly, and actionable. Use ₹ symbol for amounts.

Format as JSON:
{
  "summaryTitle": "Short catchy title",
  "highlights": ["Highlight 1", "Highlight 2", "Highlight 3"],
  "smartMoves": ["Smart move 1", "Smart move 2", "Smart move 3"],
  "aiScore": {
    "goalAchievement": "Excellent | Good | Moderate | Poor",
    "progressEfficiency": "High | Medium | Low",
    "riskLevel": "Low | Medium | High"
  },
  "nextSteps": ["Next step 1", "Next step 2", "Next step 3"]
}`;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 600,
          responseMimeType: "application/json"
        }
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const rawText = response.data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let insights;

    try {
      insights = JSON.parse(rawText);
    } catch (e) {
      insights = {
        summaryTitle: "Goals Progress Overview",
        highlights: ["Keep tracking your goals regularly", "Focus on high-priority goals first", "Review progress monthly"],
        smartMoves: ["Set realistic timelines", "Break large goals into milestones", "Automate savings where possible"],
        aiScore: {
          goalAchievement: "Moderate",
          progressEfficiency: "Medium",
          riskLevel: "Medium"
        },
        nextSteps: ["Update progress regularly", "Reassess priorities", "Celebrate small wins"]
      };
    }

    // Save to cache
    try {
      await AISummaryCache.findOneAndUpdate(
        { userId: userObjectId, dataType: "goals" },
        {
          userId: userObjectId,
          dataHash: currentDataHash,
          dataType: "goals",
          financialData: goalsData,
          aiSummary: insights,
          generatedAt: new Date()
        },
        { upsert: true, new: true }
      );
      console.log("✅ Cached new goals AI insights");
    } catch (cacheError) {
      console.error("Failed to cache goals insights:", cacheError);
    }

    res.json({
      success: true,
      insights,
      goalsData,
      generatedAt: new Date().toISOString(),
      cached: false,
      message: "Generated new goals AI insights"
    });

  } catch (err) {
    console.error("Get goals AI insights error:", err);
    res.status(500).json({
      message: "Server Error",
      error: err.message,
      success: false
    });
  }
};

module.exports = {
  createGoal,
  getGoals,
  getGoalById,
  updateGoalProgress,
  updateGoal,
  deleteGoal,
  getGoalInsights,
  getGoalsSummary,
  getGoalsAIInsights
};
