const mongoose = require("mongoose");

const milestoneSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true
  },
  targetDate: {
    type: Date,
    required: true
  },
  achieved: {
    type: Boolean,
    default: false
  },
  achievedDate: {
    type: Date
  },
  description: {
    type: String,
    required: true
  }
});

const goalSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "User",
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  goalType: {
    type: String,
    required: true,
    enum: ["savings", "debt_payoff", "expense_reduction", "investment", "emergency_fund", "other"]
  },
  priority: {
    type: String,
    required: true,
    enum: ["low", "medium", "high"],
    default: "medium"
  },
  duration: {
    type: String,
    required: true,
    enum: ["short_term", "long_term"], // short_term: weekly/monthly, long_term: 6-12 months
  },
  targetAmount: {
    type: Number,
    required: true
  },
  currentAmount: {
    type: Number,
    default: 0
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  targetDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ["active", "completed", "paused", "cancelled"],
    default: "active"
  },
  milestones: [milestoneSchema],
  category: {
    type: String, // For expense reduction goals - which category to reduce
    trim: true
  },
  linkedTransactions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Transaction"
  }],
  aiInsights: {
    lastAnalyzed: Date,
    suggestions: [String],
    estimatedCompletion: Date,
    onTrack: Boolean
  },
  notifications: {
    milestoneReminders: {
      type: Boolean,
      default: true
    },
    progressAlerts: {
      type: Boolean,
      default: true
    },
    weeklyUpdates: {
      type: Boolean,
      default: true
    }
  }
}, {
  timestamps: true
});

// Index for efficient queries
goalSchema.index({ userId: 1, status: 1 });
goalSchema.index({ userId: 1, targetDate: 1 });

// Virtual for progress percentage
goalSchema.virtual('progressPercentage').get(function() {
  if (this.targetAmount === 0) return 0;
  return Math.min((this.currentAmount / this.targetAmount) * 100, 100);
});

// Virtual for days remaining
goalSchema.virtual('daysRemaining').get(function() {
  const now = new Date();
  const target = new Date(this.targetDate);
  const diffTime = target - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

goalSchema.set('toJSON', { virtuals: true });
goalSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model("Goal", goalSchema);
