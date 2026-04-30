import log from "../utils/logger.js";
import hotelBookingModel from "../model/hotel.booking.model.js";
import hotelModel from "../model/hotel.model.js";
import { sendBadRequest, sendError, sendNotFound, sendSuccess } from "../utils/responseUtils.js";
import coupanModel from "../model/coupan.model.js";
import { sendNotification } from "../utils/notificatoin.utils.js";
import userModel from "../model/user.model.js";
import Stripe from "stripe";
import WalletTransactionModel from "../model/wallet.transaction.model.js";

export const createBooking = async (req, res) => {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET);
    const userId = req.user?._id;
    const { hotelId } = req.params;

    const {
      roomId,
      checkInDate,
      checkOutDate,
      adults = 1,
      isMySelf = true,
      name,
      email,
      phone,
      address,
      state,
      country,
      coupanCode,
      children = 0,
      infants = 0,
      numberOfRooms = 1,
      specialRequests = "",
      transactionId = "",
      paymentStatus = "pending",
      paymentMethod = "Stripe" // Can be 'Stripe' or 'Wallet'
    } = req.body;

    const hotel = await hotelModel.findById(hotelId);
    if (!hotel) return res.status(404).json({ success: false, message: "Hotel not found" });

    const room = hotel.rooms.id(roomId);
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });

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

    const roomRatePerNight = room.discountPrice; // Using the offered discount price as base
    const totalRoomRate = roomRatePerNight * numberOfNights * numberOfRooms;

    // Fixed mandatory 10% discount logic on top of the offered price
    const actualPrice = totalRoomRate;
    const discountPercentage = 10;
    const discountAmount = (actualPrice * discountPercentage) / 100;
    const discountPrice = actualPrice - discountAmount;

    // Tax and Service Fee combined (18% + 5% = 23%)
    const taxesAndFeesPercentage = 23;
    const taxesAndFeesAmount = (discountPrice * taxesAndFeesPercentage) / 100;
    const totalAmount = discountPrice + taxesAndFeesAmount;
    let user = {};

    if (isMySelf) {
      const dbUser = await userModel.findById(userId);
      user = {
        name: dbUser.name,
        email: dbUser.email,
        phone: dbUser.contactNo,
        address: dbUser.address,
        state: dbUser.state,
        country: dbUser.nationality,
      };
    }


    const booking = new hotelBookingModel({
      userId,
      hotelId,
      roomId,
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
        phone: isMySelf ? user.contactNo : phone,
        address: isMySelf ? user.address : address,
        state: isMySelf ? user.state : state,
        country: isMySelf ? user.nationality : country,
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
        taxesAndFeesPercentage,
        taxesAndFeesAmount,
        totalAmount,
        currency: "INR",
      },
      payment: {
        transactionId,
        paymentStatus,
        paymentMethod: "Razorpay",
        paymentDate: new Date(),
      },
    });

    const savedBooking = await booking.save();

    await sendNotification({
      adminId: hotel.adminId,
      title: `New Booking Created`,
      description: `Booking ID: ${savedBooking._id}\nHotel: ${hotel.name}\nDates: ${checkInDate} to ${checkOutDate}`,
      image: hotel.images[0] || null,
      type: "single",
      userId,
    }).catch((err) => console.error("Notification Error:", err.message));

    if (paymentMethod === "Wallet") {
      const dbUser = await userModel.findById(userId);
      if (!dbUser) return res.status(404).json({ success: false, message: "User not found" });

      if ((dbUser.walletBalance || 0) < totalAmount) {
        return res.status(400).json({ success: false, message: "Insufficient wallet balance" });
      }

      // Deduct from wallet
      dbUser.walletBalance -= totalAmount;
      await dbUser.save();

      // Create Wallet Transaction
      const wTxn = new WalletTransactionModel({
        userId,
        amount: totalAmount,
        type: "debit",
        description: `Hotel Booking - ${hotel.name}`,
        status: "completed"
      });
      await wTxn.save();

      // Update booking
      savedBooking.payment.paymentMethod = "Wallet";
      savedBooking.payment.paymentStatus = "completed";
      savedBooking.payment.transactionId = wTxn._id.toString();
      await savedBooking.save();

      return res.status(201).json({
        success: true,
        message: "Booking confirmed successfully via Wallet",
        result: savedBooking,
      });
    }

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "inr",
            product_data: {
              name: `Hotel Booking - ${hotel.name}`,
              description: `Room: ${room.type} | ${numberOfNights} Nights`,
              images: hotel.images && hotel.images.length > 0 ? [hotel.images[0]] : [],
            },
            unit_amount: Math.round(totalAmount * 100), // Stripe expects amount in paise (cents)
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/booking/success?session_id={CHECKOUT_SESSION_ID}&booking_id=${savedBooking._id}`,
      cancel_url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/booking/cancel?booking_id=${savedBooking._id}`,
      metadata: {
        bookingId: savedBooking._id.toString(),
        hotelId: hotelId.toString(),
        userId: userId ? userId.toString() : "guest",
      },
    });

    // Update booking with the Stripe session ID
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
      roomId,
      checkInDate,
      checkOutDate,
      couponCode,
      numberOfRooms = 1,
      adults = 1,
    } = req.body;

    if (!hotelId || !roomId || !checkInDate || !checkOutDate) {
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

    const room = hotel.rooms.id(roomId);
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });

    const numberOfNights = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

    const TAXES_AND_FEES_PERCENT = 23;

    const roomRatePerNight = room.discountPrice;
    const totalRoomRate = roomRatePerNight * numberOfNights * numberOfRooms;

    const actualPrice = totalRoomRate;
    const discountPercent = 10;
    const discountAmount = (actualPrice * discountPercent) / 100;
    const discountPrice = actualPrice - discountAmount;
    let couponDetails = null;

    if (couponCode) {
      couponDetails = {
        code: couponCode,
        discountPercent,
        description: "10% Discount Applied",
      };
    }

    const taxesAndFeesAmount = (discountPrice * TAXES_AND_FEES_PERCENT) / 100;
    const totalAmount = discountPrice + taxesAndFeesAmount;

    return res.status(200).json({
      success: true,
      message: "Booking preview generated successfully",
      result: {
        hotel: {
          id: hotel._id,
          name: hotel.name,
          city: hotel.address?.city,
        },
        room: {
          id: room._id,
          type: room.type,
          pricePerNight: roomRatePerNight,
          maxGuests: room.maxGuests,
          images: room.images || [],
        },
        booking: {
          checkInDate,
          checkOutDate,
          numberOfNights,
          numberOfRooms,
          adults,
        },
        costBreakdown: {
          actualPrice,
          discountPercent,
          discountAmount,
          discountPrice,
          taxesAndFeesPercent: TAXES_AND_FEES_PERCENT,
          taxesAndFeesAmount,
          totalAmount: Number(totalAmount.toFixed(2)),
          currency: "INR",
        },
        coupon: couponDetails,
      },
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
    console.log(guestId)
    const bookings = await hotelBookingModel
      .find({ userId: guestId })
      .populate("hotelId", "name address location")
      .populate("roomId")
      .populate("userId")
      .sort({ createdAt: -1 });

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

    const hotelBookings = await hotelBookingModel.find({ adminId });

    return sendSuccess(res, "Bookings fetched successfully", hotelBookings);
  } catch (error) {
    log.error(error.message);
    return sendError(res, 500, "Failed to fetch bookings", error.message);
  }
};


