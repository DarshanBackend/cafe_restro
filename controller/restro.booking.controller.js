import mongoose from "mongoose";
import restaurantBookingModel from "../model/restro.booking.model.js";
import restaurantModel from "../model/hotel.model.js";
import { sendSuccess, sendError, sendBadRequest, sendNotFound } from "../utils/responseUtils.js";
import restroModel from "../model/restro.model.js";
import coupanModel from "../model/coupan.model.js";
import { sendNotification } from "../utils/notificatoin.utils.js";



export const previewRestroBooking = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const {
      bookingDate,
      startTime,
      endTime,
      numberOfGuests = 2,
      tableCount = 1,
      specialRequests = "",
      coupanCode
    } = req.body;

    if (!bookingDate || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: "Booking date, startTime, and endTime are required."
      });
    }

    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid restaurant ID."
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

    const restaurant = await restroModel.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: "Restaurant not found."
      });
    }

    const [startHour, startMin] = startTime.split(":").map(Number);
    const [endHour, endMin] = endTime.split(":").map(Number);
    const durationHours = (endHour + endMin / 60) - (startHour + startMin / 60);

    if (durationHours <= 0 || durationHours > 8) {
      return res.status(400).json({
        success: false,
        message: "Invalid time range. Duration must be between 1 and 8 hours."
      });
    }

    const baseRate = restaurant.discountPrice / 2; // Using offered discount price as base
    const baseSubtotal = baseRate * numberOfGuests * tableCount;
    const currency = restaurant.currency || "INR";

    const dayOfWeek = bookingDateObj.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const weekendMultiplier = isWeekend ? 1.1 : 1;
    const isEvening = endHour >= 18;
    const peakHourMultiplier = isEvening ? 1.15 : 1;

    let subtotal = baseSubtotal * weekendMultiplier * peakHourMultiplier;

    const actualPrice = subtotal;
    const discountPercentage = 10;
    const discountAmount = (actualPrice * discountPercentage) / 100;
    const discountPrice = actualPrice - discountAmount;

    let couponDetails = null;

    if (coupanCode) {
      couponDetails = {
        code: coupanCode,
        discountApplied: discountPercentage + "%",
        discountAmount: discountAmount.toFixed(2),
      };
    }

    const taxesAndFeesPercentage = 23;
    const taxesAndFeesAmount = (discountPrice * taxesAndFeesPercentage) / 100;
    const totalAmount = discountPrice + taxesAndFeesAmount;

    return res.status(200).json({
      success: true,
      data: {
        restaurantDetails: {
          _id: restaurant._id,
          name: restaurant.name,
          cuisines: restaurant.cuisineTypes,
          address: restaurant.address.street + ", " + restaurant.address.city,
          image: restaurant.images?.featured || restaurant.images?.gallery?.[0] || null
        },
        bookingDetails: {
          bookingDate,
          startTime,
          endTime,
          durationHours,
          numberOfGuests,
          tableCount,
          specialRequests,
          isWeekend,
          isPeakHour: isEvening
        },
        paymentSummary: {
          title: "Payment Information",
          items: [
            {
              label: `${tableCount} Table × ${numberOfGuests} Guests × ${durationHours} Hours`,
              value: baseSubtotal.toFixed(2),
              prefix: "₹"
            },
            {
              label: "Weekend / Peak Adjustment",
              value: ((weekendMultiplier * peakHourMultiplier - 1) * 100).toFixed(1) + "%",
              type: "surcharge"
            },
            couponDetails
              ? {
                  label: `Coupon (${couponDetails.code})`,
                  value: `-${couponDetails.discountAmount}`,
                  type: "discount",
                  prefix: "₹"
                }
              : {
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
              label: "Total Payable",
              value: totalAmount.toFixed(2),
              prefix: "₹",
              bold: true
            }
          ],
          totalAmount: totalAmount.toFixed(2),
          currency,
          coupon: couponDetails || null,
          proceedAction: "Proceed To Pay"
        }
      }
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






const calculateAutomaticBilling = async (restaurant, couponCode, numberOfGuests, duration = 60, reqDiscountPercentage = 0, reqDiscountAmount = 0) => {
  try {

    const costPerPerson = restaurant.discountPrice / 2;
    let baseAmount = costPerPerson * numberOfGuests;

    if (duration > 60) {
      const additionalHours = Math.ceil((duration - 60) / 60);
      baseAmount += baseAmount * 0.1 * additionalHours;
    }


    const bookingDay = new Date().getDay();
    const isWeekend = bookingDay === 0 || bookingDay === 6;
    if (isWeekend) baseAmount *= 1.15;

    const actualPrice = baseAmount;
    let discountPercentage = 10;
    let discountDescription = "10% Flat Discount";


    if (couponCode) {
      discountDescription = "Coupon Applied (10%)";
    }


    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayBookings = await restaurantBookingModel.countDocuments({
      restaurantId: restaurant._id,
      createdAt: { $gte: todayStart, $lte: todayEnd }
    });

    if (todayBookings === 0) {
        discountPercentage = 15;
        discountDescription = "First Booking of the Day Discount";
    }


    if (numberOfGuests >= 6) {
        discountPercentage = 20;
        discountDescription = "Group Booking Discount";
    }

    const discountAmount = (actualPrice * discountPercentage) / 100;
    const discountPrice = actualPrice - discountAmount;
    const taxesAndFeesPercentage = 23;
    const taxesAndFeesAmount = (discountPrice * taxesAndFeesPercentage) / 100;
    const totalAmount = discountPrice + taxesAndFeesAmount;

    return {
      baseAmount: Math.round(baseAmount * 100) / 100,
      actualPrice: Math.round(actualPrice * 100) / 100,
      discount: {
        percentage: discountPercentage,
        amount: Math.round(discountAmount * 100) / 100,
        description: discountDescription
      },
      discountPrice: Math.round(discountPrice * 100) / 100,
      villaDiscount: 0,
      taxesAndFeesPercentage,
      taxesAndFeesAmount: Math.round(taxesAndFeesAmount * 100) / 100,
      additionalCharges: [],
      currency: restaurant.currency || "INR",
      totalAmount: Math.round(totalAmount * 100) / 100
    };
  } catch (error) {
    throw new Error(`Billing calculation failed: ${error.message}`);
  }
};


export const createRestaurantBooking = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { restaurantId } = req.params;
    const userId = req.user?._id;
    const {
      tableGroupId,
      tableId,
      bookingDate,
      timeSlot,
      numberOfGuests,
      specialRequests = "",
      guest = {},
      couponCode,
      payment = {}
    } = req.body;

    if (!restaurantId || !userId) {
      await session.abortTransaction();
      return sendError(res, "Restaurant ID and User ID are required", null, 400);
    }

    if (!bookingDate || !timeSlot || !numberOfGuests) {
      await session.abortTransaction();
      return sendError(res, "Booking date, time slot, and number of guests are required", null, 400);
    }

    if (!timeSlot.startTime || !timeSlot.endTime) {
      await session.abortTransaction();
      return sendError(res, "Time slot with startTime and endTime is required", null, 400);
    }

    if (numberOfGuests < 1 || numberOfGuests > 20) {
      await session.abortTransaction();
      return sendError(res, "Number of guests must be between 1 and 20", null, 400);
    }

    const restaurant = await restroModel.findById(restaurantId).session(session);
    if (!restaurant) {
      await session.abortTransaction();
      return sendError(res, "Restaurant not found", null, 404);
    }

    let availableGroup = null;
    let availableTable = null;

    if (tableGroupId && tableId) {
      availableGroup = restaurant.tableGroups.id(tableGroupId);
      if (availableGroup) {
        availableTable = availableGroup.tables.id(tableId);
        if (!availableTable) {
          await session.abortTransaction();
          return sendError(res, "Table not found", null, 404);
        }
        if (availableTable.isBooked) {
          await session.abortTransaction();
          return sendError(res, "This table is already booked", null, 409);
        }
      } else {
        await session.abortTransaction();
        return sendError(res, "Table group not found", null, 404);
      }
    } else {
      for (const group of restaurant.tableGroups) {
        if (group.capacity >= numberOfGuests) {
          const table = group.tables.find(table => !table.isBooked);
          if (table) {
            availableGroup = group;
            availableTable = table;
            break;
          }
        }
      }
    }

    if (!availableGroup || !availableTable) {
      await session.abortTransaction();
      return sendError(res, "No tables available for your request", null, 409);
    }

    const billing = await calculateAutomaticBilling(restaurant, couponCode, numberOfGuests, timeSlot.duration, req.body.discountPercentage, req.body.discountAmount);

    const isSelfBooking = guest.isMySelf ?? true;
    const guestData = {
      isMySelf: isSelfBooking,
      name: isSelfBooking ? req.user.name : (guest.name || req.user.name),
      email: isSelfBooking ? req.user.email : (guest.email || req.user.email),
      phone: isSelfBooking ? req.user.phone : (guest.phone || req.user.phone),
      address: guest.address || "",
      state: guest.state || "",
      country: guest.country || ""
    };

    const transactionId = payment.transactionId || "";
    const paymentMethod = payment.paymentMethod || "APP";
    const paidAmount = payment.paidAmount || billing.totalAmount;

    let paymentStatus = "pending";
    if (transactionId) {
      paymentStatus = "completed";
    }

    const timeSlotString = `${timeSlot.startTime} - ${timeSlot.endTime}`;

    const bookingData = {
      adminId: restaurant.ownerId,
      userId,
      restaurantId,
      tableGroupId: availableGroup._id,
      tableId: availableTable._id,
      tableNumber: availableTable.tableNumber,
      bookingDate: new Date(bookingDate),
      timeSlot: {
        startTime: timeSlot.startTime,
        endTime: timeSlot.endTime
      },
      numberOfGuests,
      guest: guestData,
      guestInfo: {
        specialRequests: specialRequests
      },
      billing,
      payment: {
        transactionId: transactionId,
        paymentStatus: paymentStatus,
        paymentMethod: paymentMethod,
        paymentDate: transactionId ? new Date() : null,
        paidAmount: paidAmount
      },
      bookingStatus: transactionId ? "Confirmed" : "Pending"
    };

    await sendNotification({
      adminId: restaurant.ownerId, title: `Your Booking create on ${restaurant.name}`, description: `your resro booking description`, image: restaurant.images.featured || null, type: "single", userId: userId
    })

    const booking = new restaurantBookingModel(bookingData);
    await booking.save({ session });

    const tableGroup = restaurant.tableGroups.id(availableGroup._id);
    const table = tableGroup.tables.id(availableTable._id);

    table.isBooked = true;
    table.currentBooking = {
      bookingId: booking.bookingId || booking._id.toString(),
      bookingDate: new Date(bookingDate),
      timeSlot: timeSlotString,
      userId: userId,
      numberOfGuests: numberOfGuests,
      specialRequests: specialRequests,
      status: "booked",
      createdAt: new Date()
    };

    table.payment = {
      transactionId: transactionId,
      paymentStatus: paymentStatus,
      paymentMethod: paymentMethod,
      paymentDate: transactionId ? new Date() : null,
      paidAmount: paidAmount
    };

    await restaurant.save({ session });
    await session.commitTransaction();

    if (!transactionId) {
      setTimeout(async () => {
        const cancelSession = await mongoose.startSession();
        cancelSession.startTransaction();

        try {
          const freshBooking = await restaurantBookingModel.findOne({
            _id: booking._id,
            "payment.paymentStatus": "pending"
          }).session(cancelSession);

          if (!freshBooking) return;

          await restaurantBookingModel.findByIdAndUpdate(
            booking._id,
            {
              bookingStatus: "Cancelled",
              "payment.paymentStatus": "failed",
              cancelledAt: new Date()
            },
            { session: cancelSession }
          );

          const freshRestaurant = await restroModel.findById(restaurantId).session(cancelSession);
          if (freshRestaurant) {
            const freshGroup = freshRestaurant.tableGroups.id(availableGroup._id);
            const freshTable = freshGroup?.tables.id(availableTable._id);

            if (freshTable && freshTable.currentBooking?.bookingId === (booking.bookingId || booking._id.toString())) {
              freshTable.isBooked = false;
              freshTable.currentBooking.status = "cancelled";
              if (freshTable.payment) {
                freshTable.payment.paymentStatus = "failed";
              }

              await freshRestaurant.save({ session: cancelSession });
            }
          }

          await cancelSession.commitTransaction();
          console.log(`Auto-cancelled booking ${booking.bookingId || booking._id} - Payment timeout`);

        } catch (error) {
          await cancelSession.abortTransaction();
          console.error("Auto-cancel error:", error.message);
        } finally {
          cancelSession.endSession();
        }
      }, 5 * 60 * 1000);
    }

    const populatedBooking = await restaurantBookingModel
      .findById(booking._id)
      .populate("restaurantId", "name address contact images rating")
      .populate("userId", "name email phone")
      .populate("adminId", "name email")
      .lean();

    return sendSuccess(res,
      transactionId ? "Table booked successfully!" : "Booking created! Complete payment within 5 minutes.",
      populatedBooking,
      201
    );

  } catch (error) {
    await session.abortTransaction();
    console.error("Booking creation error:", error);
    return sendError(res, "Failed to create booking", error.message, 500);
  } finally {
    session.endSession();
  }
};

