import mongoose from "mongoose";
import stayModel from "../model/stay.model.js";
import stayBookingModel from "../model/stay.booking.model.js";
import userModel from "../model/user.model.js";
import WalletTransactionModel from "../model/wallet.transaction.model.js";
import coupanModel from "../model/coupan.model.js";
import { sendBadRequest, sendError, sendNotFound, sendSuccess } from "../utils/responseUtils.js";
import { v4 as uuidv4 } from "uuid";
import { sendNotification } from "../utils/notification.utils.js";

const timeToMinutes = (timeStr) => {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
};

const parseDate = (dateStr) => {
  const [day, month, year] = dateStr.split("-");
  return new Date(`${year}-${month}-${day}`);
};

const round2 = (num) => Math.round(num * 100) / 100;

export const previewStayBooking = async (req, res) => {
  try {
    const { stayId } = req.params;
    const { date, time, couponCode } = req.body;

    if (!mongoose.Types.ObjectId.isValid(stayId)) {
      return sendBadRequest(res, "Invalid stay ID");
    }
    if (!date || !time) {
      return sendBadRequest(res, "date and time are required (time format: HH:MM-HH:MM)");
    }


    const timeParts = time.split("-");
    if (timeParts.length < 2) {
      return sendBadRequest(res, "Invalid time format. Use HH:MM-HH:MM (e.g. 10:00-12:00)");
    }
    const startTime = timeParts[0].trim();
    const endTime = timeParts[1].trim();

    const stay = await stayModel.findById(stayId);
    if (!stay || !stay.isActive) return sendNotFound(res, "Stay not found");

    const startMins = timeToMinutes(startTime);
    const endMins = timeToMinutes(endTime);
    if (endMins <= startMins) {
      return sendBadRequest(res, "End time must be after start time");
    }

    const totalHours = Math.ceil((endMins - startMins) / 60) || 1;

    const basePrice = stay.discountPrice || stay.actualPrice || stay.pricePerHour;
    const actualPrice = basePrice * totalHours;

    const discountPercentage = 10;
    const discountAmount = round2((actualPrice * discountPercentage) / 100);
    const discountPrice = round2(actualPrice - discountAmount);

    const taxesAndFeesPercentage = 23;
    const taxesAndFeesAmount = round2((discountPrice * taxesAndFeesPercentage) / 100);
    const finalAmount = round2(discountPrice + taxesAndFeesAmount);


    let couponDiscount = 0;
    let couponDiscountPercentage = 0;
    let appliedCouponCode = null;
    let amountAfterCoupon = finalAmount;

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

      couponDiscountPercentage = coupon.couponPerc;
      couponDiscount = round2((finalAmount * couponDiscountPercentage) / 100);
      amountAfterCoupon = round2(finalAmount - couponDiscount);
      appliedCouponCode = coupon.couponCode;
    }

    return sendSuccess(res, "Billing preview generated", [{
      stayId,
      stayName: stay.name,
      address: stay.address,
      city: stay.city,
      images: stay.images,
      date,
      time,
      startTime,
      endTime,
      totalHours,
      pricing: {
        basePrice,
        actualPrice,
        discountPercentage,
        discountAmount,
        discountPrice,
        taxesAndFeesPercentage,
        taxesAndFeesAmount,
        finalAmount,
        ...(appliedCouponCode && {
          coupon: {
            couponCode: appliedCouponCode,
            couponDiscountPercentage,
            couponDiscount,
            amountAfterCoupon
          }
        }),
        payableAmount: amountAfterCoupon,
        currency: "INR"
      },
      paymentSummary: {
        title: "Payment Information",
        items: [
          {
            label: `${totalHours} Hour(s) Stay`,
            value: `₹${round2(actualPrice).toFixed(2)}`
          },
          {
            label: "Discount",
            value: `${discountPercentage}%`,
            color: "blue"
          },
          {
            label: "With Discount",
            value: `₹${round2(discountPrice).toFixed(2)}`
          },
          ...(appliedCouponCode ? [{
            label: `Promo Code (${appliedCouponCode})`,
            value: `-₹${round2(couponDiscount).toFixed(2)}`,
            type: "discount"
          }] : []),
          {
            label: "Taxes & Services",
            value: `₹${round2(taxesAndFeesAmount).toFixed(2)}`
          },
          {
            label: "Total Amount of Paid",
            value: `₹${round2(amountAfterCoupon).toFixed(2)}`,
            bold: true
          }
        ],
        totalAmount: round2(amountAfterCoupon),
        currency: "INR",
        coupon: appliedCouponCode ? {
          code: appliedCouponCode,
          discountPercent: couponDiscountPercentage,
          discountAmount: couponDiscount
        } : null,
        proceedAction: "Process To Paid"
      }
    }]);
  } catch (error) {
    console.error("PreviewStayBooking error:", error);
    return sendError(res, "Failed to generate preview", error);
  }
};

