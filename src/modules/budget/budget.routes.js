const express = require("express");
const {
    addBudget,
    editBudget,
    getBudgets,
    removeBudget,
} = require("./budget.controller.js");
const { protect } = require("../../shared/middlewares/auth.middleware.js");

const router = express.Router();

router.get("/", protect, getBudgets);
router.post("/", protect, addBudget);
router.put("/:id", protect, editBudget);
router.delete("/:id", protect, removeBudget);

module.exports = router;
