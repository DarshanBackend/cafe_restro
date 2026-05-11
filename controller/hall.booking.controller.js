import hallModel from "../model/hall.model.js";
import hallBookingModel from "../model/hall.booking.model.js";
import mongoose from "mongoose";
import { sendBadRequest, sendNotFound, sendSuccess, sendError } from "../utils/responseUtils.js";
import userModel from "../model/user.model.js";
import WalletTransactionModel from "../model/wallet.transaction.model.js";
import { v4 as uuidv4 } from "uuid";
import coupanModel from "../model/coupan.model.js";

export const createHallBooking = async (req, res) => {
  try {
    const { hallId } = req.params;
    const {
      startDate,
      endDate,
      startTime,
      endTime,
      peoples,
      paymentMethod = "Stripe",
      transactionId = "",
      paymentStatus = "pending",
      couponCode
    } = req.body;

    const normalizedPaymentMethod = paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1).toLowerCase();
    if (!["Stripe", "Wallet"].includes(normalizedPaymentMethod)) {
      return sendBadRequest(res, "Invalid payment method. Only Stripe and Wallet are supported.");
    }

    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(hallId)) {
      return sendBadRequest(res, "Invalid hall ID");
    }

    if (!peoples || peoples <= 0) {
      return sendBadRequest(res, "Number of people is required and must be greater than zero");
    }

    if (!startDate || !endDate) {
      return sendBadRequest(res, "Start date and end date are required");
    }

    const convertToDate = (dateString) => {
      const [day, month, year] = dateString.split('-');
      return new Date(`${year}-${month}-${day}`);
    };

    const start = convertToDate(startDate);
    const end = convertToDate(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return sendBadRequest(res, "Invalid date format. Please use DD-MM-YYYY");
    }

    if (end < start) {
      return sendBadRequest(res, "End date must be after start date");
    }

    const hall = await hallModel.findById(hallId);
    if (!hall) {
      return sendNotFound(res, "Hall not found");
    }

    if (!hall.isAvailable) {
      return sendBadRequest(res, "Hall is not available for booking");
    }

    if (peoples > hall.capacity) {
      return sendBadRequest(res, `Hall capacity exceeded. Maximum capacity is ${hall.capacity} people.`);
    }

    const currentDateTime = new Date();
    currentDateTime.setHours(0, 0, 0, 0);
    if (start < currentDateTime) {
      return sendBadRequest(res, "Start date cannot be in the past");
    }

    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) || 1;

    const basePricePerDay = hall.discountPrice || hall.actualPrice;
    const baseSubtotal = basePricePerDay * totalDays;

    const actualPriceTotal = baseSubtotal;
    const discountPercentage = 10;
    const discountAmount = (actualPriceTotal * discountPercentage) / 100;
    const amountAfterDiscount = actualPriceTotal - discountAmount;

    let couponDetails = null;
    let amountAfterCoupon = amountAfterDiscount;

    if (couponCode) {
      const coupon = await coupanModel.findOne({ couponCode: couponCode.toUpperCase() });
      
      if (!coupon) {
        return sendBadRequest(res, "Invalid coupon code");
      }
      
      if (!coupon.isActive) {
        return sendBadRequest(res, "This coupon is no longer active");
      }
      
      if (coupon.couponExpire && new Date(coupon.couponExpire) < new Date()) {
        return sendBadRequest(res, "This coupon has expired");
      }

      const couponDiscountPercent = coupon.couponPerc || 0;
      const couponDiscountAmount = (amountAfterDiscount * couponDiscountPercent) / 100;
      amountAfterCoupon = amountAfterDiscount - couponDiscountAmount;

      couponDetails = {
        code: coupon.couponCode,
        discountPercent: couponDiscountPercent,
        discountAmount: couponDiscountAmount,
      };
    }

    const taxesAndFeesPercentage = 23;
    const taxesAndFeesAmount = (amountAfterCoupon * taxesAndFeesPercentage) / 100;
    const finalAmount = amountAfterCoupon + taxesAndFeesAmount;

    const round = (num) => Math.round(num * 100) / 100;

    const user = await userModel.findById(userId);
    if (!user) return sendNotFound(res, "User not found");

    if (normalizedPaymentMethod === "Wallet") {
      if ((user.walletBalance || 0) < finalAmount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. Your balance is ₹${user.walletBalance || 0}, but the total is ₹${finalAmount.toFixed(2)}.`
        });
      }
    }

    const generatedBookingId = uuidv4();

    const booking = new hallBookingModel({
      userId,
      adminId: hall.adminId,
      hallId,
      startDate: start,
      endDate: end,
      startTime,
      endTime,
      totalDays,
      peoples,
      pricing: {
        basePrice: basePricePerDay,
        actualPrice: actualPriceTotal,
        discountPercentage,
        discountAmount,
        discountPrice: amountAfterDiscount,
        couponDiscountAmount: couponDetails ? couponDetails.discountAmount : 0,
        priceAfterCoupon: amountAfterCoupon,
        taxesAndFeesPercentage,
        taxesAndFeesAmount,
        finalAmount: round(finalAmount),
        currency: "INR",
        couponCode: couponDetails ? couponDetails.code : null,
      },
      bookingId: generatedBookingId,
      bookingStatus: (normalizedPaymentMethod === "Wallet" || paymentStatus === "completed" || paymentStatus === "confirmed") ? 'Upcoming' : 'pending',
      payment: {
        paymentStatus: (normalizedPaymentMethod === "Wallet") ? 'completed' : paymentStatus,
        paymentMethod: normalizedPaymentMethod,
        transactionId: transactionId || generatedBookingId,
        paymentDate: new Date()
      }
    });

    await booking.save();

    if (normalizedPaymentMethod === "Wallet") {
      user.walletBalance -= finalAmount;
      await user.save();

      const wTxn = new WalletTransactionModel({
        userId,
        amount: finalAmount,
        type: "debit",
        description: `Hall Booking - ${hall.name}`,
        status: "completed"
      });
      await wTxn.save();

      booking.payment.transactionId = wTxn._id.toString();
      await booking.save();
    }

    await booking.populate('hallId', 'name image location capacity');

    return sendSuccess(res, normalizedPaymentMethod === "Wallet" ? "Booking confirmed via Wallet" : "Booking created successfully", [booking]);
  } catch (error) {
    console.error('Error creating hall booking:', error);
    return sendError(res, "Failed to create booking", error);
  }
};

export const getUserHallBookings = async (req, res) => {
  try {
    const userId = req.user._id;

    const bookings = await hallBookingModel.find({ userId })
      .populate('hallId', 'name image location address')
      .sort({ createdAt: -1 });

    return sendSuccess(res, "Your bookings fetched successfully", bookings);
  } catch (error) {
    console.error("GetUserHallBookings error:", error);
    return sendError(res, "Failed to fetch your bookings", error);
  }
};

export const getHallBookings = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    if (!adminId) return sendBadRequest(res, "Admin ID not found");

    const bookings = await hallBookingModel.find({ adminId })
      .populate('hallId', 'name')
      .populate('userId', 'name email phone')
      .sort({ createdAt: -1 });

    return sendSuccess(res, "All bookings fetched successfully", bookings);
  } catch (error) {
    console.error("GetHallBookings error:", error);
    return sendError(res, "Failed to fetch bookings", error);
  }
};

export const getHallBookingById = async (req, res) => {
  try {
    const { id: bookingId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return sendBadRequest(res, "Invalid booking ID");
    }

    const booking = await hallBookingModel.findById(bookingId)
      .populate('hallId')
      .populate('userId', 'name email phone');

    if (!booking) {
      return sendNotFound(res, "Booking not found");
    }

    const isOwner = req.user && String(booking.userId._id) === String(req.user._id);
    const isAdmin = !!req.admin;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to access this booking"
      });
    }

    return sendSuccess(res, "Booking details fetched successfully", [booking]);
  } catch (error) {
    console.error("GetHallBookingById error:", error);
    return sendError(res, "Failed to fetch booking details", error);
  }
};

export const cancelHallBooking = async (req, res) => {
  try {
    const { id: bookingId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return sendBadRequest(res, "Invalid booking ID");
    }

    const booking = await hallBookingModel.findById(bookingId);
    if (!booking) {
      return sendNotFound(res, "Booking not found");
    }

    if (String(booking.userId) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to cancel this booking"
      });
    }

    if (booking.bookingStatus === 'Cancelled') {
      return sendBadRequest(res, "Booking is already cancelled");
    }

    booking.bookingStatus = 'Cancelled';
    await booking.save();

    return sendSuccess(res, "Booking cancelled successfully", [booking]);
  } catch (error) {
    console.error("CancelHallBooking error:", error);
    return sendError(res, "Failed to cancel booking", error);
  }
};

export const updateHallBookingStatus = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    if (!adminId) return sendBadRequest(res, "Admin ID not found");

    const { id } = req.params;
    const { status, bookingStatus } = req.body;
    const finalStatus = status || bookingStatus;

    if (!finalStatus) return sendBadRequest(res, "Status is required");

    const validStatuses = ["pending", "Upcoming", "Completed", "Cancelled", "Refunded", "Confirmed"];
    if (!validStatuses.includes(finalStatus)) {
      return sendBadRequest(res, "Invalid booking status");
    }

    const booking = await hallBookingModel.findById(id);
    if (!booking) return sendNotFound(res, "Booking not found");

    const previousStatus = booking.bookingStatus.toLowerCase();
    const newStatus = finalStatus.toLowerCase();

    if (newStatus === "cancelled" && previousStatus !== "cancelled") {
      const isPaid = booking.payment.paymentStatus === "completed" || booking.payment.paymentStatus === "confirmed";
      if (isPaid) {
        const amountToRefund = booking.pricing.finalAmount;
        const user = await userModel.findById(booking.userId);
        if (user) {
          user.walletBalance = (user.walletBalance || 0) + amountToRefund;
          await user.save();
          const wTxn = new WalletTransactionModel({
            userId: user._id,
            amount: amountToRefund,
            type: "credit",
            description: `Refund for Hall Booking (Cancelled by Admin) - ${booking.bookingId || booking._id}`,
            status: "completed"
          });
          await wTxn.save();
          booking.payment.paymentStatus = "refunded";
          booking.payment.transactionId = wTxn._id.toString();
        }
      }
    }

    booking.bookingStatus = finalStatus;
    await booking.save();

    await booking.populate('hallId', 'name location image');
    await booking.populate('userId', 'name email phone');

    return sendSuccess(res, `Booking status updated to ${finalStatus} successfully`, [booking]);

  } catch (error) {
    console.error("Update Hall Booking Status Error:", error);
    return sendError(res, "Failed to update booking status", error);
  }
};

export const updateHallPaymentStatus = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    if (!adminId) return sendBadRequest(res, "Admin ID not found");

    const { id } = req.params;
    const { status, paymentStatus, transactionId, paymentMethod, paymentDate } = req.body;
    const finalStatus = status || paymentStatus;

    const validStatuses = ["pending", "confirmed", "cancelled", "completed", "refunded", "failed"];
    if (!finalStatus || !validStatuses.includes(finalStatus.toLowerCase())) {
      return sendBadRequest(res, "Invalid payment status");
    }

    const booking = await hallBookingModel.findById(id);
    if (!booking) return sendNotFound(res, "Booking not found");

    const previousPaymentStatus = booking.payment.paymentStatus.toLowerCase();
    const newPaymentStatus = finalStatus.toLowerCase();

    if (newPaymentStatus === "cancelled" && (previousPaymentStatus === "completed" || previousPaymentStatus === "confirmed")) {
      const amountToRefund = booking.pricing.finalAmount;
      const user = await userModel.findById(booking.userId);
      if (user) {
        user.walletBalance = (user.walletBalance || 0) + amountToRefund;
        await user.save();
        const wTxn = new WalletTransactionModel({
          userId: user._id,
          amount: amountToRefund,
          type: "credit",
          description: `Refund for Hall Booking (Payment Cancelled by Admin) - ${booking.bookingId || booking._id}`,
          status: "completed"
        });
        await wTxn.save();
        booking.payment.paymentStatus = "refunded";
        booking.payment.transactionId = wTxn._id.toString();
        booking.bookingStatus = "Cancelled";
      } else {
        booking.payment.paymentStatus = newPaymentStatus;
        booking.bookingStatus = "Cancelled";
      }
    } else {
      booking.payment.paymentStatus = newPaymentStatus;
      if (transactionId) booking.payment.transactionId = transactionId;
      if (paymentMethod) booking.payment.paymentMethod = paymentMethod;

      if (newPaymentStatus === "completed" || newPaymentStatus === "confirmed") {
        booking.bookingStatus = "Upcoming";
        booking.payment.paymentDate = paymentDate ? new Date(paymentDate) : new Date();
      } else if (newPaymentStatus === "cancelled" || newPaymentStatus === "failed") {
        booking.bookingStatus = "Cancelled";
      }
    }

    await booking.save();
    return sendSuccess(res, "Payment status updated successfully", [booking]);

  } catch (error) {
    console.error("Update Hall Payment Status Error:", error);
    return sendError(res, "Failed to update payment status", error);
  }
};

export const getHallBookingStatistics = async (req, res) => {
  try {
    const adminId = req.admin._id;

    const adminHalls = await hallModel.find({ adminId }).select('_id');
    const hallIds = adminHalls.map(h => h._id);

    const stats = await hallBookingModel.aggregate([
      { $match: { hallId: { $in: hallIds } } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalRevenue: { $sum: "$finalAmount" }
        }
      }
    ]);

    const formattedStats = {
      pending: 0,
      confirmed: 0,
      cancelled: 0,
      completed: 0,
      total: 0,
      totalRevenue: 0
    };

    stats.forEach(s => {
      if (formattedStats.hasOwnProperty(s._id)) {
        formattedStats[s._id] = s.count;
      }
      formattedStats.total += s.count;
      formattedStats.totalRevenue += s.totalRevenue;
    });

    return sendSuccess(res, "Booking statistics fetched successfully", [formattedStats]);
  } catch (error) {
    console.error("GetHallBookingStatistics error:", error);
    return sendError(res, "Failed to fetch statistics", error);
  }
};

export const checkInGuest = async (req, res) => {
  try {
    const { id: bookingId } = req.params;

    const booking = await hallBookingModel.findById(bookingId);
    if (!booking) return sendNotFound(res, "Booking not found");

    if (booking.bookingStatus !== 'Confirmed') {
      return sendBadRequest(res, "Only confirmed bookings can be checked in");
    }

    booking.bookingStatus = 'Completed';
    await booking.save();

    return sendSuccess(res, "Guest checked in successfully", [booking]);
  } catch (error) {
    return sendError(res, "Check-in failed", error);
  }
};

export const checkOutGuest = async (req, res) => {
  try {
    const { id: bookingId } = req.params;

    const booking = await hallBookingModel.findByIdAndUpdate(
      bookingId,
      { bookingStatus: 'Completed' },
      { new: true }
    );

    if (!booking) return sendNotFound(res, "Booking not found");

    return sendSuccess(res, "Guest checked out successfully", [booking]);
  } catch (error) {
    return sendError(res, "Check-out failed", error);
  }
};