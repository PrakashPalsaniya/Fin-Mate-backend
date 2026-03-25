const Expense = require("../models/Expense.js");
const xlsx = require("xlsx");
const {
    createTransaction,
    TransactionServiceError,
    updateTransaction,
} = require("../services/transactionService.js");

const buildWorkbookBuffer = (sheetName, data) => {
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(data);

    xlsx.utils.book_append_sheet(wb, ws, sheetName);

    return xlsx.write(wb, { bookType: "xlsx", type: "buffer" });
};

//Expense Source
exports.addExpense = async (req, res) => {
    const userId = req.user.id;

    try {
        const newExpense = await createTransaction({
            transactionType: "expense",
            userId,
            payload: req.body,
        });
        res.status(200).json(newExpense);
    } catch (error) {
        if (error instanceof TransactionServiceError) {
            return res.status(error.status).json({ message: error.message });
        }

        res.status(500).json({ message: "server error" })
    }
}

exports.updateExpense = async (req, res) => {
    try {
        const updatedExpense = await updateTransaction({
            transactionType: "expense",
            transactionId: req.params.id,
            userId: req.user.id,
            payload: req.body,
        });
        return res.status(200).json(updatedExpense);
    } catch (error) {
        if (error instanceof TransactionServiceError) {
            return res.status(error.status).json({ message: error.message });
        }

        return res.status(500).json({ message: "server error", error: error.message });
    }
}

// GetExpense Source
exports.getAllExpense = async (req, res) => {
    const userId = req.user.id

    try {
        const expense = await Expense.find({ userId }).sort({ date: -1 });
        res.json(expense);
    } catch (err) {
        res.status(500).json({ message: "Server Error", error: err.message })
    }
}

// DeExpense Source
exports.deleteExpense = async (req, res) => {
    try {
        const deletedExpense = await Expense.findOneAndDelete({
            _id: req.params.id,
            userId: req.user.id,
        });

        if (!deletedExpense) {
            return res.status(404).json({ message: "Expense not found" });
        }

        res.json({ message: "expense deleted successfully" })
    } catch (err) {
        res.status(500).json({ message: "server error", error: err.message })
    }
}

// Download Expense Excel
exports.downloadExpenseExcel = async (req, res) => {
    const userId = req.user.id

    try {
        const expense = await Expense.find({ userId }).sort({ date: -1 })

        // prepare data for excel
        const data = expense.map((item) => ({
            Title: item.title,
            Category: item.category,
            Amount: item.amount,
            Date: item.date,
        }))

        const buffer = buildWorkbookBuffer("Expense", data);

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", 'attachment; filename="expense_details.xlsx"');
        res.send(buffer);

    } catch (err) {
        res.status(500).json({ message: "server error", error: err.message })
    }
}
