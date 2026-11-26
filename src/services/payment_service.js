
const { db } = require("../config/firebase_admin");

const paymentCollection = db.collection("payment_transactions");
const webhookEventCollection = db.collection("razorpay_webhook_events");

// 1. Save Payment Record
const savePaymentRecord = async (razorpayOrder, userId, appOrderId) => {
  await paymentCollection.doc(razorpayOrder.id).set({
    userId,
    appOrderId,
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    paymentStatus: "created",
    paymentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
};

// 2. Get Payment Record
const getPaymentRecord = async (razorpayOrderId) => {
  const doc = await paymentCollection.doc(razorpayOrderId).get();

  if (!doc.exists) return null;

  return doc.data();
};

// 3. Update Payment Record
const updatePaymentRecord = async (razorpayOrderId, data) => {
  await paymentCollection.doc(razorpayOrderId).update({
    ...data,
    updatedAt: new Date(),
  });
};

// 4. Process Webhook Event (Duplicate Protection)
const processWebhookEvent = async (
  eventId,
  razorpayOrderId,
  paymentData
) => {
  const paymentRef = paymentCollection.doc(razorpayOrderId);
  const eventRef = webhookEventCollection.doc(eventId);

  return await db.runTransaction(async (transaction) => {
    const eventDoc = await transaction.get(eventRef);

    // Already processed event
    if (eventDoc.exists) {
      return { duplicate: true };
    }

    const paymentDoc = await transaction.get(paymentRef);

    if (!paymentDoc.exists) {
      throw new Error("Payment record not found");
    }

    const currentPayment = paymentDoc.data();

    // Do not downgrade a paid payment
    if (
      currentPayment.paymentStatus === "paid" &&
      paymentData.paymentStatus !== "paid"
    ) {
      transaction.create(eventRef, {
        eventId,
        razorpayOrderId,
        status: "ignored",
        createdAt: new Date(),
      });

      return { ignored: true };
    }

    transaction.update(paymentRef, {
      ...paymentData,
      updatedAt: new Date(),
    });

    transaction.create(eventRef, {
      eventId,
      razorpayOrderId,
      status: "processed",
      createdAt: new Date(),
    });

    return { duplicate: false, processed: true };
  });
};

module.exports = {
  savePaymentRecord,
  getPaymentRecord,
  updatePaymentRecord,
  processWebhookEvent,
};
