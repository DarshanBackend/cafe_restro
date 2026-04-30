import hallModel from "../model/hall.model.js";
import hallBookingModel from "../model/hall.booking.model.js";
import mongoose from "mongoose";
import { sendBadRequest } from "../utils/responseUtils.js";


export const createHallBooking = async (req, res) => {
  try {
    const { hallId } = req.params;
    const {
      startDate,
      endDate,
      startTime,
      endTime,
      specialRequests
    } = req.body;

    const userId = req.user._id;

    // Validate input dates
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }

    // Convert DD-MM-YYYY to Date object
    const convertToDate = (dateString) => {
      const [day, month, year] = dateString.split('-');
      return new Date(`${year}-${month}-${day}`);
    };

    const start = convertToDate(startDate);
    const end = convertToDate(endDate);

    // Validate date conversion
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Please use DD-MM-YYYY'
      });
    }

    if (end <= start) {
      return res.status(400).json({
        success: false,
        message: 'End date must be after start date'
      });
    }

    const hall = await hallModel.findById(hallId);
    if (!hall) {
      return res.status(404).json({
        success: false,
        message: 'Hall not found'
      });
    }

    if (!hall.isAvailable) {
      return res.status(400).json({
        success: false,
        message: 'Hall is not available for booking'
      });
    }

    const existingBooking = await hallBookingModel.findOne({
      hallId,
      status: { $in: ['pending', 'confirmed'] },
      $or: [
        {
          startDate: { $lte: end },
          endDate: { $gte: start }
        }
      ]
    });

    if (existingBooking) {
      return res.status(400).json({
        success: false,
        message: 'Hall is already booked for the selected dates'
      });
    }
    // If you want to validate including current datetime
    const currentDateTime = new Date();

    if (start <= currentDateTime) {
      return res.status(400).json({
        success: false,
        message: 'Start date and time must be in the future'
      });
    }

    if (end <= currentDateTime) {
      return res.status(400).json({
        success: false,
        message: 'End date and time must be in the future'
      });
    }
    const totalDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

    if (totalDays <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Booking must be for at least 1 day'
      });
    }

    const basePrice = (hall.discountPrice || 0) * totalDays;

    const actualPrice = basePrice;
    const discountPercentage = 10;
    const discountAmount = (actualPrice * discountPercentage) / 100;
    const discountPrice = actualPrice - discountAmount;

    const taxesAndFeesPercentage = 23;
    const taxesAndFeesAmount = (discountPrice * taxesAndFeesPercentage) / 100;

    const finalAmount = discountPrice + taxesAndFeesAmount;

    const booking = new hallBookingModel({
      userId,
      hallId,
      startDate: start,
      endDate: end,
      startTime,
      endTime,
      totalDays,
      basePrice,
      actualPrice,
      discountPercentage,
      discountAmount,
      discountPrice,
      taxesAndFeesPercentage,
      taxesAndFeesAmount,
      finalAmount,
      specialRequests: specialRequests || ''
    });

    await booking.save();

    await booking.populate('hallId', 'name price location capacity amenities');

    const formattedResponse = {
      bookingId: booking._id,
      hallDetails: {
        hallId: hall._id,
        hallName: hall.name,
        location: hall.location,
        capacity: hall.capacity
      },
      bookingDetails: {
        startDate: startDate,
        endDate: endDate,
        startTime,
        endTime,
        totalDays
      },
      billingSummary: {
        actualPrice,
        discount: {
          percentage: discountPercentage,
          amount: discountAmount
        },
        discountPrice,
        taxesAndFees: {
          percentage: taxesAndFeesPercentage,
          amount: taxesAndFeesAmount
        },
        finalAmount
      },
      status: booking.status,
      createdAt: booking.createdAt
    };

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: formattedResponse
    });

  } catch (error) {
    console.error('Error creating hall booking:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};



// @desc    Get user bookings
// @route   GET /api/bookings/my-bookings
// @access  Private
export const getUserHallBookings = async (req, res) => {
  try {
    const userId = req.user._id;

    const bookings = await hallBookingModel.find({ userId })
      .populate('hallId')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: bookings.length,
      data: bookings
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// @desc    Get single booking
// @route   GET /api/bookings/:id
// @access  Private
export const getHallBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequest(res, "Something went wrong in params Id")
    }
    const booking = await hallBookingModel.findById(id)
      .populate('hallId')
      .populate('userId', 'name email phone');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if user owns the booking or is admin
    if (String(booking.adminId).toString() !== String(req.admin.id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this booking'
      });
    }

    res.json({
      success: true,
      data: booking
    });
  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// @desc    Cancel booking
// @route   PUT /api/bookings/:id/cancel
// @access  Private
export const cancelHallBooking = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequest(res, "Something went wrong in params Id")
    }
    const booking = await hallBookingModel.findById(id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if user owns the booking
    if (String(booking.userId) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this booking'
      });
    }

    // Check if booking can be cancelled
    if (booking.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Booking is already cancelled'
      });
    }

    booking.status = 'cancelled';
    await booking.save();

    res.json({
      success: true,
      message: 'Booking cancelled successfully',
      data: booking
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};



