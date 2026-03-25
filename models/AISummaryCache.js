const mongoose = require("mongoose");

const aiSummaryCacheSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: "User",
    index: true
  },
  dataHash: {
    type: String,
    required: true,
    index: true
  },
  dataType: {
    type: String,
    required: true,
    enum: ["financial"],
    default: "financial"
  },
  financialData: {
    type: Object,
    required: true
  },
  aiSummary: {
    type: Object,
    required: true
  },
  generatedAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index for fast lookups
aiSummaryCacheSchema.index({ userId: 1, dataHash: 1, dataType: 1 }, { unique: true });

module.exports = mongoose.model("AISummaryCache", aiSummaryCacheSchema);
