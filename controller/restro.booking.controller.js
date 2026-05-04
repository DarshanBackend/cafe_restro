import restaurantBookingModel from "../model/restro.booking.model.js";
import restroModel from "../model/restro.model.js";
import mongoose from "mongoose";
import { sendBadRequest, sendNotFound, sendSuccess } from "../utils/responseUtils.js";
import { v4 as uuidv4 } from "uuid";
import log from "../utils/logger.js";
import coupanModel from "../model/coupan.model.js";
import { sendNotification } from "../utils/notificatoin.utils.js";
import userModel from "../model/user.model.js";
import WalletTransactionModel from "../model/wallet.transaction.model.js";
import Stripe from "stripe";

// Create new restaurant booking
export const createRestaurantBooking = async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET) {
      return res.status(500).json({ success: false, message: "Stripe API key is missing in environment variables" });
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET);
    const userId = req.user?._id;
    const { restaurantId } = req.params;

    const {
      checkInDate,
      checkOutDate,
      adults = 1,
      isMySelf = true,
      name,
      email,
      phone,
      couponCode,
      children = 0,
      infants = 0,
      numberOfRooms = 1,
      specialRequests = "",
      timeSlot,
      paymentMethod = "Stripe",
      transactionId = "",
      paymentStatus = "pending",
    } = req.body;

    if (!restaurantId || !checkInDate || !checkOutDate || !timeSlot) {
      return res.status(400).json({
        success: false,
        message: "Restaurant ID, check-in date, check-out date, and time slot are required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
      return res.status(400).json({ success: false, message: "Invalid restaurant ID" });
    }

    const restaurant = await restroModel.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ success: false, message: "Restaurant not found" });
    }

    const parseDate = (d) => {
      const [day, month, year] = d.split("-");
      return new Date(`${year}-${month}-${day}`);
    };

    const checkIn = parseDate(checkInDate);
    const checkOut = parseDate(checkOutDate);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (checkIn < today) {
      return res.status(400).json({
        success: false,
        message: "Check-in date cannot be in the past",
      });
    }

    // Billing Logic
    const guestRate = restaurant.discountPrice || 200;
    const totalGuests = Number(adults) + Number(children);
    const totalGuestRate = guestRate * totalGuests * Number(numberOfRooms);

    const actualPrice = totalGuestRate;
    const discountPercentage = 10;
    const discountAmount = (actualPrice * discountPercentage) / 100;
    const discountPrice = actualPrice - discountAmount;

    let couponDetails = null;
    let amountAfterCoupon = discountPrice;
    if (couponCode) {
      const coupon = await coupanModel.findOne({ couponCode: couponCode.toUpperCase(), isActive: true });
      if (coupon && (!coupon.couponExpire || new Date(coupon.couponExpire) >= new Date())) {
        const couponDiscountAmount = (discountPrice * (coupon.couponPerc || 0)) / 100;
        amountAfterCoupon = discountPrice - couponDiscountAmount;
        couponDetails = {
          code: coupon.couponCode,
          discountPercent: coupon.couponPerc,
          discountAmount: couponDiscountAmount,
        };
      }
    }

    const taxesAndFeesPercentage = 23;
    const taxesAndFeesAmount = (amountAfterCoupon * taxesAndFeesPercentage) / 100;
    const totalAmount = amountAfterCoupon + taxesAndFeesAmount;

    const round = (num) => Math.round(num * 100) / 100;

    const finalPricing = {
      perGuestRate: round(guestRate),
      totalGuestRate: round(totalGuestRate),
      actualPrice: round(actualPrice),
      discountPercentage: round(discountPercentage),
      discountAmount: round(discountAmount),
      discountPrice: round(discountPrice),
      couponDiscountAmount: couponDetails ? round(couponDetails.discountAmount) : 0,
      priceAfterCoupon: round(amountAfterCoupon),
      taxesAndFeesPercentage: round(taxesAndFeesPercentage),
      taxesAndFeesAmount: round(taxesAndFeesAmount),
      totalAmount: round(totalAmount),
      currency: "INR",
      couponCode: couponDetails ? couponDetails.code : null,
    };

    const normalizedPaymentMethod = paymentMethod ? paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1).toLowerCase() : "Stripe";

    let guestInfo = {};
    let dbUser = await userModel.findById(userId);

    if (isMySelf || normalizedPaymentMethod === "Wallet") {
      if (!dbUser) return res.status(404).json({ success: false, message: "User not found" });

      if (isMySelf) {
        const defaultAddr = dbUser.addresses?.find(a => a.isDefault) || dbUser.addresses?.[0];
        guestInfo = {
          name: defaultAddr?.name || dbUser.name,
          email: defaultAddr?.email || dbUser.email,
          phone: defaultAddr?.contactNo || dbUser.contactNo,
          address: defaultAddr?.address || dbUser.address,
          state: defaultAddr?.state || dbUser.state,
          country: defaultAddr?.country || dbUser.nationality || dbUser.country,
        };
      }
    }

    const guest = {
      isMySelf,
      name: isMySelf ? guestInfo.name : name,
      email: isMySelf ? guestInfo.email : email,
      phone: isMySelf ? guestInfo.phone : phone,
      address: isMySelf ? guestInfo.address : "",
      state: isMySelf ? guestInfo.state : "",
      country: isMySelf ? guestInfo.country : "",
    };

    if (normalizedPaymentMethod === "Wallet") {
      if ((dbUser.walletBalance || 0) < totalAmount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. Your balance is \u20B9${dbUser.walletBalance || 0}, but the booking total is \u20B9${totalAmount.toFixed(2)}.`
        });
      }
    }

    const newBooking = new restaurantBookingModel({
      bookingId: uuidv4(),
      userId,
      adminId: restaurant.ownerId,
      restaurantId,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      timeSlot,
      numberOfGuests: totalGuests,
      adults,
      children,
      infants,
      numberOfRooms,
      guest,
      guestInfo: {
        specialRequests: specialRequests || "",
        adults,
        children,
        infants
      },
      pricing: finalPricing,
      payment: {
        transactionId: transactionId || "",
        paymentStatus: paymentStatus || "pending",
        paymentMethod: normalizedPaymentMethod,
        paymentDate: new Date(),
      },
      bookingStatus: "pending",
    });

    const savedBooking = await newBooking.save();

    await sendNotification({
      adminId: restaurant.ownerId,
      title: `New Restaurant Booking Created`,
      description: `Booking ID: ${savedBooking.bookingId}\nRestaurant: ${restaurant.name}\nSlot: ${timeSlot}`,
      image: restaurant.images[0] || null,
      type: "single",
      userId,
    }).catch((err) => console.error("Notification Error:", err.message));

    if (normalizedPaymentMethod === "Wallet") {
      dbUser.walletBalance -= totalAmount;
      await dbUser.save();

      const wTxn = new WalletTransactionModel({
        userId,
        amount: totalAmount,
        type: "debit",
        description: `Restaurant Booking - ${restaurant.name}`,
        status: "completed"
      });
      await wTxn.save();

      savedBooking.payment.paymentStatus = "completed";
      savedBooking.payment.transactionId = wTxn._id.toString();
      savedBooking.bookingStatus = "Upcoming";
      await savedBooking.save();

      return res.status(201).json({
        success: true,
        message: "Booking confirmed successfully via Wallet",
        data: savedBooking,
      });
    }

    if (normalizedPaymentMethod === "Stripe") {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "inr",
              product_data: {
                name: `Restaurant Booking - ${restaurant.name}`,
                description: `Slot: ${timeSlot} | Guests: ${totalGuests}`,
                images: restaurant.images && restaurant.images.length > 0 ? [restaurant.images[0]] : [],
              },
              unit_amount: Math.round(totalAmount * 100),
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/restaurant/success?session_id={CHECKOUT_SESSION_ID}\u0026booking_id=${savedBooking._id}`,
        cancel_url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/restaurant/cancel?booking_id=${savedBooking._id}`,
        metadata: {
          bookingId: savedBooking._id.toString(),
          restaurantId: restaurantId.toString(),
          userId: userId ? userId.toString() : "guest",
        },
      });

      savedBooking.payment.transactionId = session.id;
      await savedBooking.save();

      return res.status(201).json({
        success: true,
        message: "Booking initialized successfully",
        data: savedBooking,
        sessionId: session.id,
        url: session.url
      });
    }

    return res.status(201).json({
      success: true,
      message: "Restaurant booking created successfully",
      data: savedBooking,
    });
  } catch (error) {
    console.error("Create Restaurant Booking Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

// Get all bookings for a user
export const getUserRestaurantBookings = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { page = 1, limit = 10, status } = req.query;

    const filter = { userId };
    if (status && ["pending", "confirmed", "cancelled", "completed"].includes(status)) {
      filter.bookingStatus = status;
    }

    const bookings = await restaurantBookingModel
      .find(filter)
      .populate('restaurantId', 'name address city images')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await restaurantBookingModel.countDocuments(filter);

    return res.status(200).json({
      success: true,
      data: bookings,
      pagination: {
        current: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalBookings: total
      }
    });

  } catch (error) {
    console.error("Get User Restaurant Bookings Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};

// Get all bookings for a restaurant (admin)
export const getRestaurantBookings = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    if (!adminId) return res.status(400).json({ success: false, message: "Admin ID not found" });

    const { restroId } = req.params;
    const filter = { adminId };
    if (restroId && mongoose.Types.ObjectId.isValid(restroId)) {
      filter.restaurantId = restroId;
    }

    const bookings = await restaurantBookingModel
      .find(filter)
      .populate("restaurantId", "name address city images pricing")
      .populate("userId", "name email phone contactNo")
      .sort({ createdAt: -1 });

    const now = new Date();
    for (let booking of bookings) {
      if (
        ["confirmed", "upcoming", "pending", "Upcoming", "Confirmed"].includes(booking.bookingStatus) &&
        booking.checkOutDate && new Date(booking.checkOutDate) < now
      ) {
        booking.bookingStatus = "Completed";
        await booking.save();
      }
    }

    return res.status(200).json({
      success: true,
      message: "Bookings fetched successfully",
      result: bookings,
      length: bookings.length
    });
  } catch (error) {
    console.error("Get Restaurant Bookings Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

// Get booking by ID
export const getRestaurantBookingById = async (req, res) => {
  try {
    const { bookingId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID"
      });
    }

    const booking = await restaurantBookingModel
      .findById(bookingId)
      .populate('userId', 'name email phone')
      .populate('restaurantId', 'name address city images contact pricing operatingHours');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    return res.status(200).json({
      success: true,
      data: booking
    });

  } catch (error) {
    console.error("Get Restaurant Booking Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};

export const previewRestroBooking = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const {
      checkInDate,
      checkOutDate,
      adults = 1,
      children = 0,
      infants = 0,
      numberOfRooms = 1,
      specialRequests = "",
      couponCode,
      timeSlot
    } = req.body;

    if (!checkInDate || !checkOutDate || !timeSlot) {
      return res.status(400).json({
        success: false,
        message: "Check-in date, check-out date, and timeSlot are required."
      });
    }

    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
      return res.status(400).json({ success: false, message: "Invalid restaurant ID." });
    }

    const parseDate = (dateStr) => {
      const [d, m, y] = dateStr.split("-");
      return new Date(`${y}-${m}-${d}`);
    };

    const startDate = parseDate(checkInDate);
    const endDate = parseDate(checkOutDate);

    if (isNaN(startDate) || isNaN(endDate)) {
      return res.status(400).json({ success: false, message: "Invalid date format (use DD-MM-YYYY)." });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (startDate < today) {
      return res.status(400).json({ success: false, message: "Check-in date cannot be in the past." });
    }

    const restaurant = await restroModel.findById(restaurantId).populate("themeCategoryId", "name");
    if (!restaurant) {
      return res.status(404).json({ success: false, message: "Restaurant not found." });
    }

    const baseRatePerGuest = restaurant.discountPrice || 200;
    const totalGuests = Number(adults) + Number(children);
    const baseSubtotal = baseRatePerGuest * totalGuests * Number(numberOfRooms);

    const actualPrice = baseSubtotal;
    const discountPercentage = 10;
    const discountAmount = (actualPrice * discountPercentage) / 100;
    const discountPrice = actualPrice - discountAmount;

    let couponDetails = null;
    let amountAfterCoupon = discountPrice;
    if (couponCode) {
      const coupon = await coupanModel.findOne({ couponCode: couponCode.toUpperCase(), isActive: true });
      if (coupon && (!coupon.couponExpire || new Date(coupon.couponExpire) >= new Date())) {
        const couponDiscountPercent = coupon.couponPerc || 0;
        const couponDiscountAmount = (discountPrice * couponDiscountPercent) / 100;
        amountAfterCoupon = discountPrice - couponDiscountAmount;

        couponDetails = {
          code: coupon.couponCode,
          discountPercent: couponDiscountPercent,
          discountAmount: couponDiscountAmount,
          description: `Additional ${couponDiscountPercent}% Coupon Discount Applied`,
        };
      }
    }

    const taxesAndFeesPercentage = 23;
    const taxesAndFeesAmount = (amountAfterCoupon * taxesAndFeesPercentage) / 100;
    const totalAmount = amountAfterCoupon + taxesAndFeesAmount;

    const round = (num) => Math.round(num * 100) / 100;

    return res.status(200).json({
      success: true,
      message: "Restaurant booking preview generated successfully",
      result: [
        {
          restaurantDetails: {
            id: restaurant._id,
            name: restaurant.name,
            themeCategory: restaurant.themeCategoryId?.name || null,
            address: restaurant.address + ", " + restaurant.city,
            image: restaurant.images?.[0] || null
          },
          bookingDetails: {
            checkInDate,
            checkOutDate,
            timeSlot,
            adults,
            children,
            infants,
            numberOfRooms,
            specialRequests
          },
          paymentSummary: {
            title: "Payment Information",
            items: [
              {
                label: `Guests (${totalGuests}) * Rate (\u20B9${baseRatePerGuest})`,
                value: `\u20B9${round(baseSubtotal).toFixed(2)}`
              },
              {
                label: "Discount",
                value: `${discountPercentage + (couponDetails ? couponDetails.discountPercent : 0)}%`,
                color: "blue"
              },
              {
                label: "With Discount",
                value: `\u20B9${round(amountAfterCoupon).toFixed(2)}`
              },
              {
                label: "Taxes \u0026 Services",
                value: `\u20B9${round(taxesAndFeesAmount).toFixed(2)}`
              },
              {
                label: "Total Amount of Paid",
                value: `\u20B9${round(totalAmount).toFixed(2)}`,
                bold: true
              }
            ],
            totalAmount: round(totalAmount).toFixed(2),
            currency: "INR",
            coupon: couponDetails ? {
              code: couponDetails.code,
              discountPercent: couponDetails.discountPercent,
              discountAmount: round(couponDetails.discountAmount)
            } : null,
            proceedAction: "Process To Paid"
          }
        }
      ],
      length: 1
    });

  } catch (err) {
    console.error("Preview Restaurant Booking Error:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
};

// Update booking status
export const updateRestaurantBookingStatus = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    if (!adminId) return res.status(400).json({ success: false, message: "Admin ID not found" });

    const { bookingId } = req.params;
    const { status, bookingStatus } = req.body;
    const finalStatus = status || bookingStatus;

    if (!finalStatus) return res.status(400).json({ success: false, message: "Status is required" });

    const validStatuses = ["pending", "Upcoming", "Completed", "Cancelled", "Refunded", "Confirmed"];
    if (!validStatuses.includes(finalStatus)) {
      return res.status(400).json({ success: false, message: "Invalid booking status" });
    }

    const booking = await restaurantBookingModel.findOne({ _id: bookingId, adminId });
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found or not authorized" });
    }

    const previousStatus = booking.bookingStatus.toLowerCase();
    const newStatus = finalStatus.toLowerCase();

    if (newStatus === "cancelled" && previousStatus !== "cancelled") {
      const isPaid = booking.payment.paymentStatus === "completed" || booking.payment.paymentStatus === "confirmed";
      if (isPaid) {
        const amountToRefund = booking.pricing.totalAmount;
        const user = await userModel.findById(booking.userId);
        if (user) {
          user.walletBalance = (user.walletBalance || 0) + amountToRefund;
          await user.save();
          const wTxn = new WalletTransactionModel({
            userId: user._id,
            amount: amountToRefund,
            type: "credit",
            description: `Refund for Restaurant Booking (Cancelled by Admin) - ${booking.bookingId || booking._id}`,
            status: "completed"
          });
          await wTxn.save();
          booking.payment.paymentStatus = "refunded";
        }
      }
    }

    booking.bookingStatus = finalStatus;
    await booking.save();

    await booking.populate('restaurantId', 'name address city images');
    await booking.populate('userId', 'name email phone');

    return res.status(200).json({
      success: true,
      message: `Booking status updated to ${finalStatus} successfully`,
      data: booking
    });

  } catch (error) {
    console.error("Update Restaurant Booking Status Error:", error);
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

// Update payment status
export const updateRestaurantPaymentStatus = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    if (!adminId) return res.status(400).json({ success: false, message: "Admin ID not found" });

    const { bookingId } = req.params;
    const { status, paymentStatus, transactionId, paymentMethod, paymentDate } = req.body;
    const finalStatus = status || paymentStatus;

    const validStatuses = ["pending", "confirmed", "cancelled", "completed", "refunded", "failed"];
    if (!finalStatus || !validStatuses.includes(finalStatus.toLowerCase())) {
      return res.status(400).json({ success: false, message: "Invalid payment status" });
    }

    const booking = await restaurantBookingModel.findOne({ _id: bookingId, adminId });
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found or not authorized" });
    }

    const previousPaymentStatus = booking.payment.paymentStatus.toLowerCase();
    const newPaymentStatus = finalStatus.toLowerCase();

    if (newPaymentStatus === "cancelled" && (previousPaymentStatus === "completed" || previousPaymentStatus === "confirmed")) {
      const amountToRefund = booking.pricing.totalAmount;
      const user = await userModel.findById(booking.userId);
      if (user) {
        user.walletBalance = (user.walletBalance || 0) + amountToRefund;
        await user.save();
        const wTxn = new WalletTransactionModel({
          userId: user._id,
          amount: amountToRefund,
          type: "credit",
          description: `Refund for Restaurant Booking (Payment Cancelled by Admin) - ${booking.bookingId || booking._id}`,
          status: "completed"
        });
        await wTxn.save();
        booking.payment.paymentStatus = "refunded";
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
        booking.bookingStatus = "Confirmed";
        booking.payment.paymentDate = paymentDate ? new Date(paymentDate) : new Date();
      } else if (newPaymentStatus === "cancelled" || newPaymentStatus === "failed") {
        booking.bookingStatus = "Cancelled";
      }
    }

    await booking.save();
    return res.status(200).json({ success: true, message: "Payment status updated successfully", data: booking });

  } catch (error) {
    console.error("Update Restaurant Payment Status Error:", error);
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

// Cancel booking
export const cancelRestaurantBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID"
      });
    }

    const booking = await restaurantBookingModel.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    if (booking.bookingStatus === "Cancelled") {
      return res.status(400).json({
        success: false,
        message: "Booking is already cancelled",
      });
    }

    if (booking.bookingStatus === "Completed") {
      return res.status(400).json({
        success: false,
        message: "Completed bookings cannot be cancelled",
      });
    }

    const isPaid = booking.payment.paymentStatus === "completed" || booking.payment.paymentStatus === "confirmed";
    const amountToRefund = booking.pricing.totalAmount;

    booking.bookingStatus = "Cancelled";

    if (isPaid) {
      booking.payment.paymentStatus = "refunded";
      const user = await userModel.findById(booking.userId);
      if (user) {
        user.walletBalance = (user.walletBalance || 0) + amountToRefund;
        await user.save();
        const wTxn = new WalletTransactionModel({
          userId: booking.userId,
          amount: amountToRefund,
          type: "credit",
          description: `Refund for Restaurant Booking (Cancelled by User) - ${booking.bookingId || booking._id}`,
          status: "completed"
        });
        await wTxn.save();
      }
    } else {
      booking.payment.paymentStatus = "cancelled";
    }

    booking.cancelledAt = new Date();
    await booking.save();

    return res.status(200).json({
      success: true,
      message: isPaid ? "Booking cancelled and refund processed to wallet successfully" : "Booking cancelled successfully",
      data: {
        bookingId: booking._id,
        refundAmount: isPaid ? amountToRefund : 0,
        paymentStatus: booking.payment.paymentStatus
      }
    });
  } catch (error) {
    console.error("Cancel Restaurant Booking Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
}