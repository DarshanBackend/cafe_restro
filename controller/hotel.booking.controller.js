import log from "../utils/logger.js";
import hotelBookingModel from "../model/hotel.booking.model.js";
import hotelModel from "../model/hotel.model.js";
import { sendBadRequest, sendError, sendNotFound, sendSuccess } from "../utils/responseUtils.js";
import coupanModel from "../model/coupan.model.js";
import { sendNotification } from "../utils/notification.utils.js";
import userModel from "../model/user.model.js";
import Stripe from "stripe";
import WalletTransactionModel from "../model/wallet.transaction.model.js";

export const createBooking = async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET) {
      return res.status(500).json({ success: false, message: "Stripe API key is missing in environment variables" });
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET);
    const userId = req.user?._id;
    const { hotelId } = req.params;

    const {
      checkInDate,
      checkOutDate,
      adults = 1,
      isMySelf = true,
      name,
      email,
      phone,
      coupanCode,
      children = 0,
      infants = 0,
      numberOfRooms = 1,
      specialRequests = "",
      transactionId = "",
      paymentStatus = "pending",
      paymentMethod = "Stripe"
    } = req.body;

    const hotel = await hotelModel.findById(hotelId);
    if (!hotel) return res.status(404).json({ success: false, message: "Hotel not found" });

    const parseDate = (d) => {
      const [day, month, year] = d.split("-");
      return new Date(`${year}-${month}-${day}`);
    };

    const checkIn = parseDate(checkInDate);
    const checkOut = parseDate(checkOutDate);

    const numberOfNights = Math.max(
      1,
      Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24))
    );

    const roomRatePerNight = hotel.discountPrice;
    const totalRoomRate = roomRatePerNight * numberOfNights * numberOfRooms;

    const actualPrice = totalRoomRate;
    const discountPercentage = 10;
    const discountAmount = (actualPrice * discountPercentage) / 100;
    const discountPrice = actualPrice - discountAmount;

    let couponDetails = null;
    let amountAfterCoupon = discountPrice;

    if (coupanCode) {
      const coupon = await coupanModel.findOne({ couponCode: coupanCode.toUpperCase() });
      if (!coupon) {
        return res.status(400).json({ success: false, message: "Invalid coupon code" });
      }
      if (!coupon.isActive) {
        return res.status(400).json({ success: false, message: "This coupon is no longer active" });
      }
      if (coupon.couponExpire && new Date(coupon.couponExpire) < new Date()) {
        return res.status(400).json({ success: false, message: "This coupon has expired" });
      }

      const couponDiscountPercent = coupon.couponPerc || 0;
      const couponDiscountAmount = (discountPrice * couponDiscountPercent) / 100;
      amountAfterCoupon = discountPrice - couponDiscountAmount;

      couponDetails = {
        code: coupon.couponCode,
        discountPercent: couponDiscountPercent,
        discountAmount: couponDiscountAmount,
      };
    }

    const taxesAndFeesPercentage = 23;
    const taxesAndFeesAmount = (amountAfterCoupon * taxesAndFeesPercentage) / 100;
    const totalAmount = amountAfterCoupon + taxesAndFeesAmount;
    let user = {};

    const normalizedPaymentMethod = paymentMethod ? paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1).toLowerCase() : "Stripe";

    let dbUser = null;
    if (isMySelf || normalizedPaymentMethod === "Wallet") {
      dbUser = await userModel.findById(userId);
      if (!dbUser) return res.status(404).json({ success: false, message: "User not found" });

      if (isMySelf) {
        const defaultAddr = dbUser.addresses?.find(a => a.isDefault) || dbUser.addresses?.[0];

        user = {
          name: defaultAddr?.name || dbUser.name,
          email: defaultAddr?.email || dbUser.email,
          phone: defaultAddr?.contactNo || dbUser.contactNo,
          address: defaultAddr?.address || dbUser.address,
          state: defaultAddr?.state || dbUser.state,
          country: defaultAddr?.country || dbUser.nationality || dbUser.country,
        };
      }
    }

    if (normalizedPaymentMethod === "Wallet") {
      const finalTotal = totalAmount;
      if ((dbUser.walletBalance || 0) < finalTotal) {
        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. Your balance is ₹${dbUser.walletBalance || 0}, but the booking total is ₹${finalTotal.toFixed(2)}.`
        });
      }
    }

    const booking = new hotelBookingModel({
      userId,
      hotelId,
      adminId: hotel.adminId,
      numberOfRooms,
      bookingDates: {
        checkInDate: checkIn,
        checkOutDate: checkOut,
        numberOfNights,
      },
      guest: {
        isMySelf,
        name: isMySelf ? user.name : name,
        email: isMySelf ? user.email : email,
        phone: isMySelf ? user.phone : phone,
        address: isMySelf ? user.address : "",
        state: isMySelf ? user.state : "",
        country: isMySelf ? user.country : "",
      },
      guestInfo: {
        adults,
        children,
        infants,
        specialRequests,
      },
      pricing: {
        roomRatePerNight,
        totalRoomRate,
        actualPrice,
        discountPercentage,
        discountAmount,
        discountPrice,
        couponDiscountAmount: couponDetails ? couponDetails.discountAmount : 0,
        priceAfterCoupon: amountAfterCoupon,
        taxesAndFeesPercentage,
        taxesAndFeesAmount,
        totalAmount,
        currency: "INR",
        couponCode: couponDetails ? couponDetails.code : null,
      },
      payment: {
        transactionId: transactionId || "",
        paymentStatus: paymentStatus || "pending",
        paymentMethod: normalizedPaymentMethod,
        paymentDate: new Date(),
      },
    });

    const savedBooking = await booking.save();

    await sendNotification({
      userId,
      title: `Booking Confirmed! 🏨`,
      message: `Your booking for ${hotel.name} from ${checkInDate} to ${checkOutDate} has been successfully created. Booking ID: ${savedBooking.bookingId || savedBooking._id.toString().slice(-10).toUpperCase()}`,
      image: hotel.images[0] || null,
      type: "HOTEL_BOOKING",
      reference: { bookingId: savedBooking._id, hotelId: hotel._id }
    }).catch((err) => console.error("Notification Error:", err.message));

    if (normalizedPaymentMethod === "Wallet") {
      const finalTotal = totalAmount;
      dbUser.walletBalance -= finalTotal;
      await dbUser.save();

      const wTxn = new WalletTransactionModel({
        userId,
        amount: finalTotal,
        type: "debit",
        description: `Hotel Booking - ${hotel.name}`,
        status: "completed"
      });
      await wTxn.save();

      savedBooking.payment.paymentMethod = "Wallet";
      savedBooking.payment.paymentStatus = "completed";
      savedBooking.payment.transactionId = wTxn._id.toString();
      await savedBooking.save();

      return res.status(201).json({
        success: true,
        message: "Booking confirmed successfully via Wallet",
        result: [savedBooking],
        length: 1
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "inr",
            product_data: {
              name: `Hotel Booking - ${hotel.name}`,
              description: `Booking for ${numberOfRooms} Rooms | ${numberOfNights} Nights`,
              images: hotel.images && hotel.images.length > 0 ? [hotel.images[0]] : [],
            },
            unit_amount: Math.round(totalAmount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/success`,
      cancel_url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/cancel`,
      metadata: {
        bookingId: savedBooking._id.toString(),
        hotelId: hotelId.toString(),
        userId: userId ? userId.toString() : "guest",
      },
    });

    savedBooking.payment.transactionId = session.id;
    savedBooking.payment.paymentMethod = "Stripe";
    await savedBooking.save();

    return res.status(201).json({
      success: true,
      message: "Booking initialized successfully",
      result: savedBooking,
      sessionId: session.id,
      url: session.url
    });
  } catch (err) {
    console.error("createBooking Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const previewHotelBooking = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const {
      checkInDate,
      checkOutDate,
      couponCode,
      numberOfRooms = 1,
      adults = 1,
      children = 0,
    } = req.body;

    if (!hotelId || !checkInDate || !checkOutDate) {
      return res.status(400).json({ success: false, message: "Missing required booking details" });
    }

    const parseDate = (dateStr) => {
      const [d, m, y] = dateStr.split("-");
      return new Date(`${y}-${m}-${d}`);
    };

    const startDate = parseDate(checkInDate);
    const endDate = parseDate(checkOutDate);

    if (isNaN(startDate) || isNaN(endDate)) {
      return res.status(400).json({ success: false, message: "Invalid date format (use DD-MM-YYYY)" });
    }

    if (endDate <= startDate) {
      return res.status(400).json({ success: false, message: "Check-out date must be after check-in date" });
    }

    const hotel = await hotelModel.findById(hotelId);
    if (!hotel) return res.status(404).json({ success: false, message: "Hotel not found" });

    const numberOfNights = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

    const TAXES_AND_FEES_PERCENT = 23;

    const roomRatePerNight = hotel.discountPrice;
    const totalRoomRate = roomRatePerNight * numberOfNights * numberOfRooms;

    const actualPrice = totalRoomRate;
    const discountPercent = 10;
    const discountAmount = (actualPrice * discountPercent) / 100;
    const discountPrice = actualPrice - discountAmount;
    let couponDetails = null;
    let amountAfterCoupon = discountPrice;

    if (couponCode) {
      const coupon = await coupanModel.findOne({ couponCode: couponCode.toUpperCase() });
      if (!coupon) {
        return res.status(400).json({ success: false, message: "Invalid coupon code" });
      }
      if (!coupon.isActive) {
        return res.status(400).json({ success: false, message: "This coupon is no longer active" });
      }
      if (coupon.couponExpire && new Date(coupon.couponExpire) < new Date()) {
        return res.status(400).json({ success: false, message: "This coupon has expired" });
      }

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

    const taxesAndFeesAmount = (amountAfterCoupon * TAXES_AND_FEES_PERCENT) / 100;
    const totalAmount = amountAfterCoupon + taxesAndFeesAmount;

    const round = (num) => Math.round(num * 100) / 100;

    return res.status(200).json({
      success: true,
      message: "Booking preview generated successfully",
      result: [
        {
          hotelDetails: {
            id: hotel._id,
            name: hotel.name,
            city: hotel.city,
            location: hotel.location,
            starRating: hotel.starRating || 0,
            image: hotel.images?.[0] || null,
            amenities: hotel.amenities || [],
          },
          bookingDetails: {
            checkInDate: checkInDate,
            checkOutDate: checkOutDate,
            numberOfNights: numberOfNights,
            numberOfRooms: numberOfRooms,
            adults: adults,
            children: children || 0,
          },
          paymentSummary: {
            title: "Payment Information",
            items: [
              {
                label: `${numberOfRooms} Room * ${numberOfNights} Night`,
                value: round(totalRoomRate).toFixed(2),
                prefix: "₹"
              },
              {
                label: "Mandatory Discount (10%)",
                value: `-₹${round(discountAmount).toFixed(2)}`,
                type: "discount"
              },
              {
                label: "Price After Mandatory Discount",
                value: round(discountPrice).toFixed(2),
                prefix: "₹"
              },
              couponDetails ? {
                label: `Promo Code (${couponDetails.code})`,
                value: `-₹${round(couponDetails.discountAmount).toFixed(2)}`,
                type: "discount"
              } : null,
              {
                label: "Taxes (18%) & Services (5%)",
                value: round(taxesAndFeesAmount).toFixed(2),
                prefix: "₹"
              },
              {
                label: "Total Amount of Paid",
                value: round(totalAmount).toFixed(2),
                prefix: "₹",
                bold: true
              }
            ].filter(Boolean),
            totalAmount: round(totalAmount),
            currency: "INR",
            coupon: couponDetails || null,
            proceedAction: "Process To Paid"
          }
        }
      ],
      length: 1
    });
  } catch (error) {
    console.error("previewHotelBooking Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate booking preview",
      error: error.message,
    });
  }
};

export const getMyHotelBookings = async (req, res) => {
  try {
    const guestId = req.user?._id;
    const bookings = await hotelBookingModel
      .find({ userId: guestId })
      .populate("hotelId", "name address location images")
      .populate("userId")
      .sort({ createdAt: -1 });

    const now = new Date();
    for (let booking of bookings) {
      if (
        ["confirmed", "upcoming", "pending"].includes(booking.bookingStatus.toLowerCase()) &&
        new Date(booking.bookingDates.checkOutDate) < now
      ) {
        booking.bookingStatus = "completed";
        await booking.save();
      }
    }

    return sendSuccess(res, `Booking fetching successfull`, bookings);

  } catch (error) {
    log.error(error.message);
    return sendError(res, 500, "Failed to fetch bookings", error);
  }
}

export const hotelAdminBookings = async (req, res) => {
  try {
    const adminId = req.admin?._id;

    if (!adminId) {
      return sendError(res, 400, "Admin ID not found");
    }

    const hotelBookings = await hotelBookingModel
      .find({ adminId })
      .populate("hotelId", "name address location images")
      .populate("userId", "name email contactNo")
      .sort({ createdAt: -1 });

    const now = new Date();
    for (let booking of hotelBookings) {
      if (
        ["confirmed", "upcoming", "pending"].includes(booking.bookingStatus.toLowerCase()) &&
        new Date(booking.bookingDates.checkOutDate) < now
      ) {
        booking.bookingStatus = "completed";
        await booking.save();
      }
    }

    return sendSuccess(res, "Bookings fetched successfully", hotelBookings);
  } catch (error) {
    log.error(error.message);
    return sendError(res, 500, "Failed to fetch bookings", error.message);
  }
};

export const updateHotelPaymentStatus = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    if (!adminId) return sendError(res, 400, "Admin ID not found");

    const { status } = req.body;
    const { bookingId } = req.params;

    const validStatuses = ["pending", "confirmed", "cancelled", "completed", "refunded", "failed"];

    if (!validStatuses.includes(status.toLowerCase())) {
      return sendError(res, 400, "Invalid status value");
    }

    const booking = await hotelBookingModel.findOne({ _id: bookingId });
    if (!booking) {
      return sendError(res, 404, "Booking not found");
    }

    const previousPaymentStatus = booking.payment.paymentStatus.toLowerCase();
    const newPaymentStatus = status.toLowerCase();

    if (newPaymentStatus === "refunded" && previousPaymentStatus !== "refunded") {
      const amountToRefund = booking.pricing.totalAmount;
      const user = await userModel.findById(booking.userId);

      if (user) {
        user.walletBalance = (user.walletBalance || 0) + amountToRefund;
        await user.save();

        const wTxn = new WalletTransactionModel({
          userId: user._id,
          amount: amountToRefund,
          type: "credit",
          description: `Refund for Hotel Booking (Approved by Admin) - ${booking.bookingId || booking._id}`,
          status: "completed"
        });
        await wTxn.save();

        booking.payment.paymentStatus = "refunded";
        booking.bookingStatus = "cancelled";
      } else {
        booking.payment.paymentStatus = "refunded";
        booking.bookingStatus = "cancelled";
      }
    } 
    else if (newPaymentStatus === "cancelled" && (previousPaymentStatus === "completed" || previousPaymentStatus === "confirmed")) {
      booking.payment.paymentStatus = "cancelled";
      booking.bookingStatus = "cancelled";
    } else {
      booking.payment.paymentStatus = newPaymentStatus;

      if (newPaymentStatus === "completed" || newPaymentStatus === "confirmed") {
        booking.bookingStatus = "confirmed";
        booking.payment.paymentDate = new Date();
      } else if (newPaymentStatus === "cancelled" || newPaymentStatus === "failed") {
        booking.bookingStatus = "cancelled";
      }
    }

    await booking.save();
    return sendSuccess(res, "Booking payment status updated successfully", [booking]);

  } catch (error) {
    log.error(error.message);
    return sendError(res, 500, "Failed to update booking status", error.message);
  }
}

export const updateHotelBookingStatus = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    if (!adminId) return sendError(res, 400, "Admin ID not found");

    const { id } = req.params;
    const { status } = req.body;

    if (!status) return sendError(res, 400, "Status is required in request body");

    const validStatuses = ["pending", "upcoming", "completed", "cancelled", "refunded", "confirmed"];

    if (!validStatuses.includes(status.toLowerCase())) {
      return sendError(res, 400, "Invalid booking status");
    }

    const booking = await hotelBookingModel.findOne({ _id: id });
    if (!booking) {
      return sendError(res, 404, "Booking not found");
    }

    const previousStatus = booking.bookingStatus.toLowerCase();
    const newStatus = status.toLowerCase();

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
            description: `Refund for Hotel Booking (Cancelled by Admin) - ${booking.bookingId || booking._id}`,
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
    log.error(error.message);
    return sendError(res, 500, "Failed to update booking status", error.message);
  }
};

export const cancelHotelBooking = async (req, res) => {
  try {
    const userId = req.user._id;
    const { bookingId } = req.params;

    const booking = await hotelBookingModel.findOne({ _id: bookingId, userId });
    if (!booking) {
      return sendError(res, 404, "Booking not found or not authorized");
    }

    if (["cancelled", "refunded"].includes(booking.bookingStatus.toLowerCase())) {
      return sendError(res, 400, "Booking is already cancelled or refunded");
    }

    const isPaid = booking.payment.paymentStatus === "completed" || booking.payment.paymentStatus === "confirmed";
    const amountToRefund = booking.pricing.totalAmount;

    booking.bookingStatus = "cancelled";

    if (isPaid) {
      booking.payment.paymentStatus = "cancelled";
    } else {
      booking.payment.paymentStatus = "cancelled";
    }

    await booking.save();

    return sendSuccess(res, isPaid ? "Booking cancelled. Refund request has been sent for processing." : "Booking cancelled successfully", {
      bookingId: booking._id,
      paymentStatus: booking.payment.paymentStatus
    });

  } catch (error) {
    log.error(error.message);
    return sendError(res, 500, "Failed to cancel booking", error.message);
  }
};
