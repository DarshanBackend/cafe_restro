import cafeBookingModel from "../model/cafe.booking.model.js";
import cafeModel from "../model/cafe.model.js";
import mongoose from "mongoose";
import { sendBadRequest, sendNotFound } from "../utils/responseUtils.js";
import { v4 as uuidv4 } from "uuid";
import log from "../utils/logger.js";
import coupanModel from "../model/coupan.model.js";
import { sendNotification } from "../utils/notificatoin.utils.js";

// Create new cafe booking
export const createCafeBooking = async (req, res) => {
  try {
    const { cafeId } = req.params;
    const {
      bookingDate,
      timeSlot,
      numberOfGuests,
      specialRequests,
      perGuestRate,
      guestDetails,
      paymentMethod,
      transactionId,
      paymentStatus,
      paymentDate,
      couponCode,
      currency,
    } = req.body;

    const userId = req.user?._id;

    // Validation
    if (!cafeId || !bookingDate || !timeSlot || !numberOfGuests) {
      return res.status(400).json({
        success: false,
        message: "Cafe ID, booking date, time slot, and number of guests are required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(cafeId)) {
      return res.status(400).json({ success: false, message: "Invalid cafe ID" });
    }

    const cafe = await cafeModel.findById(cafeId);
    if (!cafe) {
      return res.status(404).json({ success: false, message: "Cafe not found" });
    }

    // Prevent booking in past
    const bookingDateTime = new Date(bookingDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (bookingDateTime < today) {
      return res.status(400).json({
        success: false,
        message: "Booking date cannot be in the past",
      });
    }

    // Check slot availability
    const existingBooking = await cafeBookingModel.findOne({
      cafeId,
      bookingDate: bookingDateTime,
      timeSlot,
      bookingStatus: { $in: ["Upcoming", "pending", "confirmed"] },
    });

    if (existingBooking) {
      return res.status(409).json({
        success: false,
        message: "This time slot is already booked. Please choose another time.",
      });
    }

    // ---------------- Billing Logic ---------------- //
    const guestRate = perGuestRate || cafe.pricing?.discountPrice || 200;
    const totalGuestRate = guestRate * numberOfGuests;

    const actualPrice = totalGuestRate;
    const discountPercentage = 10;
    const discountAmount = (actualPrice * discountPercentage) / 100;
    const discountPrice = actualPrice - discountAmount;
    
    const taxesAndFeesPercentage = 23;
    const taxesAndFeesAmount = (discountPrice * taxesAndFeesPercentage) / 100;
    const totalAmount = discountPrice + taxesAndFeesAmount;

    // Optional rounding for cleaner values
    const round = (num) => Math.round(num * 100) / 100;

    const finalPricing = {
      perGuestRate: round(guestRate),
      totalGuestRate: round(totalGuestRate),
      actualPrice: round(actualPrice),
      discountPercentage: round(discountPercentage),
      discountAmount: round(discountAmount),
      discountPrice: round(discountPrice),
      taxesAndFeesPercentage: round(taxesAndFeesPercentage),
      taxesAndFeesAmount: round(taxesAndFeesAmount),
      totalAmount: round(totalAmount),
      currency: currency || cafe.pricing?.currency || "INR",
    };

    console.log("BILLING:", finalPricing);

    // ---------------- Guest & Payment Info ---------------- //
    const guest = {
      isMySelf: guestDetails?.isMySelf ?? true,
      name: guestDetails?.name || "",
      email: guestDetails?.email || "",
      phone: guestDetails?.phone || "",
      address: guestDetails?.address || "",
      state: guestDetails?.state || "",
      country: guestDetails?.country || "",
    };

    const payment = {
      transactionId: transactionId || "",
      paymentStatus: paymentStatus || "pending",
      paymentMethod: paymentMethod || "Razorpay",
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
    };

    // ---------------- Create Booking ---------------- //
    const newBooking = new cafeBookingModel({
      bookingId: uuidv4(),
      userId,
      adminId: cafe.createdBy,
      cafeId,
      bookingDate: bookingDateTime,
      timeSlot,
      numberOfGuests,
      guest,
      guestInfo: { specialRequests: specialRequests || "" },
      pricing: finalPricing,
      payment,
      bookingStatus: "Upcoming",
    });

    await newBooking.save();
    await newBooking.populate("cafeId", "name location images");

    await sendNotification({ adminId: cafe.createdBy, title: `Your Cafe Booking In Cafe : ${cafe.name}`, description: "Your Booking in Cafe ", image: cafe.images[0] || null, type: "single", userId: userId })

    return res.status(201).json({
      success: true,
      message: "Cafe booking created successfully",
      data: newBooking,
    });
  } catch (error) {
    console.error("Create Cafe Booking Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};




// Get all bookings for a user
export const getUserBookings = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { page = 1, limit = 10, status } = req.query;

    // Build filter
    const filter = { userId };
    if (status && ["pending", "confirmed", "cancelled", "completed"].includes(status)) {
      filter.bookingStatus = status;
    }

    const bookings = await cafeBookingModel
      .find(filter)
      .populate('cafeId', 'name location images pricing')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await cafeBookingModel.countDocuments(filter);

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
    console.error("Get User Bookings Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};

// Get all bookings for a cafe (for cafe owners/admins)
export const getCafeBookings = async (req, res) => {
  try {
    const { cafeId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(cafeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid cafe ID",
      });
    }

    // Fetch all bookings for this cafe
    const bookings = await cafeBookingModel
      .find({ cafeId })
      .populate("userId", "name email phone")
      .sort({ bookingDate: 1, timeSlot: 1 });

    return res.status(200).json({
      success: true,
      message: `${bookings.length} bookings found`,
      data: bookings,
    });
  } catch (error) {
    console.error("Get Cafe Bookings Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};


// Get booking by ID
export const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID"
      });
    }

    const booking = await cafeBookingModel
      .findById(id)
      .populate('userId', 'name email phone')
      .populate('cafeId', 'name location images contact pricing operatingHours');

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
    console.error("Get Booking Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};

export const previewCafeBooking = async (req, res) => {
  try {
    const { cafeId } = req.params;
    const {
      bookingDate,
      startTime,
      endTime,
      numberOfTables = 1,
      numberOfGuests = 1,
      specialRequests = "",
      couponCode
    } = req.body;

    if (!bookingDate || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: "Booking date, startTime, and endTime are required."
      });
    }

    if (!mongoose.Types.ObjectId.isValid(cafeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid cafe ID."
      });
    }

    const bookingDateObj = new Date(bookingDate);
    if (isNaN(bookingDateObj.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking date format."
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (bookingDateObj < today) {
      return res.status(400).json({
        success: false,
        message: "Booking date cannot be in the past."
      });
    }

    const cafe = await cafeModel.findById(cafeId);
    if (!cafe) {
      return res.status(404).json({
        success: false,
        message: "Cafe not found."
      });
    }

    const [startHour, startMin] = startTime.split(":").map(Number);
    const [endHour, endMin] = endTime.split(":").map(Number);

    const durationHours = (endHour + endMin / 60) - (startHour + startMin / 60);
    if (durationHours <= 0 || durationHours > 12) {
      return res.status(400).json({
        success: false,
        message: "Invalid time range. Duration must be between 1 and 12 hours."
      });
    }

    const baseRatePerHour = cafe.pricing?.discountPrice || 100; // Using offered discount price as base
    const currency = cafe.pricing?.currency || "INR";
    const baseSubtotal = baseRatePerHour * durationHours * numberOfTables;

    const dayOfWeek = bookingDateObj.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const weekendMultiplier = isWeekend ? 1.1 : 1;
    const isEvening = endHour >= 18;
    const peakHourMultiplier = isEvening ? 1.15 : 1;

    const subtotalBeforeDiscount = baseSubtotal * weekendMultiplier * peakHourMultiplier;

    const actualPrice = subtotalBeforeDiscount;
    const discountPercentage = 10;
    const discountAmount = (actualPrice * discountPercentage) / 100;
    const discountPrice = actualPrice - discountAmount;

    // 🎟️ Coupon Logic (Removed custom discounts)
    let couponDetails = null;
    if (couponCode) {
      couponDetails = {
        code: couponCode,
        discountPercent: discountPercentage,
        discountApplied: discountAmount,
        description: "10% Flat Discount"
      };
    }

    // 💰 Charges & Total Calculation
    const taxesAndFeesPercentage = 23;
    const taxesAndFeesAmount = (discountPrice * taxesAndFeesPercentage) / 100;
    const totalAmount = discountPrice + taxesAndFeesAmount;

    // ✅ Response
    return res.status(200).json({
      success: true,
      data: {
        cafeDetails: {
          _id: cafe._id,
          name: cafe.name,
          themeCategory: cafe.themeCategory?.name || null,
          address: cafe.location?.address || null,
          image: cafe.images?.[0] || null
        },
        bookingDetails: {
          bookingDate,
          startTime,
          endTime,
          durationHours,
          numberOfTables,
          numberOfGuests,
          specialRequests,
          isWeekend,
          isPeakHour: isEvening
        },
        coupon: couponDetails,
        paymentSummary: {
          title: "Payment Information",
          items: [
            {
              label: `${numberOfTables} Table × ${durationHours} Hours`,
              value: baseSubtotal.toFixed(2),
              prefix: "₹"
            },
            {
              label: "Weekend / Peak Adjustment",
              value: ((weekendMultiplier * peakHourMultiplier - 1) * 100).toFixed(1) + "%",
              type: "surcharge"
            },
            {
              label: "10% Discount",
              value: `-₹${discountAmount.toFixed(2)}`,
              type: "discount"
            },
            {
              label: "Discounted Price",
              value: discountPrice.toFixed(2),
              prefix: "₹"
            },
            {
              label: "Taxes & Fees (23%)",
              value: taxesAndFeesAmount.toFixed(2),
              prefix: "₹"
            },
            {
              label: "Total Amount to Pay",
              value: totalAmount.toFixed(2),
              prefix: "₹",
              bold: true
            }
          ],
          totalAmount: totalAmount.toFixed(2),
          currency,
          proceedAction: "Proceed To Pay"
        }
      }
    });

  } catch (err) {
    console.error("Preview Cafe Booking Error:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
};


// Update booking status
export const updateBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { bookingStatus } = req.body;
    const adminId = req.admin?._id; 

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID"
      });
    }

    let validStatuses =  ["Upcoming", "Completed", "Cancelled", "Refunded"];

    if (!bookingStatus || !validStatuses.includes(bookingStatus)) {
      return res.status(400).json({
        success: false,
        message: "Valid booking status is required"
      });
    }

    const booking = await cafeBookingModel.findOne({ _id: id, adminId: adminId });
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }


    const previousStatus = booking.bookingStatus;
    booking.bookingStatus = bookingStatus;

    if (bookingStatus === 'cancelled') {
      booking.payment.paymentStatus = 'cancelled';
    } else if (bookingStatus === 'confirmed' && previousStatus === 'pending') {
      booking.payment.paymentStatus = 'confirmed';
      booking.payment.paymentDate = new Date();
    }

    await booking.save();

    await booking.populate('cafeId', 'name location images themeCategory');
    await booking.populate('userId', 'name email phone');

    return res.status(200).json({
      success: true,
      message: `Booking ${bookingStatus} successfully`,
      data: booking
    });

  } catch (error) {
    console.error("Update Booking Status Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};


// Update payment status
export const updatePaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      paymentStatus,
      transactionId,
      paymentMethod,
      paymentDate
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID"
      });
    }

    let validStatuses = ["pending", "confirmed", "cancelled", "completed", "refunded", "failed"];
    if (!paymentStatus || !validStatuses.includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: "Valid payment status is required"
      });
    }

    const booking = await cafeBookingModel.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    // Update payment details
    booking.payment.paymentStatus = paymentStatus;
    if (transactionId) booking.payment.transactionId = transactionId;
    if (paymentMethod) booking.payment.paymentMethod = paymentMethod;
    if (paymentDate) {
      booking.payment.paymentDate = new Date(paymentDate);
    } else if (paymentStatus === 'confirmed') {
      booking.payment.paymentDate = new Date();
    }

    await booking.save();

    return res.status(200).json({
      success: true,
      message: `Payment status updated to ${paymentStatus}`,
      data: booking
    });

  } catch (error) {
    console.error("Update Payment Status Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};

// Cancel booking
export const cancelBooking = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID",
      });
    }

    const booking = await cafeBookingModel.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    // Validate booking status
    const validStatuses = ["Upcoming", "Completed", "Cancelled", "Refunded"];
    if (!validStatuses.includes(booking.bookingStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking status",
      });
    }

    // Check if user is authorized
    const userId = req.user?._id;
    const isAdmin = req.user?.role === "admin";
    if (!isAdmin && booking.userId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to cancel this booking",
      });
    }

    // Check if booking can be cancelled
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
    let vaildPaymentStatus = ["pending", "confirmed", "cancelled", "completed", "refunded", "failed"];
    if (!vaildPaymentStatus.includes(booking.payment.paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment status"
      });
    }
    // Update booking
    booking.bookingStatus = "Cancelled";
    if (booking.payment) {
      booking.payment.paymentStatus = "cancelled";
    }

    await booking.save();

    return res.status(200).json({
      success: true,
      message: "Booking cancelled successfully",
      data: booking,
    });
  } catch (error) {
    console.error("Cancel Booking Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};


// Get available time slots for a cafe
export const getAvailableTimeSlots = async (req, res) => {
  try {
    const { cafeId, date } = req.query;

    if (!cafeId || !date) {
      return res.status(400).json({
        success: false,
        message: "Cafe ID and date are required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(cafeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid cafe ID"
      });
    }

    let bookingDate;
    try {
      // Try parsing as ISO string (YYYY-MM-DD)
      if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        bookingDate = new Date(date);
      }
      // Try parsing as timestamp
      else if (date.match(/^\d+$/)) {
        bookingDate = new Date(parseInt(date));
      }
      // Try parsing as any other date string
      else {
        bookingDate = new Date(date);
      }

      // Check if date is valid
      if (isNaN(bookingDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format. Please use YYYY-MM-DD format"
        });
      }
    } catch (dateError) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Please use YYYY-MM-DD format"
      });
    }

    // Normalize date to start of day for comparison
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const normalizedBookingDate = new Date(bookingDate);
    normalizedBookingDate.setHours(0, 0, 0, 0);

    if (normalizedBookingDate < today) {
      return res.status(400).json({
        success: false,
        message: "Date cannot be in the past"
      });
    }

    // Get cafe operating hours
    const cafe = await cafeModel.findById(cafeId);
    if (!cafe) {
      return res.status(404).json({
        success: false,
        message: "Cafe not found"
      });
    }

    // Define available time slots (you can customize this)
    const timeSlots = [
      "09:00-10:00", "10:00-11:00", "11:00-12:00",
      "12:00-13:00", "13:00-14:00", "14:00-15:00",
      "15:00-16:00", "16:00-17:00", "17:00-18:00",
      "18:00-19:00", "19:00-20:00", "20:00-21:00"
    ];

    // Get booked time slots for the date - FIXED date comparison
    const bookedSlots = await cafeBookingModel.find({
      cafeId,
      bookingDate: {
        $gte: normalizedBookingDate,
        $lt: new Date(normalizedBookingDate.getTime() + 24 * 60 * 60 * 1000) // Next day
      },
      bookingStatus: { $in: ["pending", "confirmed"] }
    }).select('timeSlot');

    const bookedTimeSlots = bookedSlots.map(booking => booking.timeSlot);

    // Filter available time slots
    const availableSlots = timeSlots.filter(slot => !bookedTimeSlots.includes(slot));

    return res.status(200).json({
      success: true,
      data: {
        cafe: cafe.name,
        date: normalizedBookingDate.toISOString().split('T')[0],
        availableSlots,
        bookedSlots: bookedTimeSlots,
        totalAvailable: availableSlots.length,
        totalBooked: bookedTimeSlots.length
      }
    });

  } catch (error) {
    console.error("Get Available Time Slots Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};