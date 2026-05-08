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
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return sendBadRequest(res, "Invalid amount");
    }

    const user = await userModel.findById(userId);
    if (!user) return sendNotFound(res, "User not found");

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "inr",
      description: "Wallet Top-up",
      metadata: {
        userId: userId.toString(),
        type: "wallet_topup"
      }
    });

    const transaction = new WalletTransactionModel({
      userId,
      amount,
      type: "credit",
      description: "Wallet Top-up via Stripe",
      transactionId: paymentIntent.id,
      status: "pending"
    });
    await transaction.save();

    return sendSuccess(res, "Payment Intent created successfully", {
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount: transaction.amount,
      status: "pending"
    });
  } catch (error) {
    log.error("Add Money to Wallet Error: " + error.message);
    return sendError(res, error, `Error adding money to wallet: ${error.message}`);
  }
};

export const verifyWalletPayment = async (req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET);
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return sendBadRequest(res, "paymentIntentId is required");
    }

    const transaction = await WalletTransactionModel.findOne({ transactionId: paymentIntentId });

    if (!transaction) {
      return sendNotFound(res, "Transaction not found");
    }

    if (transaction.status === "completed") {
      return sendSuccess(res, "Payment is already verified", { balance: req.user?.walletBalance });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status === "succeeded") {
      transaction.status = "completed";
      await transaction.save();

      const user = await userModel.findById(transaction.userId);
      user.walletBalance = (user.walletBalance || 0) + transaction.amount;
      await user.save();

      return sendSuccess(res, "Payment successful and money added to wallet", {
        walletBalance: user.walletBalance,
        transaction
      });
    } else {
      return sendBadRequest(res, `Payment not successful. Current status: ${paymentIntent.status}`);
    }
  } catch (error) {
    log.error("Verify Wallet Payment Error: " + error.message);
    return sendError(res, error, `Error verifying payment: ${error.message}`);
  }
};
