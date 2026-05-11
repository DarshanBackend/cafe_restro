import hotelBookingModel from "../model/hotel.booking.model.js";
import cafeBookingModel from "../model/cafe.booking.model.js";
import restaurantBookingModel from "../model/restro.booking.model.js";
import { sendSuccess, sendError } from "../utils/responseUtils.js";
import log from "../utils/logger.js";

export const getMyBookingsUnified = async (req, res) => {
    try {
        const userId = req.user?._id;
        const now = new Date();

        
        const [hotelBookings, cafeBookings, restroBookings] = await Promise.all([
            hotelBookingModel.find({ userId }).populate("hotelId", "name address location images").sort({ createdAt: -1 }),
            cafeBookingModel.find({ userId }).populate("cafeId", "name location images").sort({ createdAt: -1 }),
            restaurantBookingModel.find({ userId }).populate("restaurantId", "name address city images").sort({ createdAt: -1 })
        ]);

        
        const updatePastBookings = async (bookings, model) => {
            for (let booking of bookings) {
                const status = (booking.bookingStatus || "pending").toLowerCase();
                const checkOutDate = new Date(booking.bookingDates?.checkOutDate || booking.checkOutDate);
                if (["confirmed", "upcoming", "pending"].includes(status) && checkOutDate < now) {
                    booking.bookingStatus = model === hotelBookingModel ? "completed" : "Completed";
                    await booking.save();
                }
            }
        };

        await Promise.all([
            updatePastBookings(hotelBookings, hotelBookingModel),
            updatePastBookings(cafeBookings, cafeBookingModel),
            updatePastBookings(restroBookings, restaurantBookingModel)
        ]);

        const formatStatus = (booking, type) => {
            const status = (booking.bookingStatus || "pending").toLowerCase();
            const checkOutDate = new Date(booking.bookingDates?.checkOutDate || booking.checkOutDate);
            
            if (["cancelled", "refunded"].includes(status)) return "Cancelled";
            if (status === "completed" || checkOutDate < now) return "Completed";
            return "Upcoming";
        };

        const groupBookings = (bookings, type) => {
            const grouped = {
                upcoming: [],
                completed: [],
                cancelled: []
            };

            bookings.forEach(booking => {
                const displayStatus = formatStatus(booking, type);
                const item = {
                    _id: booking._id,
                    bookingId: booking.bookingId || booking._id,
                    name: type === "hotel" ? booking.hotelId?.name : (type === "cafe" ? booking.cafeId?.name : booking.restaurantId?.name),
                    image: type === "hotel" ? booking.hotelId?.images?.[0] : (type === "cafe" ? booking.cafeId?.images?.[0] : booking.restaurantId?.images?.[0]),
                    location: type === "hotel" ? booking.hotelId?.address?.city : (type === "cafe" ? booking.cafeId?.location?.city : booking.restaurantId?.city),
                    checkIn: booking.bookingDates?.checkInDate || booking.checkInDate,
                    checkOut: booking.bookingDates?.checkOutDate || booking.checkOutDate,
                    status: displayStatus,
                    rawStatus: booking.bookingStatus,
                    totalAmount: booking.pricing?.totalAmount,
                    createdAt: booking.createdAt
                };

                if (displayStatus === "Upcoming") grouped.upcoming.push(item);
                else if (displayStatus === "Completed") grouped.completed.push(item);
                else grouped.cancelled.push(item);
            });

            return grouped;
        };

        const result = {
            hotel: groupBookings(hotelBookings, "hotel"),
            cafe: groupBookings(cafeBookings, "cafe"),
            restaurant: groupBookings(restroBookings, "restaurant")
        };

        
        const summary = {
            hotel: hotelBookings.length,
            cafe: cafeBookings.length,
            restaurant: restroBookings.length,
            total: hotelBookings.length + cafeBookings.length + restroBookings.length
        };

        return res.status(200).json({
            success: true,
            message: "Bookings fetched successfully",
            summary,
            result
        });

    } catch (error) {
        log.error("getMyBookingsUnified Error: " + error.message);
        return sendError(res, 500, "Failed to fetch unified bookings", error.message);
    }
};
