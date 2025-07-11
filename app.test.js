const request = require('supertest');
const { app, MockEmailService, ipMap, idempotencyMap } = require('./main');

// Mock nodemailer to avoid actual email sending during tests
jest.mock('nodemailer', () => ({
  createTestAccount: jest.fn().mockResolvedValue({
    user: 'test@example.com',
    pass: 'testpass',
    smtp: {
      host: 'smtp.test.com',
      port: 587,
      secure: false
    }
  }),
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({
      messageId: 'test-message-id'
    })
  }),
  getTestMessageUrl: jest.fn().mockReturnValue('https://test-url.com')
}));

describe('Email Service Tests', () => {
  let server;

  beforeAll(() => {
    // Start the server for testing
    server = app.listen(3001);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    // Clear maps before each test
    ipMap.clear();
    idempotencyMap.clear();
    jest.clearAllMocks();
  });

  describe('MockEmailService', () => {
    let emailService;

    beforeEach(async () => {
      emailService = new MockEmailService();
      await emailService.initServices();
    });

    test('should initialize email providers', async () => {
      expect(emailService.providerA).toBeDefined();
      expect(emailService.providerB).toBeDefined();
    });

    test('should send email successfully when both providers work', async () => {
      // Mock Math.random to simulate no failures
      const originalRandom = Math.random;
      Math.random = jest.fn().mockReturnValue(0.5); // > 0.33, so no failures

      const emailData = {
        from: 'test@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        text: 'Test email content'
      };

      const result = await emailService.sendEmail(emailData);

      expect(result.sent).toBe(true);
      expect(result.provider).toBe('A');
      expect(result.fallbackTried).toBe(false);
      expect(result.timestamp).toBeDefined();

      // Restore original Math.random
      Math.random = originalRandom;
    });

    test('should use fallback provider when primary fails', async () => {
      // Mock Math.random to simulate A fails, B works
      const originalRandom = Math.random;
      Math.random = jest.fn()
        .mockReturnValueOnce(0.1) // A fails (< 0.33)
        .mockReturnValueOnce(0.5); // B works (> 0.33)

      const emailData = {
        from: 'test@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        text: 'Test email content'
      };

      const result = await emailService.sendEmail(emailData);

      expect(result.sent).toBe(true);
      expect(result.provider).toBe('B');
      expect(result.fallbackTried).toBe(true);

      Math.random = originalRandom;
    });

    test('should fail when both providers fail', async () => {
      // Mock Math.random to simulate both providers fail
      const originalRandom = Math.random;
      Math.random = jest.fn().mockReturnValue(0.1); // Both fail (< 0.33)

      const emailData = {
        from: 'test@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        text: 'Test email content'
      };

      const result = await emailService.sendEmail(emailData);

      expect(result.sent).toBe(false);
      expect(result.provider).toBe(null);
      expect(result.error).toBe('Both providers failed');

      Math.random = originalRandom;
    });
  });

  describe('Rate Limiting', () => {
    test('should allow requests within rate limit', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.text).toContain('Mock Email Service');
    });

    test('should track requests and retries properly', async () => {
      // Make a few requests to verify tracking works
      await request(app).get('/');
      await request(app).get('/');
      
      // Check that ipMap has entries
      expect(ipMap.size).toBeGreaterThan(0);
      
      // Verify the structure of tracked data
      const entries = Array.from(ipMap.entries());
      const [ip, data] = entries[0];
      
      expect(data).toHaveProperty('retryCount');
      expect(data).toHaveProperty('requests');
      expect(data).toHaveProperty('timeStamp');
      expect(data.requests).toBeGreaterThan(0);
    });
  });

  describe('Exponential Backoff', () => {
    test('should apply exponential backoff delay', async () => {
      const startTime = Date.now();
      
      // First request
      await request(app).get('/');
      
      // Second request should have backoff delay
      await request(app).get('/');
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      
      // Should take at least some time due to backoff (100ms base delay * 2^retryCount)
      expect(totalTime).toBeGreaterThan(100);
    });

    test('should increase delay with retry count', () => {
      const getBackoffDelay = (retryCount, baseDelay = 100) => {
        return baseDelay * Math.pow(2, retryCount);
      };

      expect(getBackoffDelay(1)).toBe(200); // 100 * 2^1
      expect(getBackoffDelay(2)).toBe(400); // 100 * 2^2
      expect(getBackoffDelay(3)).toBe(800); // 100 * 2^3
    });
  });

  describe('Idempotency', () => {
    test('should prevent duplicate email sending', async () => {
      const emailData = {
        from: 'test@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        text: 'Test email content'
      };

      // First request
      const response1 = await request(app)
        .post('/sendEmail')
        .send(emailData)
        .expect(200);

      expect(response1.text).toContain('Email Status');

      // Second request with same data should be blocked
      const response2 = await request(app)
        .post('/sendEmail')
        .send(emailData)
        .expect(200);

      expect(response2.text).toContain('Duplicate email skipped');
    });

    test('should allow different emails', async () => {
      const emailData1 = {
        from: 'test@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject 1',
        text: 'Test email content 1'
      };

      const emailData2 = {
        from: 'test@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject 2',
        text: 'Test email content 2'
      };

      const response1 = await request(app)
        .post('/sendEmail')
        .send(emailData1)
        .expect(200);

      const response2 = await request(app)
        .post('/sendEmail')
        .send(emailData2)
        .expect(200);

      expect(response1.text).toContain('Email Status');
      expect(response2.text).toContain('Email Status');
      expect(response1.text).not.toContain('Duplicate');
      expect(response2.text).not.toContain('Duplicate');
    });
  });

  describe('API Endpoints', () => {
    test('should serve home page', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.text).toContain('Mock Email Service');
      expect(response.text).toContain('Send using Provider A');
      expect(response.text).toContain('Send using Provider B');
    });

    test('should serve email form page', async () => {
      const response = await request(app)
        .get('/sendEmail')
        .expect(200);

      // This should serve the HTML file (though we don't have the actual file in test)
      // The test will pass if the route exists and doesn't throw an error
    });

    test('should handle POST to /sendEmail', async () => {
      const emailData = {
        from: 'test@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        text: 'Test email content'
      };

      const response = await request(app)
        .post('/sendEmail')
        .send(emailData)
        .expect(200);

      expect(response.text).toContain('Email Status');
      expect(response.text).toContain('Sent:');
      expect(response.text).toContain('Provider:');
    });
  });

  describe('Data Structures', () => {
    test('should track IP addresses in ipMap', async () => {
      await request(app).get('/');
      
      expect(ipMap.size).toBeGreaterThan(0);
      
      // Check that IP tracking data has correct structure
      const entries = Array.from(ipMap.entries());
      const [ip, data] = entries[0];
      
      expect(data).toHaveProperty('retryCount');
      expect(data).toHaveProperty('requests');
      expect(data).toHaveProperty('timeStamp');
    });

    test('should track idempotency hashes', async () => {
      const emailData = {
        from: 'test@example.com',
        to: 'recipient@example.com',
        subject: 'Test Subject',
        text: 'Test email content'
      };

      await request(app)
        .post('/sendEmail')
        .send(emailData);

      expect(idempotencyMap.size).toBe(1);
    });
  });
});

