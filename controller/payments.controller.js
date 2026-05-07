import hotelBookingModel from "../model/hotel.booking.model.js";
import cafeBookingModel from "../model/cafe.booking.model.js";
import log from "../utils/logger.js";
import { sendBadRequest, sendError, sendNotFound, sendSuccess } from "../utils/responseUtils.js";
import mongoose from "mongoose";
import restaurantBookingModel from "../model/restro.booking.model.js";

export const getMyPaymentsAndRefunds = async (req, res) => {
  try {
    const { _id: userId } = req.user;
    const now = new Date();

    // 1. Fetch all bookings from all models
    const [hotelBookings, cafeBookings, restroBookings] = await Promise.all([
      hotelBookingModel.find({ userId }).populate("hotelId", "name address city").sort({ createdAt: -1 }),
      cafeBookingModel.find({ userId }).populate("cafeId", "name location").sort({ createdAt: -1 }),
      restaurantBookingModel.find({ userId }).populate("restaurantId", "name address city").sort({ createdAt: -1 })
    ]);

    const normalizeBooking = (booking, type) => {
      const paymentStatus = (booking.payment?.paymentStatus || "pending").toLowerCase();
      const bookingStatus = (booking.bookingStatus || "pending").toLowerCase();
      
      let status = "Pending";
      if (paymentStatus === "completed" || paymentStatus === "confirmed") status = "Completed";
      if (bookingStatus === "cancelled" || paymentStatus === "cancelled" || paymentStatus === "refunded") status = "Cancel";

      return {
        _id: booking._id,
        property_name: type === "hotel" ? booking.hotelId?.name : (type === "cafe" ? booking.cafeId?.name : booking.restaurantId?.name),
        status: status,
        checkIn: booking.bookingDates?.checkInDate || booking.checkInDate,
        checkOut: booking.bookingDates?.checkOutDate || booking.checkOutDate,
        bookingId: booking.bookingId || booking._id.toString().slice(-10).toUpperCase(),
        amount: booking.pricing?.totalAmount || 0,
        currency: booking.pricing?.currency || "INR",
        createdAt: booking.createdAt
      };
    };

    const normalizeRefund = (booking) => {
      const paymentStatus = (booking.payment?.paymentStatus || "").toLowerCase();
      if (paymentStatus !== "refunded" && (booking.bookingStatus || "").toLowerCase() !== "cancelled") return null;

      const isCompleted = paymentStatus === "refunded";

      return {
        _id: booking._id,
        tracing_id: booking.bookingId || booking._id.toString().slice(-10).toUpperCase(),
        status: isCompleted ? "Completed" : "Pending",
        date: booking.updatedAt,
        amount: booking.pricing?.totalAmount || 0,
        currency: booking.pricing?.currency || "INR",
        timeline: [
          { label: "Cancel your booking", date: booking.updatedAt, status: "completed" },
          { label: "Review your request", date: booking.updatedAt, status: isCompleted ? "completed" : "pending" },
          { label: "Check payment process", status: isCompleted ? "completed" : "pending" },
          { label: "Process of your refund", status: isCompleted ? "completed" : "pending" }
        ]
      };
    };

    const payments = [
      ...hotelBookings.map(b => normalizeBooking(b, "hotel")),
      ...cafeBookings.map(b => normalizeBooking(b, "cafe")),
      ...restroBookings.map(b => normalizeBooking(b, "restro"))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const refunds = [
      ...hotelBookings.map(normalizeRefund),
      ...cafeBookings.map(normalizeRefund),
      ...restroBookings.map(normalizeRefund)
    ].filter(Boolean).sort((a, b) => new Date(b.date) - new Date(a.date));

    return res.status(200).json({
      success: true,
      message: "Payments and refunds fetched successfully",
      result: {
        payments,
        refunds
      }
    });
  } catch (error) {
    log.error(`Error fetching payments/refunds: ${error.message}`);
    return sendError(res, 500, "Failed to fetch payments and refunds", error.message);
  }
};