export const createStayBooking = async (req, res) => {
  try {
    const { stayId } = req.params;
    const {
      date,
      time,
      couponCode,
      paymentMethod = "Stripe",
      transactionId = "",
      paymentStatus = "pending"
    } = req.body;

    const normalizedPaymentMethod =
      paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1).toLowerCase();

    if (!["Stripe", "Wallet"].includes(normalizedPaymentMethod)) {
      return sendBadRequest(res, "Invalid payment method. Only Stripe and Wallet are supported.");
    }

    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(stayId)) {
      return sendBadRequest(res, "Invalid stay ID");
    }

    if (!date || !time) {
      return sendBadRequest(res, "date and time are required");
    }


    const timeParts = time.split("-");
    if (timeParts.length < 2) {
      return sendBadRequest(res, "Invalid time format. Use HH:MM-HH:MM (e.g. 10:00-12:00)");
    }
    const startTime = timeParts[0].trim();
    const endTime = timeParts[1].trim();


    const bookingDate = parseDate(date);
    if (isNaN(bookingDate.getTime())) {
      return sendBadRequest(res, "Invalid date format. Use DD-MM-YYYY");
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (bookingDate < today) {
      return sendBadRequest(res, "Booking date cannot be in the past");
    }


    const startMins = timeToMinutes(startTime);
    const endMins = timeToMinutes(endTime);
    if (endMins <= startMins) {
      return sendBadRequest(res, "End time must be after start time");
    }

    const totalHours = Math.ceil((endMins - startMins) / 60) || 1;


    const stay = await stayModel.findById(stayId);
    if (!stay) return sendNotFound(res, "Stay not found");
    if (!stay.isActive) return sendBadRequest(res, "Stay is not available for booking");


    const existingBooking = await stayBookingModel.findOne({
      stayId,
      bookingStatus: { $in: ["pending", "upcoming", "confirmed"] },
      date: bookingDate,
      $or: [{ startTime: { $lt: endTime }, endTime: { $gt: startTime } }]
    });

    if (existingBooking) {
      return sendBadRequest(res, "Stay is already booked for the selected time slot");
    }


    const basePrice = stay.discountPrice || stay.actualPrice || stay.pricePerHour;
    const actualPrice = basePrice * totalHours;

    const discountPercentage = 10;
    const discountAmount = round2((actualPrice * discountPercentage) / 100);
    const discountPrice = round2(actualPrice - discountAmount);

    const taxesAndFeesPercentage = 23;
    const taxesAndFeesAmount = round2((discountPrice * taxesAndFeesPercentage) / 100);
    const finalAmount = round2(discountPrice + taxesAndFeesAmount);


    let couponDiscount = 0;
    let couponDiscountPercentage = 0;
    let appliedCouponCode = null;
    let payableAmount = finalAmount;

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

      couponDiscountPercentage = coupon.couponPerc;
      couponDiscount = round2((finalAmount * couponDiscountPercentage) / 100);
      payableAmount = round2(finalAmount - couponDiscount);
      appliedCouponCode = coupon.couponCode;
    }


    const user = await userModel.findById(userId);
    if (!user) return sendNotFound(res, "User not found");

    if (normalizedPaymentMethod === "Wallet") {
      if ((user.walletBalance || 0) < payableAmount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. Your balance is ₹${user.walletBalance || 0}, but the total is ₹${payableAmount}.`
        });
      }
    }


    const generatedBookingId = uuidv4();

    const isWallet = normalizedPaymentMethod === "Wallet";
    const isPaid = isWallet || paymentStatus === "completed" || paymentStatus === "confirmed";

    const booking = new stayBookingModel({
      bookingId: generatedBookingId,
      userId,
      adminId: stay.adminId,
      stayId,
      date: bookingDate,
      startTime,
      endTime,
      totalHours,
      pricing: {
        basePrice,
        actualPrice,
        discountPercentage,
        discountAmount,
        discountPrice,
        taxesAndFeesPercentage,
        taxesAndFeesAmount,
        finalAmount,
        ...(appliedCouponCode && {
          coupon: {
            couponCode: appliedCouponCode,
            couponDiscountPercentage,
            couponDiscount,
            amountAfterCoupon: payableAmount
          }
        }),
        payableAmount,
        currency: "INR"
      },
      bookingStatus: isPaid ? "upcoming" : "pending",
      payment: {
        paymentStatus: isWallet ? "completed" : paymentStatus,
        paymentMethod: normalizedPaymentMethod,
        transactionId: transactionId || generatedBookingId,
        paymentDate: new Date()
      }
    });

    await booking.save();


    if (isWallet) {
      user.walletBalance -= payableAmount;
      await user.save();

      const wTxn = new WalletTransactionModel({
        userId,
        amount: payableAmount,
        type: "debit",
        description: `Hourly Stay Booking - ${stay.name}`,
        status: "completed"
      });
      await wTxn.save();

      booking.payment.transactionId = wTxn._id.toString();
      await booking.save();
    }

    await sendNotification({
      userId,
      title: `Stay Booking Confirmed! 🏨`,
      message: `Your hourly stay at ${stay.name} on ${date} from ${startTime} to ${endTime} is confirmed. Booking ID: ${booking.bookingId}`,
      image: stay.images[0] || null,
      type: "STAY_BOOKING",
      reference: { bookingId: booking._id, stayId: stay._id }
    }).catch((err) => console.error("Notification Error:", err.message));

    await booking.populate("stayId", "name images address city");

    return sendSuccess(
      res,
      isWallet ? "Booking confirmed via Wallet" : "Booking created successfully",
      [booking]
    );
  } catch (error) {
    console.error("CreateStayBooking error:", error);
    return sendError(res, "Failed to create booking", error);
  }
};

export const getUserStayBookings = async (req, res) => {
  try {
    const userId = req.user._id;

    const bookings = await stayBookingModel
      .find({ userId })
      .populate("stayId", "name images address city type category")
      .sort({ createdAt: -1 });

    return sendSuccess(res, "Your stay bookings fetched successfully", bookings);
  } catch (error) {
    console.error("GetUserStayBookings error:", error);
    return sendError(res, "Failed to fetch your bookings", error);
  }
};

export const getStayBookingById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequest(res, "Invalid booking ID");
    }

    const booking = await stayBookingModel
      .findById(id)
      .populate("stayId")
      .populate("userId", "full_name email phone");

    if (!booking) return sendNotFound(res, "Booking not found");

    const isOwner = req.user && String(booking.userId._id) === String(req.user._id);
    const isAdmin = !!req.admin;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: "Not authorized to view this booking" });
    }

    return sendSuccess(res, "Booking details fetched", [booking]);
  } catch (error) {
    console.error("GetStayBookingById error:", error);
    return sendError(res, "Failed to fetch booking", error);
  }
};

export const cancelStayBooking = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, 400, "Invalid booking ID");
    }

    const booking = await stayBookingModel.findOne({ _id: id, userId });
    if (!booking) {
      return sendError(res, 404, "Booking not found or not authorized");
    }

    if (["cancelled", "refunded"].includes(booking.bookingStatus.toLowerCase())) {
      return sendError(res, 400, "Booking is already cancelled or refunded");
    }

    const isPaid = booking.payment.paymentStatus === "completed" || booking.payment.paymentStatus === "confirmed";
    const amountToRefund = booking.pricing.payableAmount || booking.pricing.finalAmount;


    booking.bookingStatus = "cancelled";

    if (isPaid) {
      booking.payment.paymentStatus = "refunded";


      const user = await userModel.findById(userId);
      if (user) {
        user.walletBalance = (user.walletBalance || 0) + amountToRefund;
        await user.save();


        const wTxn = new WalletTransactionModel({
          userId,
          amount: amountToRefund,
          type: "credit",
          description: `Refund for Hourly Stay Booking (Cancelled by User) - ${booking.bookingId || booking._id}`,
          status: "completed"
        });
        await wTxn.save();
      }
    } else {
      booking.payment.paymentStatus = "cancelled";
    }

    await booking.save();

    return sendSuccess(res, isPaid ? "Booking cancelled and refund processed to wallet successfully" : "Booking cancelled successfully", {
      bookingId: booking._id,
      refundAmount: isPaid ? amountToRefund : 0,
      paymentStatus: booking.payment.paymentStatus
    });

  } catch (error) {
    console.error("CancelStayBooking error:", error);
    return sendError(res, 500, "Failed to cancel booking", error.message);
  }
};

export const getAdminStayBookings = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    if (!adminId) return sendBadRequest(res, "Admin ID not found");

    const bookings = await stayBookingModel
      .find({ adminId })
      .populate("stayId", "name images city type")
      .populate("userId", "full_name email phone")
      .sort({ createdAt: -1 });

    return sendSuccess(res, "All stay bookings fetched", bookings);
  } catch (error) {
    console.error("GetAdminStayBookings error:", error);
    return sendError(res, "Failed to fetch bookings", error);
  }
};

export const updateStayBookingStatus = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    if (!adminId) return sendError(res, 400, "Admin ID not found");

    const { id } = req.params;
    const { status, bookingStatus } = req.body;
    const finalStatus = status || bookingStatus;

    if (!finalStatus) return sendError(res, 400, "Status is required in request body");

    const validStatuses = ["pending", "upcoming", "completed", "cancelled", "refunded", "confirmed"];

    if (!validStatuses.includes(finalStatus.toLowerCase())) {
      return sendError(res, 400, "Invalid booking status");
    }


    const booking = await stayBookingModel.findOne({ _id: id, adminId });
    if (!booking) {
      return sendError(res, 404, "Booking not found or not authorized");
    }

    const previousStatus = booking.bookingStatus.toLowerCase();
    const newStatus = finalStatus.toLowerCase();


    if (newStatus === "cancelled" && previousStatus !== "cancelled") {
      const isPaid = booking.payment.paymentStatus === "completed" || booking.payment.paymentStatus === "confirmed";

      if (isPaid) {
        const amountToRefund = booking.pricing.payableAmount || booking.pricing.finalAmount;
        const user = await userModel.findById(booking.userId);

        if (user) {
          user.walletBalance = (user.walletBalance || 0) + amountToRefund;
          await user.save();


          const wTxn = new WalletTransactionModel({
            userId: user._id,
            amount: amountToRefund,
            type: "credit",
            description: `Refund for Hourly Stay Booking (Cancelled by Admin) - ${booking.bookingId || booking._id}`,
            status: "completed"
          });
          await wTxn.save();

          booking.payment.paymentStatus = "refunded";
        }
      }
    }


    booking.bookingStatus = newStatus;
    await booking.save();

    return sendSuccess(res, `Booking status updated to ${newStatus} successfully`, booking);
  } catch (error) {
    console.error("UpdateStayBookingStatus error:", error);
    return sendError(res, 500, "Failed to update booking status", error.message);
  }
};

export const updateStayPaymentStatus = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    if (!adminId) return sendError(res, 400, "Admin ID not found");

    const { status, paymentStatus } = req.body;
    const { id } = req.params;
    const finalStatus = status || paymentStatus;

    if (!finalStatus) {
      return sendError(res, 400, "Status is required");
    }

    const validStatuses = ["pending", "confirmed", "cancelled", "completed", "refunded", "failed"];

    if (!validStatuses.includes(finalStatus.toLowerCase())) {
      return sendError(res, 400, "Invalid status value");
    }

    const booking = await stayBookingModel.findOne({ _id: id, adminId });
    if (!booking) {
      return sendError(res, 404, "Booking not found or not authorized");
    }

    const previousPaymentStatus = booking.payment.paymentStatus.toLowerCase();
    const newPaymentStatus = finalStatus.toLowerCase();


    if (newPaymentStatus === "cancelled" && (previousPaymentStatus === "completed" || previousPaymentStatus === "confirmed")) {
      const amountToRefund = booking.pricing.payableAmount || booking.pricing.finalAmount;
      const user = await userModel.findById(booking.userId);

      if (user) {
        user.walletBalance = (user.walletBalance || 0) + amountToRefund;
        await user.save();


        const wTxn = new WalletTransactionModel({
          userId: user._id,
          amount: amountToRefund,
          type: "credit",
          description: `Refund for Hourly Stay Booking (Payment Cancelled by Admin) - ${booking.bookingId || booking._id}`,
          status: "completed"
        });
        await wTxn.save();

        booking.payment.paymentStatus = "refunded";
        booking.bookingStatus = "cancelled";
      } else {
        booking.payment.paymentStatus = newPaymentStatus;
        booking.bookingStatus = "cancelled";
      }
    } else {
      booking.payment.paymentStatus = newPaymentStatus;


      if (newPaymentStatus === "completed" || newPaymentStatus === "confirmed") {
        booking.bookingStatus = "completed";
        booking.payment.paymentDate = new Date();
      } else if (newPaymentStatus === "cancelled" || newPaymentStatus === "failed") {
        booking.bookingStatus = "cancelled";
      }
    }

    await booking.save();
    return sendSuccess(res, "Booking payment status updated successfully", [booking]);

  } catch (error) {
    console.error("UpdateStayPaymentStatus error:", error);
    return sendError(res, 500, "Failed to update payment status", error.message);
  }
};

export const searchStay = async (req, res) => {
  try {
    const { location, date, time } = req.query;

    let query = { isActive: true };

    if (location) {
      query.city = { $regex: location.trim(), $options: "i" };
    }

    let stays = await stayModel.find(query);

    if (date && time) {
      const bookingDate = parseDate(date);
      if (isNaN(bookingDate.getTime())) {
        return sendBadRequest(res, "Invalid date format. Use DD-MM-YYYY");
      }

      const timeParts = time.split("-");
      if (timeParts.length < 2) {
        return sendBadRequest(res, "Invalid time format. Use HH:MM-HH:MM");
      }

      const searchStartMins = timeToMinutes(timeParts[0].trim());
      const searchEndMins = timeToMinutes(timeParts[1].trim());

      const bookingsOnDate = await stayBookingModel.find({
        date: bookingDate,
        bookingStatus: { $in: ["pending", "upcoming", "confirmed"] }
      });

      const unavailableStayIds = bookingsOnDate
        .filter(booking => {
          const bookingStartMins = timeToMinutes(booking.startTime);
          const bookingEndMins = timeToMinutes(booking.endTime);
          return searchStartMins < bookingEndMins && searchEndMins > bookingStartMins;
        })
        .map(booking => booking.stayId.toString());

      stays = stays.filter(stay => !unavailableStayIds.includes(stay._id.toString()));
    }

    return sendSuccess(res, "Search results retrieved successfully", stays);
  } catch (error) {
    console.log(error)
    return sendError(res, "Error While Searching Stays", error);
  }
};