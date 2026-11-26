const express = require("express");
const router = express.Router();

const verifyFirebaseToken = require("../middleware/auth_middleware");

const {
  createPaymentOrder,
  verifyPayment,
  handleWebhook,
} = require("../controllers/payment_controller");


// Webhook route
router.post("/webhook", handleWebhook);

// Create payment order
router.post(
  "/create-order",
  verifyFirebaseToken,
  createPaymentOrder
);

// Verify payment
router.post(
  "/verify",
  verifyFirebaseToken,
  verifyPayment
);

module.exports = router;