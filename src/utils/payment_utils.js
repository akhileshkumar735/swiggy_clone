
const crypto = require("crypto");

// ==========================================
// 1. VERIFY CHECKOUT PAYMENT SIGNATURE
// ==========================================

const verifyPaymentSignature = (
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature
) => {
  try {
    const secret = process.env.RAZORPAY_KEY_SECRET;

    if (
      !secret ||
      !razorpayOrderId ||
      !razorpayPaymentId ||
      typeof razorpaySignature !== "string" ||
      !/^[a-f0-9]{64}$/i.test(razorpaySignature)
    ) {
      return false;
    }

    const body = `${razorpayOrderId}|${razorpayPaymentId}`;

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    const expected = Buffer.from(expectedSignature, "hex");
    const received = Buffer.from(razorpaySignature, "hex");

    return (
      expected.length === received.length &&
      crypto.timingSafeEqual(expected, received)
    );
  } catch (error) {
    console.error("Payment Signature Error:", error);
    return false;
  }
};


// ==========================================
// 2. VERIFY RAZORPAY WEBHOOK SIGNATURE
// ==========================================

const verifyWebhookSignature = (rawBody, signature) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (
      !secret ||
      !Buffer.isBuffer(rawBody) ||
      typeof signature !== "string" ||
      !/^[a-f0-9]{64}$/i.test(signature)
    ) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    const expected = Buffer.from(expectedSignature, "hex");
    const received = Buffer.from(signature, "hex");

    return (
      expected.length === received.length &&
      crypto.timingSafeEqual(expected, received)
    );
  } catch (error) {
    console.error("Webhook Signature Error:", error);
    return false;
  }
};


// ==========================================
// 3. EXPORT FUNCTIONS
// ==========================================

module.exports = {
  verifyPaymentSignature,
  verifyWebhookSignature,
};