export const updateHotelPaymentStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const { bookingId } = req.params;

    const validStatuses = ["pending", "confirmed", "cancelled", "completed", "refunded", "failed"];

    if (!validStatuses.includes(status)) {
      return sendError(res, 400, "Invalid status value");
    }


    const booking = await hotelBookingModel.findOneAndUpdate(
      { _id: bookingId },
      { "payment.paymentStatus": status },
      { new: true }
    );
    if (!booking) {
      return sendError(res, 404, "Booking not found");
    }
    return sendSuccess(res, "Booking status updated successfully", booking);

  } catch (error) {
    log.error(error.message);
    return sendError(res, 500, "Failed to update booking status", error);
  }
}

export const updateHotelBookingStatus = async (req, res) => {
  try {
    const adminId = req.admin._id;
    const { id } = req.params;
    const { status } = req.query;
    console.log("dbeqyhvdb")
    const validStatuses = ["pending", "upcoming", "completed", "cancelled", "refunded"];

    if (!validStatuses.includes(status.toLowerCase())) {
      return sendError(res, 400, "Invalid booking status");
    }
    // Find booking
    const booking = await hotelBookingModel.findOne({ _id: id, adminId });
    if (!booking) {
      return sendError(res, 404, "Booking not found or not authorized");
    }

    // Update and save
    booking.bookingStatus = status.toLowerCase();
    await booking.save();


    return sendSuccess(res, "Booking status updated successfully", booking);
  } catch (error) {
    log.error(error.message);
    return sendError(res, 500, "Failed to update booking status", error.message);
  }
};
