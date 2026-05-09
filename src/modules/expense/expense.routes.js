const express = require("express")
const { 
    addExpense, 
    getAllExpense, 
    updateExpense,
    deleteExpense, 
    downloadExpenseExcel } = require("./expense.controller.js")

const { protect } = require("../../shared/middlewares/auth.middleware.js");

const router = express.Router();

router.post('/add', protect, addExpense);
router.get('/get', protect, getAllExpense);
router.get('/downloadexcel', protect, downloadExpenseExcel);
router.put("/:id", protect, updateExpense)
router.delete("/:id", protect, deleteExpense)

module.exports = router;
