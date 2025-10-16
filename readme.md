# FinMate Backend – MERN Expense Tracker

This is the backend API for FinMate, a secure and feature-rich expense tracker built with Node.js, Express, and MongoDB. It handles user authentication, income and expense management, dashboard analytics, file uploads, and Excel report exports.

---

## Features

- **JWT Authentication:** Secure user registration and login.
- **Income & Expense Management:** Add, view, and delete income/expense records.
- **Dashboard Analytics:** Get total balance, income, expenses, and recent transactions.
- **Excel Export:** Download income and expense data as Excel files.
- **Profile Image Upload:** Upload and store user profile images.
- **RESTful API:** Well-structured endpoints for all operations.
- **Middleware:** Authentication and file upload middleware for security and convenience.

---

## Project Structure

```
backend/
│
├── config/
│   └── db.js
├── controller/
│   ├── authController.js
│   ├── dashboardController.js
│   ├── expenseController.js
│   └── incomeController.js
├── middlewares/
│   ├── authMiddleware.js
│   └── uploadMiddleware.js
├── models/
│   ├── Expense.js
│   ├── Income.js
│   └── User.js
├── routes/
│   ├── authRoutes.js
│   ├── dashboardRoutes.js
│   ├── expenseRoutes.js
│   └── incomeRoutes.js
├── uploads/
│   └── [profile images]
├── .env
├── .env.example
├── package.json
├── server.js
└── readme.md
```

---

## Getting Started

### Prerequisites

- Node.js & npm
- MongoDB database (local or [MongoDB Atlas](https://www.mongodb.com/atlas/database))

### Installation

1. **Clone the repository:**
   ```sh
   git clone <repo-url>
   cd backend
   ```

2. **Install dependencies:**
   ```sh
   npm install
   ```

3. **Configure environment variables:**
   - Copy `.env.example` to `.env` and fill in your values:
     ```
     MONGO_URI=your_mongodb_connection_string
     JWT_SECRET=your_jwt_secret
     PORT=8000
     CLIENT_URL=http://localhost:5173
     ```

4. **Start the server:**
   ```sh
   npm run dev
   ```
   The backend will run on `http://localhost:8000` by default.

---

## API Endpoints

### Auth
- `POST /api/auth/register` – Register a new user
- `POST /api/auth/login` – Login and receive JWT

### Dashboard
- `GET /api/dashboard/overview` – Get balance, income, expenses, and recent transactions

### Income
- `POST /api/income` – Add income
- `GET /api/income` – Get all income
- `DELETE /api/income/:id` – Delete income
- `GET /api/income/export` – Export income as Excel

### Expense
- `POST /api/expense` – Add expense
- `GET /api/expense` – Get all expenses
- `DELETE /api/expense/:id` – Delete expense
- `GET /api/expense/export` – Export expenses as Excel

### Profile Image Upload
- `POST /api/auth/upload` – Upload profile image

---

## Environment Variables

See `.env.example` for required variables:
```
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
PORT=5000
CLIENT_URL=http://localhost:5173
SESSION_SECRET=your_session_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:5000/api/v1/auth/google/callback
```

---

## License

MIT

---

## Acknowledgements

- [Express](https://expressjs.com/)
- [MongoDB](https://www.mongodb.com/)
- [Mongoose](https://mongoosejs.com/)
- [JWT](https://jwt.io/)
- [Multer](https://github.com/expressjs/multer)
-