
const razorpay = require("../config/razorpay");
const { db } = require("../config/firebase_admin");

const {
  savePaymentRecord,
  getPaymentRecord,
  updatePaymentRecord,
  processWebhookEvent,
} = require("../services/payment_service");

const {
  verifyPaymentSignature,
  verifyWebhookSignature,
} = require("../utils/payment_utils");

// ==========================================
// 1. CREATE PAYMENT ORDER
// ==========================================

const createPaymentOrder = async (req, res) => {
  try {
    const { amount, appOrderId } = req.body;
    const userId = req.user.uid;

    // Validate request
    if (
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      !appOrderId ||
      typeof appOrderId !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid amount in paise and appOrderId are required",
      });
    }

    // Check whether payment order already exists
    const existing = await db
      .collection("payment_transactions")
      .where("appOrderId", "==", appOrderId)
      .limit(1)
      .get();

    if (!existing.empty) {
      const record = existing.docs[0].data();

      if (record.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "Order does not belong to this user",
        });
      }

      return res.status(409).json({
        success: false,
        message: "Payment order already exists for this app order",
      });
    }

    // Create Razorpay order
    const razorpayOrder = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
      notes: {
        firebaseUserId: userId,
        appOrderId,
      },
    });

    // Save payment record in Firestore
    await savePaymentRecord(
      razorpayOrder,
      userId,
      appOrderId
    );

    return res.status(201).json({
      success: true,
      message: "Payment order created",
      data: {
        razorpayOrderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
      },
    });
  } catch (error) {
    console.error("Create Order Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create payment order",
    });
  }
};


// ==========================================
// 2. VERIFY PAYMENT
// ==========================================

const verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    const userId = req.user.uid;

    // Validate request
    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment verification details are required",
      });
    }

    // Get payment record
    const record = await getPaymentRecord(razorpay_order_id);

    if (!record || record.userId !== userId) {
      return res.status(404).json({
        success: false,
        message: "Payment order not found",
      });
    }

    // Verify Razorpay payment signature
    const isValid = verifyPaymentSignature(
      record.razorpayOrderId,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment signature",
      });
    }

    // Fetch payment details directly from Razorpay
    const payment = await razorpay.payments.fetch(
      razorpay_payment_id
    );

    // Validate payment details
    if (
      payment.order_id !== record.razorpayOrderId ||
      payment.amount !== record.amount ||
      payment.currency !== record.currency
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment details do not match",
      });
    }

    // Payment must be captured
    if (payment.status !== "captured") {
      return res.status(202).json({
        success: true,
        message: "Payment is not captured yet",
        paymentStatus: payment.status,
      });
    }

    // Update Firestore payment record
    await updatePaymentRecord(razorpay_order_id, {
      paymentId: razorpay_payment_id,
      paymentStatus: "paid",
      verifiedBy: "checkout",
    });

    return res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      data: {
        appOrderId: record.appOrderId,
        razorpayOrderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        paymentStatus: "paid",
      },
    });
  } catch (error) {
    console.error("Verify Payment Error:", error);

    return res.status(500).json({
      success: false,
      message: "Payment verification failed",
    });
  }
};


// ==========================================
// 3. RAZORPAY WEBHOOK
// ==========================================

const handleWebhook = async (req, res) => {
  try {
    // Read Razorpay headers
    const signature = req.headers["x-razorpay-signature"];
    const eventId = req.headers["x-razorpay-event-id"];

    // Validate webhook request
    if (
      !signature ||
      !eventId ||
      !Buffer.isBuffer(req.body)
    ) {
      return res.status(400).send("Invalid webhook request");
    }

    // Verify webhook signature using raw request body
    const isValid = verifyWebhookSignature(
      req.body,
      signature
    );

    if (!isValid) {
      return res.status(400).send("Invalid webhook signature");
    }

    // Parse webhook payload
    const event = JSON.parse(req.body.toString("utf8"));

    // We process payment-level events
    if (
      event.event !== "payment.captured" &&
      event.event !== "payment.failed"
    ) {
      return res.status(200).json({
        received: true,
        message: "Event acknowledged",
      });
    }

    const paymentEntity = event.payload?.payment?.entity;

    if (!paymentEntity) {
      return res.status(400).send("Payment details missing");
    }

    const razorpayOrderId = paymentEntity.order_id;

    if (!razorpayOrderId) {
      return res.status(400).send("Razorpay order ID missing");
    }

    // Get payment record from Firestore
    const record = await getPaymentRecord(razorpayOrderId);

    if (!record) {
      console.error(
        "Payment record not found:",
        razorpayOrderId
      );

      // Return 500 so Razorpay can retry
      return res.status(500).send("Payment record not found");
    }

    // Validate payment amount, currency and order ID
    if (
      paymentEntity.amount !== record.amount ||
      paymentEntity.currency !== record.currency ||
      paymentEntity.order_id !== record.razorpayOrderId
    ) {
      return res.status(400).send("Payment details mismatch");
    }

    // Prepare payment update
    let paymentData;

    if (event.event === "payment.captured") {
      // Confirm captured status
      if (paymentEntity.status !== "captured") {
        return res.status(400).send("Payment is not captured");
      }

      paymentData = {
        paymentStatus: "paid",
        paymentId: paymentEntity.id,
        verifiedBy: "webhook",
        webhookEvent: event.event,
      };
    } else {
      paymentData = {
        paymentStatus: "failed",
        paymentId: paymentEntity.id,
        webhookEvent: event.event,
      };
    }

    // Process event atomically and prevent duplicate processing
    const result = await processWebhookEvent(
      eventId,
      razorpayOrderId,
      paymentData
    );

    console.log("Webhook processed:", {
      eventId,
      razorpayOrderId,
      result,
    });

    return res.status(200).json({
      received: true,
      duplicate: result.duplicate === true,
    });
  } catch (error) {
    console.error("Webhook Error:", error);

    return res.status(500).send("Webhook processing failed");
  }
};


// ==========================================
// 4. EXPORT CONTROLLERS
// ==========================================

module.exports = {
  createPaymentOrder,
  verifyPayment,
  handleWebhook,
};
