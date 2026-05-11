import hotelBookingModel from "../model/hotel.booking.model.js";
import cafeBookingModel from "../model/cafe.booking.model.js";
import restaurantBookingModel from "../model/restro.booking.model.js";
import stayBookingModel from "../model/stay.booking.model.js";
import hallBookingModel from "../model/hall.booking.model.js";
import log from "../utils/logger.js";
import { sendError } from "../utils/responseUtils.js";

export const getMyPaymentsAndRefunds = async (req, res) => {
  try {
    const { _id: userId } = req.user;
    const now = new Date();

    
    const [hotelBookings, cafeBookings, restroBookings, stayBookings, hallBookings] = await Promise.all([
      hotelBookingModel.find({ userId }).populate("hotelId", "name address city").sort({ createdAt: -1 }),
      cafeBookingModel.find({ userId }).populate("cafeId", "name location").sort({ createdAt: -1 }),
      restaurantBookingModel.find({ userId }).populate("restaurantId", "name address city").sort({ createdAt: -1 }),
      stayBookingModel.find({ userId }).populate("stayId", "name location city").sort({ createdAt: -1 }),
      hallBookingModel.find({ userId }).populate("hallId", "name location city").sort({ createdAt: -1 })
    ]);

    const normalizeBooking = (booking, type) => {
      const paymentStatus = (booking.payment?.paymentStatus || "pending").toLowerCase();
      const bookingStatus = (booking.bookingStatus || "pending").toLowerCase();
      
      let status = "Pending";
      if (paymentStatus === "completed" || paymentStatus === "confirmed") status = "Completed";
      if (bookingStatus === "cancelled" || paymentStatus === "cancelled" || paymentStatus === "refunded") status = "Cancel";

      return {
        _id: booking._id,
        property_name: type === "hotel" ? booking.hotelId?.name : 
                       type === "cafe" ? booking.cafeId?.name : 
                       type === "stay" ? booking.stayId?.name :
                       type === "hall" ? booking.hallId?.name :
                       booking.restaurantId?.name,
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
      
      
      const cancelDate = new Date(booking.updatedAt || booking.createdAt);
      
      const reviewDate = new Date(cancelDate);
      reviewDate.setHours(reviewDate.getHours() + 12); 
      
      const checkProcessDate = new Date(cancelDate);
      checkProcessDate.setDate(checkProcessDate.getDate() + 7); 
      
      const refundCompletedDate = new Date(cancelDate);
      refundCompletedDate.setDate(refundCompletedDate.getDate() + 12); 

      
      const formatDate = (dateObj) => {
        return dateObj.toLocaleDateString('en-GB', { 
          day: '2-digit', month: 'short', year: '2-digit' 
        }) + " " + dateObj.toLocaleTimeString('en-US', { 
          hour: '2-digit', minute: '2-digit', hour12: true 
        }).toUpperCase();
      };

      const formatOnlyDate = (dateObj) => {
        return dateObj.toLocaleDateString('en-GB', { 
          day: '2-digit', month: 'short', year: '2-digit' 
        });
      };

      let timeline;
      if (isCompleted) {
        timeline = [
          { label: "Cancel your booking", date: formatDate(cancelDate), status: "completed" },
          { label: "Review your request", date: formatDate(reviewDate), status: "completed" },
          { label: "Check payment process", date: formatDate(checkProcessDate), status: "completed" },
          { label: "Process of your refund", date: formatDate(refundCompletedDate), status: "completed" }
        ];
      } else {
        timeline = [
          { label: "Cancel your booking", date: formatDate(cancelDate), status: "completed" },
          { label: "Review your request", date: formatDate(reviewDate), status: "completed" },
          { label: "Check payment process", date: "As soon possible", status: "pending" },
          { label: "Process of your refund", date: `Estimate date by ${formatOnlyDate(refundCompletedDate)}`, status: "pending" }
        ];
      }

      return {
        _id: booking._id,
        tracing_id: booking.bookingId || booking._id.toString().slice(-10).toUpperCase(),
        status: isCompleted ? "Completed" : "Pending",
        date: booking.updatedAt,
        amount: booking.pricing?.totalAmount || 0,
        currency: booking.pricing?.currency || "INR",
        timeline
      };
    };

    const payments = [
      ...hotelBookings.map(b => normalizeBooking(b, "hotel")),
      ...cafeBookings.map(b => normalizeBooking(b, "cafe")),
      ...restroBookings.map(b => normalizeBooking(b, "restro")),
      ...stayBookings.map(b => normalizeBooking(b, "stay")),
      ...hallBookings.map(b => normalizeBooking(b, "hall"))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const refunds = [
      ...hotelBookings.map(normalizeRefund),
      ...cafeBookings.map(normalizeRefund),
      ...restroBookings.map(normalizeRefund),
      ...stayBookings.map(normalizeRefund),
      ...hallBookings.map(normalizeRefund)
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