export const getUserRestaurantBookings = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, page = 1, limit = 10, sortBy = "bookingDate", sortOrder = "desc" } = req.query;

    const query = { userId };
    if (status && status !== "all") {
      query.bookingStatus = status;
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const bookings = await restaurantBookingModel
      .find(query)
      .populate("restaurantId", "name address contact images operatingHours")
      .populate("userId", "name email phone")
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const totalBookings = await restaurantBookingModel.countDocuments(query);
    const totalPages = Math.ceil(totalBookings / parseInt(limit));

    return sendSuccess(res, "Bookings fetched successfully", {
      bookings,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: totalBookings,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      }
    });

  } catch (error) {
    console.error("Get user bookings error:", error);
    return sendError(res, "Failed to fetch bookings", error.message);
  }
};

export const getRestaurantBookings = async (req, res) => {
  try {
    const { restroId } = req.params;
    const { date, status, page = 1, limit = 10 } = req.query;

    if (!restroId) {
      return sendError(res, "Restaurant ID is required");
    }

    // Build query
    const query = { restaurantId: restroId };

    // Filter by booking status
    if (status && status !== "all") {
      query.bookingStatus = status;
    }

    // Filter by booking date (day range)
    if (date) {
      const targetDate = new Date(date);
      const startDate = new Date(targetDate.setHours(0, 0, 0, 0));
      const endDate = new Date(targetDate.setHours(23, 59, 59, 999));
      query.bookingDate = { $gte: startDate, $lte: endDate };
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Fetch bookings
    const bookings = await restaurantBookingModel
      .find(query)
      .populate("userId", "name email phone")
      .populate("adminId", "name email")
      .sort({ bookingDate: 1, "timeSlot.startTime": 1 })
      .skip(skip)
      .limit(limitNum);

    const totalBookings = await restaurantBookingModel.countDocuments(query);
    const totalPages = Math.ceil(totalBookings / limitNum);

    return sendSuccess(res, "Restaurant bookings fetched successfully", {
      bookings,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalItems: totalBookings,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
    });
  } catch (error) {
    console.error("Get restaurant bookings error:", error);
    return sendError(res, "Failed to fetch restaurant bookings", error.message);
  }
};


export const getRestaurantBookingById = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await restaurantBookingModel.findOne({ _id: bookingId })
      .populate("restaurantId", "name address contact images operatingHours tableGroups")
      .populate("userId", "name email phone")
      .populate("adminId", "name email");
    console.log(booking)
    if (!booking) {
      return sendError(res, "Booking not found", null, 404);
    }

    return sendSuccess(res, "Booking fetched successfully", booking);

  } catch (error) {
    console.error("Get booking error:", error);
    return sendError(res, "Failed to fetch booking", error.message);
  }
};

