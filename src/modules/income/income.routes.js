const express = require("express")
const { 
    addIncome, 
    getAllIncome, 
    updateIncome,
    deleteIncome, 
    downloadIncomeExcel } = require("./income.controller.js")

const { protect } = require("../../shared/middlewares/auth.middleware.js");

const router = express.Router();

router.post('/add', protect, addIncome);
router.get('/get', protect, getAllIncome);
router.get('/downloadexcel', protect, downloadIncomeExcel);
router.put("/:id", protect, updateIncome)
router.delete("/:id", protect, deleteIncome)

module.exports = router;
