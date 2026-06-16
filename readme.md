# FinMate Backend - MERN Expense Tracker

This is the backend API for FinMate, an expense tracker built with Node.js, Express, MongoDB, Redis-backed OTP storage, Google OAuth, and AI-powered finance features.

## Features

- JWT authentication
- OTP-based sign-up flow
- Google sign-in
- Income and expense management
- Dashboard analytics
- AI summary generation
- Finance chat assistant
- Telegram bot quick capture
- Scheduled daily/weekly/monthly summary delivery
- Excel export for income and expense data

## Project Structure

```text
backend/
|-- config/
|-- controller/
|-- middlewares/
|-- models/
|-- routes/
|-- utils/
|-- .env
|-- .env.example
|-- package.json
`-- server.js
```

## Getting Started

### Prerequisites

- Node.js and npm
- MongoDB local instance or MongoDB Atlas
- Redis local instance or hosted Redis URL
- Brevo API key for OTP email delivery

### Installation

1. Install dependencies:

```sh
npm install
```

2. Copy the env file:

```sh
copy .env.example .env
```

3. Update `.env` with your values:

```env
MONGO_URI=mongodb://localhost:27017/expense-tracker
PORT=5000
CLIENT_URL=http://localhost:3000
JWT_SECRET=your-jwt-secret
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://3.110.131.185:5000/api/v1/auth/google/callback
BREVO_API_KEY=your-brevo-api-key
REDIS_URL=redis://localhost:6379
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.5-flash
OPENROUTER_API_KEY=your-openrouter-api-key
TELEGRAM_PARSER_OPENROUTER_MODEL=openai/gpt-4o-mini
```

4. Start the server:

```sh
npm run dev
```

The backend runs on `http://localhost:5000` by default.

## API Routes

### Auth

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/send-otp`
- `POST /api/v1/auth/verify-otp`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/getUser`
- `GET /api/v1/auth/google`
- `GET /api/v1/auth/google/callback`
- `GET /api/v1/auth/exchange-google-code`

### Dashboard

- `GET /api/v1/dashboard`

### Income

- `POST /api/v1/income/add`
- `GET /api/v1/income/get`
- `GET /api/v1/income/downloadexcel`
- `DELETE /api/v1/income/:id`

### Expense

- `POST /api/v1/expense/add`
- `GET /api/v1/expense/get`
- `GET /api/v1/expense/downloadexcel`
- `DELETE /api/v1/expense/:id`

### AI Summary

- `GET /api/v1/ai-summary`

### Chat

- `POST /api/v1/chat`

### Telegram

- `GET /api/v1/telegram/status`
- `POST /api/v1/telegram/link/start`
- `DELETE /api/v1/telegram/link`
- `POST /api/v1/telegram/webhook`

### Summary Delivery

- `GET /api/v1/summary-delivery/history`
- `POST /api/v1/summary-delivery/send`

## Environment Variables

The current backend code expects these main variables:

- `MONGO_URI`
- `PORT`
- `CLIENT_URL`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`
- `BREVO_API_KEY`
- `BREVO_SENDER_NAME`
- `BREVO_SENDER_EMAIL`
- `REDIS_URL` or `REDIS_HOST` / `REDIS_PORT`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `OPENROUTER_API_KEY`
- `TELEGRAM_PARSER_OPENROUTER_MODEL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_WEBHOOK_URL`
- `TELEGRAM_WEBHOOK_SECRET`
- `SUMMARY_SCHEDULER_ENABLED`
- `SUMMARY_SCHEDULER_INTERVAL_MS`

## Telegram Bot Flow

1. User opens Settings in the app and generates a one-time link code.
2. The app builds a Telegram deep link like `https://t.me/<bot_username>?start=<code>`.
3. The Telegram bot consumes that code through `/start <code>` and links the chat to the logged-in user.
4. Linked users can send plain text transactions such as `Spent 420 on groceries today`.
5. The backend parses the text, replies with a confirmation prompt, and saves only after the user taps `Confirm`.
6. Users can also request `/summary daily`, `/summary weekly`, or `/summary monthly`.

Telegram transaction parsing uses the OpenRouter chat completions API. The rest of the AI features can keep using Gemini independently.

## Telegram Setup

1. Add the Telegram variables and `OPENROUTER_API_KEY` to `backend/.env`.
2. Expose the backend to a public HTTPS URL.
3. Run `npm run telegram:webhook:set`.
4. Verify with `npm run telegram:webhook:info`.

## Scheduled Summaries

- The backend runs a lightweight scheduler loop and checks due users every minute by default.
- Daily, weekly, and monthly timing is based on each user's stored timezone and summary settings.
- Delivery uses the linked Telegram chat when Telegram delivery is enabled, and email when email delivery is enabled.
- Duplicate scheduled sends are prevented with a persistent delivery log.

## Notes

- OTP storage falls back to in-memory storage if Redis is not reachable.
- The frontend dev server is configured for `http://localhost:5173`.
- `CLIENT_URL` should match the frontend origin to avoid CORS issues.
