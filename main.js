const nodemailer = require("nodemailer");
const express = require("express");
const crypto = require("crypto");
const { json } = require("body-parser");
const bodyParser = require("body-parser");

const app = express();
app.use(json());
app.use(bodyParser.urlencoded());

let ipMap = new Map();
let idempotencyMap = new Map();

//clear the idempotency map after a set duration
let interval;
if (require.main === module) {
  interval = setInterval(() => {
    idempotencyMap.clear();
    console.log("Idempotency Map Cleared every few seconds!");
  }, 0.1 * 60 * 1000);
}

//class definitions for the email providers
class MockEmailService {
  constructor() {
    this.providerA = null;
    this.providerB = null;
  }

  //start the email providers
  async initServices() {
    const emailProviderA = await nodemailer.createTestAccount();
    const emailProviderB = await nodemailer.createTestAccount();

    this.providerA = nodemailer.createTransport({
      host: emailProviderA.smtp.host,
      port: emailProviderA.smtp.port,
      secure: emailProviderA.smtp.secure,
      auth: {
        user: emailProviderA.user,
        pass: emailProviderA.pass,
      },
    });

    this.providerB = nodemailer.createTransport({
      host: emailProviderB.smtp.host,
      port: emailProviderB.smtp.port,
      secure: emailProviderB.smtp.secure,
      auth: {
        user: emailProviderB.user,
        pass: emailProviderB.pass,
      },
    });

    console.log("Providers Initialised!");
  }

  async sendEmail(emailData) {
  const simulateAFails = Math.random() < 0.33;
  const simulateBFails = Math.random() < 0.33;

  console.log(`Simulated Failures → A: ${simulateAFails}, B: ${simulateBFails}`);

  // Case 1: A fails, B works
  if (simulateAFails && !simulateBFails) {
    try {
      const info = await this.providerB.sendMail(emailData);
      console.log("Email sent using Provider B:", nodemailer.getTestMessageUrl(info));
      return {
        provider: "B",
        sent: true,
        fallbackTried: true,
        timestamp: Date.now()
      };
} catch (err) {
  console.error("Error sending with Provider A:", err);
  return {
    provider: null,
    sent: false,
    fallbackTried: true,
    timestamp: Date.now(),
    error: "Fallback failed"
  };
}

  }

  // Case 2: B fails, A works
  if (!simulateAFails && simulateBFails) {
    try {
      const info = await this.providerA.sendMail(emailData);
      console.log("Email sent using Provider A:", nodemailer.getTestMessageUrl(info));
      return {
        provider: "A",
        sent: true,
        fallbackTried: true,
        timestamp: Date.now()
      };
    } catch (err) {
  console.error("Error sending with Provider B:", err);
  return {
    provider: null,
    sent: false,
    fallbackTried: true,
    timestamp: Date.now(),
    error: "Fallback failed"
  };
  }
  }

  // Case 3: Both fail
  if (simulateAFails && simulateBFails) {
    console.log("Both providers failed.");
    console.log("FAILED EMAIL DATA:", emailData);
    return {
      provider: null,
      sent: false,
      fallbackTried: false,
      timestamp: Date.now(),
      error: "Both providers failed"
    };
  }

  // Case 4: Neither failed → use A by default
  try {
    const info = await this.providerA.sendMail(emailData);
    console.log("Email sent using Provider A:", nodemailer.getTestMessageUrl(info));
    return {
      provider: "A",
      sent: true,
      fallbackTried: false,
      timestamp: Date.now()
    };
  } catch (err) {
    console.error("Unexpected error in fallback A:", err);
    return {
      provider: null,
      sent: false,
      fallbackTried: false,
      timestamp: Date.now(),
      error: "Both providers failed"
    };
  }
}
}

const requestTrackingMiddleware = (req , res , next) => {
    const maxRetries = 3;
    const maxRequests = 3;
    const window = 1000;
    const getBackoffDelay = (retryCount , baseDelay = 100) => {
        return baseDelay * Math.pow(2 , retryCount);
    }
    let ip = req.ip;
    if(!ipMap.has(ip)){
        ipMap.set(ip , {retryCount : 1 , requests : 1 , timeStamp : Date.now()});
    }
    else{
        let now = Date.now(); 
        let val = ipMap.get(ip);
        if(val && now - val.timeStamp < window){
            let retry = val.retryCount;
            retry = retry + 1;
            val.retryCount = retry;
            val.requests = val.requests + 1;
            ipMap.set(ip , val);
        }
        else{
            ipMap.set(ip , {retryCount : 1 , requests : 1 , timeStamp : Date.now()});
        } 
    }
    console.log(ipMap);
    let val = ipMap.get(ip);
    if(maxRetries < val.retryCount){
        return res.status(403).json("YOU HAVE REACHED THE MAXIMUM NUMBER OF RETRIES!!");
    }
    else{
        let delay = getBackoffDelay(val.retryCount);
        req.delay = delay;
    }
    if(val.requests > maxRequests){
        return res.status(403).json("YOU HAVE REACHED THE MAXIMUM NUMBER OF REQUESTS!! SLOW DOWN!!");
    }
    next();
}

const exponentialBackoffMiddleware = async (req , res , next) => {
    console.log("Delaying for", req.delay, "ms");
    await new Promise(resolve => setTimeout(resolve, req.delay)); 
    next();
}

app.use(requestTrackingMiddleware , exponentialBackoffMiddleware);

app.route("/").get(async function(req , res){
    res.send("WELCOME TO THE RESILIENT EMAIL APPLICATION!");
});

app.route("/sendEmail").post(async function (req, res) {
  const body = req.body;
  const hash = crypto
    .createHash("sha256")
    .update(`${body.from}-${body.to}-${body.subject}-${body.text}`)
    .digest("hex");

  if (idempotencyMap.has(hash)) {
  return res.send(`
    <html>
      <body>
        <h2>Duplicate email skipped (idempotent)</h2>
        <br/>
        <a href="/">← Back to Home</a>
      </body>
    </html>
  `);
  }

  idempotencyMap.set(hash, true);

  const emailService = new MockEmailService();
  await emailService.initServices();

  const emailData = {
    from: body.from,
    to: body.to,
    subject: body.subject,
    text: body.text,
  };

  const status = await emailService.sendEmail(emailData);

  res.send(`
    <html>
      <body>
        <h2>Email Status</h2>
        <p>Sent: ${status.sent}</p>
        <p>Provider: ${status.provider || "None"}</p>
        <p>Fallback Tried: ${status.fallbackTried}</p>
        <p>Timestamp: ${new Date(status.timestamp).toLocaleString()}</p>
        ${status.error ? `<p>Error: ${status.error}</p>` : ""}
        <br/>
        <a href="/">← Back to Home</a>
      </body>
    </html>
  `);
}).get(function(req , res){
    res.sendFile(__dirname + "/views/emailPage.html");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`APP LISTENING ON PORT ${PORT}`);
});

module.exports = { app, MockEmailService, ipMap, idempotencyMap };
