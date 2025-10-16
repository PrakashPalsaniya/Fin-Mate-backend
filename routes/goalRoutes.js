const express = require("express");
const router = express.Router();
const {
  createGoal,
  getGoals,
  getGoalById,
  updateGoalProgress,
  updateGoal,
  deleteGoal,
  getGoalInsights,
  getGoalsSummary,
  getGoalsAIInsights
} = require("../controller/goalController.js");
const { protect } = require("../middlewares/authMiddleware.js");

router.post("/", protect, createGoal);
router.get("/", protect, getGoals);
router.get("/summary", protect, getGoalsSummary);
router.get("/ai-insights", protect, getGoalsAIInsights);
router.get("/:id", protect, getGoalById);
router.patch("/:id/progress", protect, updateGoalProgress);
router.put("/:id", protect, updateGoal);
router.delete("/:id", protect, deleteGoal);
router.get("/:id/insights", protect, getGoalInsights);

module.exports = router;