export const updateRestaurantBookingStatus = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { bookingId } = req.params;
    const { status, reason = "", refundAmount = 0 } = req.body;


    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return sendBadRequest(res, "Invalid booking ID format");
    }

    const booking = await restaurantBookingModel.findById(bookingId).session(session);
    if (!booking) {
      return sendError(res, "Booking not found", null, 404);
    }


    const VALID_STATUSES = [
      "Pending",
      "Confirmed",
      "Upcoming",
      "Completed",
      "Cancelled",
      "Refunded",
      "No-Show",
    ];

    if (!status || typeof status !== "string") {
      return sendBadRequest(res, "Booking status is required and must be a string");
    }

    if (!VALID_STATUSES.includes(status)) {
      return sendBadRequest(
        res,
        `Invalid status. Allowed values: ${VALID_STATUSES.join(", ")}`
      );
    }

    switch (status) {
      case "Cancelled":
        booking.bookingStatus = "Cancelled";
        booking.cancellation = {
          reason: reason || "Cancelled by admin",
          cancelledAt: new Date(),
        };
        booking.refundAmount = refundAmount;
        booking.payment.paymentStatus = "cancelled";
        break;

      case "Refunded":
        booking.bookingStatus = "Refunded";
        booking.payment.paymentStatus = "refunded";
        booking.refundAmount = refundAmount;
        break;

      case "Completed":
        booking.bookingStatus = "Completed";
        booking.completedAt = new Date();
        booking.payment.paymentStatus = "completed";
        break;

      case "No-Show":
        booking.bookingStatus = "No-Show";
        booking.payment.paymentStatus = "failed";
        break;

      default:
        booking.bookingStatus = status;
        break;
    }

    await booking.save({ session });

    if (["Cancelled", "Refunded"].includes(status)) {
      const restaurant = await restroModel.findById(booking.restaurantId).session(session);
      if (restaurant) {
        const tableGroup = restaurant.tableGroups.id(booking.tableGroupId);
        if (tableGroup) {
          const table = tableGroup.tables.id(booking.tableId);
          if (table) {
            table.isBooked = false;
            table.currentBooking = null;
          }
        }
        await restaurant.save({ session });
      }
    }

    await session.commitTransaction();

    // 🧩 Re-fetch updated booking
    const updatedBooking = await restaurantBookingModel
      .findById(bookingId)
      .populate("restaurantId", "name address contact images")
      .populate("userId", "name email phone");

    return sendSuccess(res, "✅ Booking status updated successfully", updatedBooking);

  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error("❌ Booking status update error:", error);
    return sendError(res, "Failed to update booking status", error.message);
  } finally {
    session.endSession();
  }
};


