
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const paymentRoutes = require("../src/routes/payment_routes");

const app = express();

app.use(cors());

// Webhook ke liye raw body
app.use(
  "/api/payment/webhook",
  express.raw({ type: "application/json" })
);

// Normal APIs ke liye JSON parser
app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Swiggy Payment Backend is running",
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Backend is running",
  });
});

app.use("/api/payment", paymentRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
