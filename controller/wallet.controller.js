import Stripe from "stripe";
import userModel from "../model/user.model.js";
import WalletTransactionModel from "../model/wallet.transaction.model.js";
import { sendBadRequest, sendError, sendNotFound, sendSuccess } from "../utils/responseUtils.js";
import log from "../utils/logger.js";

export const getWalletDetails = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await userModel.findById(userId);
    if (!user) return sendNotFound(res, "User not found");

    const transactions = await WalletTransactionModel.find({ userId }).sort({ createdAt: -1 });

    return sendSuccess(res, "Wallet details fetched successfully", {
      walletBalance: user.walletBalance || 0,
      referralCode: user.referralCode || "",
      transactions
    });
  } catch (error) {
    return sendError(res, error, `Error fetching wallet: ${error.message}`);
  }
};

export const addMoneyToWallet = async (req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET);
    const userId = req.user._id;
    const { amount } = req.body; // Amount in INR

    if (!amount || amount <= 0) {
      return sendBadRequest(res, "Invalid amount");
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "inr",
            product_data: {
              name: "Wallet Top-up",
              description: "Add funds to your Cafe & Restro wallet",
            },
            unit_amount: Math.round(amount * 100), // Stripe expects amount in paise (cents)
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/wallet/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/wallet/cancel`,
      metadata: {
        userId: userId.toString(),
        amount: amount.toString(),
        type: "wallet_topup"
      },
    });

    const transaction = new WalletTransactionModel({
      userId,
      amount,
      type: "credit",
      description: "Wallet Top-up via Stripe",
      transactionId: session.id,
      status: "pending"
    });
    await transaction.save();

    return res.status(200).json({
      success: true,
      message: "Payment session initialized",
      sessionId: session.id,
      url: session.url
    });
  } catch (error) {
    log.error("Add Money to Wallet Error: " + error.message);
    return sendError(res, error, `Error adding money to wallet: ${error.message}`);
  }
};

export const verifyWalletPayment = async (req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET);
    const { sessionId } = req.body;

    if (!sessionId) {
      return sendBadRequest(res, "Session ID is required");
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (session.payment_status === "paid") {
      const transaction = await WalletTransactionModel.findOne({ transactionId: sessionId });
      
      if (!transaction) {
        return sendNotFound(res, "Transaction not found");
      }

      if (transaction.status === "completed") {
        return sendSuccess(res, "Payment already verified", { balance: req.user?.walletBalance });
      }

      transaction.status = "completed";
      await transaction.save();

      const user = await userModel.findById(transaction.userId);
      user.walletBalance = (user.walletBalance || 0) + transaction.amount;
      await user.save();

      return sendSuccess(res, "Wallet topped up successfully", { balance: user.walletBalance });
    } else {
      return sendBadRequest(res, "Payment not successful");
    }
  } catch (error) {
    log.error("Verify Wallet Payment Error: " + error.message);
    return sendError(res, error, `Error verifying payment: ${error.message}`);
  }
};