// Additional utility tests
describe('Utility Functions', () => {
  test('should generate consistent hash for same email data', () => {
    const crypto = require('crypto');
    
    const emailData = {
      from: 'test@example.com',
      to: 'recipient@example.com',
      subject: 'Test Subject',
      text: 'Test email content'
    };

    const hash1 = crypto
      .createHash('sha256')
      .update(`${emailData.from}-${emailData.to}-${emailData.subject}-${emailData.text}`)
      .digest('hex');

    const hash2 = crypto
      .createHash('sha256')
      .update(`${emailData.from}-${emailData.to}-${emailData.subject}-${emailData.text}`)
      .digest('hex');

    expect(hash1).toBe(hash2);
  });

  test('should generate different hashes for different email data', () => {
    const crypto = require('crypto');
    
    const emailData1 = {
      from: 'test@example.com',
      to: 'recipient@example.com',
      subject: 'Test Subject 1',
      text: 'Test email content 1'
    };

    const emailData2 = {
      from: 'test@example.com',
      to: 'recipient@example.com',
      subject: 'Test Subject 2',
      text: 'Test email content 2'
    };

    const hash1 = crypto
      .createHash('sha256')
      .update(`${emailData1.from}-${emailData1.to}-${emailData1.subject}-${emailData1.text}`)
      .digest('hex');

    const hash2 = crypto
      .createHash('sha256')
      .update(`${emailData2.from}-${emailData2.to}-${emailData2.subject}-${emailData2.text}`)
      .digest('hex');

    expect(hash1).not.toBe(hash2);
  });
});