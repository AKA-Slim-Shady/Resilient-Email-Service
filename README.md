# 📧 Resilient Email Service

A fault-tolerant, idempotent email-sending microservice built with **Node.js**, **Express**, and **Nodemailer**, designed to simulate failover between email providers and enforce basic rate limiting, retry delays, and idempotency.

---

## 🚀 Features

- ✅ **Email Provider Failover**: Randomly simulates failure in primary/secondary providers and handles fallback gracefully.
- ♻️ **Idempotency**: Prevents duplicate emails from being sent based on email content hash.
- 🧠 **Exponential Backoff**: Dynamically delays repeated requests from the same IP.
- 🛡️ **Rate Limiting**: Restricts the number of requests and retries per IP per second.
- 🔄 **Provider Simulation**: Uses Nodemailer's `createTestAccount()` for demo/testing.

---

## 📁 Project Structure

```
EmailService/
├── views/
│   └── emailPage.html
├── .gitignore
├── main.js
├── app.test.js
└── README.md
```

---

## ⚙️ Setup Instructions

### 1. Clone the Repo

```bash
git clone https://github.com/AKA-Slim-Shady/Resilient-Email-Service.git
cd Resilient-Email-Service
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start the Server

```bash
node main.js
```

The app will be available at `http://localhost:3000`.

---

## ✉️ Sending an Email

Go to:

```
http://localhost:3000/sendEmail
```

Use the provided form to send an email. Duplicate requests with the same content are skipped using idempotency checks.

---

## 🧪 Running Tests

This project includes unit tests using **Jest**.

### Add to `package.json`:

```json
"scripts": {
  "test": "jest"
}
```

### Run tests:

```bash
npm test
```

Make sure you have Jest installed globally or as a dev dependency:

```bash
npm install --save-dev jest
```

---

## 📌 Assumptions

- This project uses **Nodemailer's test SMTP accounts** to simulate provider behavior — no real emails are sent.
- Simulated failure is done using `Math.random()` with ~33% failure probability per provider.
- There is no persistent storage; all in-memory maps (`ipMap`, `idempotencyMap`) reset when the server restarts.
- The application is single-instance; in a distributed setup, you'd need shared state for rate-limiting and idempotency.

---

## 🛑 Rate Limiting & Backoff Logic

- Max **3 requests per IP per second**.
- Max **3 retries** before blocking.
- Uses **exponential backoff**: delay = `100ms * 2^retryCount`.

---

## 📂 .gitignore

The `.gitignore` file excludes:

```
node_modules/
```

Make sure to commit your `.gitignore` to keep your repo clean.

---

## 🧪 Testing Email Sending

Every email attempt logs a **Nodemailer test URL** in the console. Example:

```
Email sent using Provider A: https://ethereal.email/message/WaQKMgKddxQDoou...
```

You can click these links to view the mock emails in a browser.

---

## 📬 Example Email POST Body

If you’re sending programmatically:

```json
{
  "from": "sender@example.com",
  "to": "receiver@example.com",
  "subject": "Test Email",
  "text": "This is a test email"
}
```

---

## ✅ Future Improvements

- Real provider support (e.g., SendGrid, Mailgun).
- Redis or database-backed idempotency and rate limiting.
- Web UI to track email status.
- Email queueing and retry jobs.

---

## 🧑‍💻 Author

**Surya (AKA-Slim-Shady)**  
Feel free to contribute or raise issues via [GitHub](https://github.com/AKA-Slim-Shady/Resilient-Email-Service).

---