export const updateRestaurantPaymentStatus = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { bookingId } = req.params;
    const { paymentStatus, transactionId, paymentMethod, paidAmount } = req.body;
    const user = req.user;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return sendBadRequest(res, "Invalid booking ID format");
    }

    const booking = await restaurantBookingModel.findById(bookingId).session(session);
    if (!booking) {
      return sendError(res, "Booking not found", null, 404);
    }

    if (user.role !== "admin" && booking.userId.toString() !== user._id.toString()) {
      return sendError(res, "Access denied. You are not authorized to modify this payment.", null, 403);
    }

    const VALID_PAYMENT_STATUSES = ["pending", "cancelled", "completed", "failed", "refunded"];
    if (!paymentStatus || !VALID_PAYMENT_STATUSES.includes(paymentStatus.toLowerCase())) {
      return sendBadRequest(
        res,
        `Invalid paymentStatus. Allowed values: ${VALID_PAYMENT_STATUSES.join(", ")}`
      );
    }

    const VALID_PAYMENT_METHODS = ["Cash", "Credit Card", "Debit Card", "UPI", "Digital Wallet", "APP"];
    if (paymentMethod && !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
      return sendBadRequest(
        res,
        `Invalid paymentMethod. Allowed values: ${VALID_PAYMENT_METHODS.join(", ")}`
      );
    }
    0
    booking.payment.paymentStatus = paymentStatus.toLowerCase();
    if (transactionId) booking.payment.transactionId = transactionId;
    if (paymentMethod) booking.payment.paymentMethod = paymentMethod;
    if (paidAmount !== undefined) booking.payment.paidAmount = Number(paidAmount);

    if (paymentStatus.toLowerCase() === "completed") {
      booking.payment.paymentDate = new Date();
      // If paidAmount not sent, auto-fill from billing
      if (!booking.payment.paidAmount || booking.payment.paidAmount === 0) {
        booking.payment.paidAmount = booking.billing?.totalAmount || 0;
      }

      if (booking.bookingStatus === "Pending" || booking.bookingStatus === "Upcoming") {
        booking.bookingStatus = "Confirmed";
      }
    }

    if (["failed", "cancelled"].includes(paymentStatus.toLowerCase())) {
      booking.bookingStatus = "Cancelled";
      booking.payment.paymentDate = new Date();
    }

    if (paymentStatus.toLowerCase() === "refunded") {
      booking.bookingStatus = "Refunded";
    }

    await booking.save({ session });

    const restaurant = await restroModel.findById(booking.restaurantId).session(session);
    if (restaurant) {
      const tableGroup = restaurant.tableGroups.id(booking.tableGroupId);
      if (tableGroup) {
        const table = tableGroup.tables.id(booking.tableId);
        if (table) {
          // If payment completed
          if (paymentStatus.toLowerCase() === "completed") {
            table.payment = {
              transactionId: booking.payment.transactionId,
              paymentStatus: "completed",
              paymentMethod: booking.payment.paymentMethod,
              paymentDate: booking.payment.paymentDate,
              paidAmount: booking.payment.paidAmount,
            };
          }

          if (["cancelled", "failed", "refunded"].includes(paymentStatus.toLowerCase())) {
            table.isBooked = false;
            table.currentBooking = null;
            table.payment = {
              transactionId: "",
              paymentStatus: "cancelled",
              paymentMethod: "APP",
              paymentDate: null,
              paidAmount: 0,
            };
          }
        }
      }

      await restaurant.save({ session });
    }

    await session.commitTransaction();

    const updatedBooking = await restaurantBookingModel
      .findById(bookingId)
      .populate("restaurantId", "name address contact images")
      .populate("userId", "name email phone");

    return sendSuccess(res, "Payment status updated successfully", updatedBooking);

  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error("Update payment status error:", error);
    return sendError(res, "Failed to update payment status", error.message);
  } finally {
    await session.endSession();
  }
};

