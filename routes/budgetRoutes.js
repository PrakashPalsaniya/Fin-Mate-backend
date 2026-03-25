const express = require("express");
const {
    addBudget,
    editBudget,
    getBudgets,
    removeBudget,
} = require("../controller/budgetController.js");
const { protect } = require("../middlewares/authMiddleware.js");

const router = express.Router();

router.get("/", protect, getBudgets);
router.post("/", protect, addBudget);
router.put("/:id", protect, editBudget);
router.delete("/:id", protect, removeBudget);

module.exports = router;
