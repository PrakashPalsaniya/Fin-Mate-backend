const Income = require("./income.model.js");
const { invalidateDashboardCache } = require("../dashboard/dashboard.cache.service.js");
const xlsx = require("xlsx");
const {
    createTransaction,
    TransactionServiceError,
    updateTransaction,
} = require("../../shared/services/transaction.service.js");

const buildWorkbookBuffer = (sheetName, data) => {
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(data);

    xlsx.utils.book_append_sheet(wb, ws, sheetName);

    return xlsx.write(wb, { bookType: "xlsx", type: "buffer" });
};

// Add Income Source
exports.addIncome = async (req, res) => {
    const userId = req.user.id;

    try {
        const newIncome = await createTransaction({
            transactionType: "income",
            userId,
            payload: req.body,
        });
        res.status(201).json(newIncome);
    } catch (error) {
        if (error instanceof TransactionServiceError) {
            return res.status(error.status).json({ message: error.message });
        }

        res.status(500).json({ message: "server error" })
    }
}

exports.updateIncome = async (req, res) => {
    try {
        const updatedIncome = await updateTransaction({
            transactionType: "income",
            transactionId: req.params.id,
            userId: req.user.id,
            payload: req.body,
        });
        return res.status(200).json(updatedIncome);
    } catch (error) {
        if (error instanceof TransactionServiceError) {
            return res.status(error.status).json({ message: error.message });
        }

        return res.status(500).json({ message: "server error", error: error.message });
    }
}

// Get All Income Source
exports.getAllIncome = async (req, res) => {
    const userId = req.user.id

    try {
        const income = await Income.find({ userId }).sort({ date: -1 });
        res.json(income);
    } catch (err) {
        res.status(500).json({ message: "Server Error", error: err.message })
    }
}

// Delete Income Source
exports.deleteIncome = async (req, res) => {
    try {
        const deletedIncome = await Income.findOneAndDelete({
            _id: req.params.id,
            userId: req.user.id,
        });

        if (!deletedIncome) {
            return res.status(404).json({ message: "Income not found" });
        }

        try {
            await invalidateDashboardCache({ userId: req.user.id });
        } catch (cacheError) {
            console.error("Failed to invalidate dashboard cache after income delete:", cacheError.message);
        }

        res.json({ message: "income deleted successfully" })
    } catch (err) {
        res.status(500).json({ message: "server error", error: err.message })
    }
}

// Download Income Excel
exports.downloadIncomeExcel = async (req, res) => {
    const userId = req.user.id

    try {
        const income = await Income.find({ userId }).sort({ date: -1 })

        // prepare data for excel
        const data = income.map((item) => ({
            Title: item.title,
            Category: item.category,
            Amount: item.amount,
            Date: item.date,
        }))

        const buffer = buildWorkbookBuffer("Income", data);

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", 'attachment; filename="income_details.xlsx"');
        res.send(buffer);

    } catch (err) {
        res.status(500).json({ message: "server error", error: err.message })
    }
}