export const checkInGuest = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await restaurantBookingModel.findOne({ _id: bookingId });
    if (!booking) {
      return sendError(res, "Booking not found", null, 404);
    }

    if (booking.timeline.checkedInAt) {
      return sendError(res, "Guest already checked in");
    }

    if (booking.bookingStatus !== "Upcoming") {
      return sendError(res, "Cannot check in - booking status is not upcoming");
    }

    booking.timeline.checkedInAt = new Date();
    await booking.save();


    return sendSuccess(res, "Guest checked in successfully", booking);

  } catch (error) {
    console.error("Check in error:", error);
    return sendError(res, "Failed to check in guest", error.message);
  }
};

export const checkOutGuest = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await restaurantBookingModel.findOne({ _id: bookingId });
    if (!booking) {
      return sendError(res, "Booking not found", null, 404);
    }

    if (!booking.timeline.checkedInAt) {
      return sendError(res, "Guest not checked in");
    }

    if (booking.timeline.checkedOutAt) {
      return sendError(res, "Guest already checked out");
    }

    booking.timeline.checkedOutAt = new Date();
    booking.bookingStatus = "Completed";
    await booking.save();

    return sendSuccess(res, "Guest checked out successfully", booking);

  } catch (error) {
    console.error("Check out error:", error);
    return sendError(res, "Failed to check out guest", error.message);
  }
};

export const getBookingStatistics = async (req, res) => {
  try {
    const { restaurantId } = req.params;
    const { startDate, endDate } = req.query;

    if (!restaurantId) {
      return sendError(res, "Restaurant ID is required");
    }

    const matchStage = { restaurantId: new mongoose.Types.ObjectId(restaurantId) };

    if (startDate && endDate) {
      matchStage.bookingDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const stats = await restaurantBookingModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$bookingStatus",
          count: { $sum: 1 },
          totalRevenue: { $sum: "$billing.totalAmount" },
          avgBookingValue: { $avg: "$billing.totalAmount" }
        }
      },
      {
        $group: {
          _id: null,
          statusCounts: {
            $push: {
              status: "$_id",
              count: "$count",
              revenue: "$totalRevenue",
              avgValue: "$avgBookingValue"
            }
          },
          totalBookings: { $sum: "$count" },
          totalRevenue: { $sum: "$totalRevenue" },
          averageBookingValue: { $avg: "$avgBookingValue" }
        }
      },
      {
        $project: {
          _id: 0,
          statusCounts: 1,
          totalBookings: 1,
          totalRevenue: 1,
          averageBookingValue: { $round: ["$averageBookingValue", 2] }
        }
      }
    ]);

    const result = stats[0] || {
      statusCounts: [],
      totalBookings: 0,
      totalRevenue: 0,
      averageBookingValue: 0
    };

    // Add today's bookings count
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todaysBookings = await restaurantBookingModel.countDocuments({
      restaurantId,
      bookingDate: { $gte: todayStart, $lte: todayEnd }
    });

    result.todaysBookings = todaysBookings;

    return sendSuccess(res, "Booking statistics fetched successfully", result);

  } catch (error) {
    console.error("Get booking statistics error:", error);
    return sendError(res, "Failed to fetch booking statistics", error.message);
  }
};

// ✅ Calculate Booking Amount (Preview)
export const calculateBookingAmount = async (req, res) => {
  try {
    const { restaurantId, numberOfGuests, duration = 60 } = req.body;

    if (!restaurantId || !numberOfGuests) {
      return sendError(res, "Restaurant ID and number of guests are required");
    }

    const restaurant = await restaurantModel.findById(restaurantId);
    if (!restaurant) {
      return sendError(res, "Restaurant not found", null, 404);
    }

    const billing = await calculateAutomaticBilling(restaurant, numberOfGuests, duration);

    return sendSuccess(res, "Booking amount calculated successfully", {
      ...billing,
      estimatedAmount: billing.totalAmount
    });

  } catch (error) {
    console.error("Calculate booking amount error:", error);
    return sendError(res, "Failed to calculate booking amount", error.message);
  }
};

//cancel booking from user
export const cancelMyRestroBooking = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  const userId = req.user._id;
  const { bookingId } = req.params;
  const { reason = "", refundAmount = 0 } = req.body;

  try {

    // 1. Validate booking ID
    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      await session.abortTransaction();
      session.endSession();
      return sendBadRequest(res, "Invalid booking ID format");
    }

    // 2. Find booking
    const booking = await restaurantBookingModel.findById(bookingId).session(session);
    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return sendError(res, "Booking not found", null, 404);
    }


    // 3. Verify ownership
    if (booking.userId.toString() !== userId.toString()) {
      await session.abortTransaction();
      session.endSession();
      return sendError(res, "Unauthorized action", null, 403);
    }

    // 4. Check status
    if (booking.bookingStatus === "Cancelled") {
      await session.abortTransaction();
      session.endSession();
      return sendBadRequest(res, "Booking is already cancelled");
    }

    // 5. Update booking
    booking.bookingStatus = "Cancelled";
    booking.cancellation = {
      reason: reason || "Cancelled by user",
      cancelledAt: new Date(),
      refundAmount,
    };

    await booking.save({ session });

    // 6. Commit
    await session.commitTransaction();
    session.endSession();

    return sendSuccess(res, "Booking cancelled successfully", booking);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error While Cancel My Booking:", error.message);
    return sendError(res, "Error while cancelling booking", error);
  }
};