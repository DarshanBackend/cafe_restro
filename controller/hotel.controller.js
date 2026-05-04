import hotelModel from "../model/hotel.model.js";
import adminModel from "../model/admin.model.js";
import { resizeImage, uploadToS3, deleteFromS3 } from "../middleware/uploadS3.js";
import sharp from "sharp";
import { sendBadRequest, sendSuccess, sendError } from "../utils/responseUtils.js";
import log from "../utils/logger.js";
import { sendNotification } from "../utils/notificatoin.utils.js";
import hotelBookingModel from "../model/hotel.booking.model.js";
import mongoose from "mongoose";

export const createNewHotel = async (req, res) => {
  try {
    const {
      name,
      description,
      address,
      location,
      amenities,
      actualPrice,
      discountPrice,
      ourService,
    } = req.body;

    if (!name || !description) {
      return sendBadRequest(res, "Hotel name and description are required");
    }

    const hotelImages = req.files?.hotelImages || [];
    const roomImagesByIndex = req.files?.roomImages || {};

    if (hotelImages.length === 0) {
      return sendBadRequest(res, "Please upload at least one hotel image");
    }

    const parsedAddress = typeof address === "string" ? JSON.parse(address) : address || {};
    const parsedLocation = typeof location === "string" ? JSON.parse(location) : location || {};
    const parsedAmenities = typeof amenities === "string" ? JSON.parse(amenities) : amenities || [];
    const parsedOurService = typeof ourService === "string" ? JSON.parse(ourService) : ourService || {};

    const hotel = new hotelModel({
      name,
      description,
      adminId: req.admin?._id,
      address: parsedAddress,
      location: parsedLocation,
      amenities: parsedAmenities,
      actualPrice: Number(actualPrice),
      discountPrice: Number(discountPrice),
      images: hotelImages,
      ourService: {
        connectVieCall: parsedOurService.connectVieCall || null,
        connectVieMessage: parsedOurService.connectVieMessage || null,
        helpSupport: parsedOurService.helpSupport || null,
      },
    });

    const savedHotel = await hotel.save();

    if (req.admin?._id && savedHotel._id) {
      await adminModel.findByIdAndUpdate(
        req.admin._id,
        { $addToSet: { hotels: savedHotel._id } },
        { new: true }
      ).catch(err => log.warn("Failed to update admin hotels:", err.message));
    }

    await sendNotification({
      adminId: req.admin?._id,
      title: `New Hotel Created: ${name}`,
      description: `Hotel ${name} created successfully with ${savedHotel.images.length} images.`,
      image: savedHotel.images[0] || null,
      type: "broadcast",
    }).catch(err => log.warn("Notification Error:", err.message));

    return sendSuccess(res, "Hotel created successfully", savedHotel);
  } catch (error) {
    log.error("createNewHotel Error:", error);
    return sendError(res, "Failed to create hotel", error);
  }
};

export const getAllHotels = async (req, res) => {
  try {
    const hotels = await hotelModel.find({}).sort({ createdAt: -1 });

    return sendSuccess(res, "Hotels fetched successfully", hotels);

  } catch (error) {
    log.error(error);
    return sendError(res, "Failed to fetch hotels", error);
  }
}

export const getHotelById = async (req, res) => {
  try {
    const { hotelId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(hotelId)) {
      return sendBadRequest(res, "Invalid Hotel ID");
    }

    if (!hotelId) return sendError(res, 400, "Hotel ID is required");

    const hotel = await hotelModel.findById(hotelId).populate('adminId');
    if (!hotel) return sendError(res, 404, "Hotel not found");

    return sendSuccess(res, "Hotel fetched successfully", hotel);

  } catch (error) {
    log.error(error);
    return sendError(res, "Failed to fetch hotel", error);
  }
}

export const deleteHotels = async (req, res) => {
  try {
    const { hotelId } = req.params;
    if (!hotelId) return sendError(res, 400, "Hotel ID is required");

    const hotel = await hotelModel.findById(hotelId);
    if (!hotel) return sendError(res, 404, "Hotel not found or already deleted");

    const imagesToDelete = [];

    // Delete hotel main images
    if (Array.isArray(hotel.images) && hotel.images.length > 0) {
      hotel.images.forEach((imgUrl) => {
        const key = imgUrl.split(".amazonaws.com/")[1];
        if (key) imagesToDelete.push(key);
      });
    }

    // Delete room images
    if (Array.isArray(hotel.rooms) && hotel.rooms.length > 0) {
      hotel.rooms.forEach((room) => {
        if (Array.isArray(room.images) && room.images.length > 0) {
          room.images.forEach((imgUrl) => {
            const key = imgUrl.split(".amazonaws.com/")[1];
            if (key) imagesToDelete.push(key);
          });
        }
      });
    }

    if (imagesToDelete.length > 0) {
      await Promise.allSettled(
        imagesToDelete.map((key) => deleteFromS3(key))
      ).catch(err => log.warn("Some images failed to delete from S3:", err.message));
      log.info(`Deleted ${imagesToDelete.length} images from S3 for hotel: ${hotelId}`);
    }

    if (hotel.adminId) {
      await adminModel.findByIdAndUpdate(
        hotel.adminId,
        { $pull: { hotels: hotelId } },
        { new: true }
      ).catch(err => log.warn("Failed to remove hotel from admin:", err.message));
    }

    await hotelModel.findByIdAndDelete(hotelId);

    return sendSuccess(res, "Hotel deleted successfully", hotel);
  } catch (error) {
    log.error("deleteHotels Error:", error);
    return sendError(res, "Failed to delete hotel", error);
  }
}

// GET /api/hotels/getHotelByCityName/:name
export const getHotelByCityName = async (req, res) => {
  try {
    const { name } = req.params;
    const {
      page = 1,
      limit = 10,
      minPrice,
      maxPrice,
      amenities,
      sortBy = 'name',
      sortOrder = 'asc'
    } = req.query;

    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "City name is required"
      });
    }

    // Build filter object
    const filter = {
      "address.city": {
        $regex: name,
        $options: 'i' // case insensitive
      }
    };

    // Add price range filter if provided
    if (minPrice || maxPrice) {
      filter.$or = [];

      if (minPrice) {
        filter.$or.push(
          { "priceRange.min": { $gte: parseInt(minPrice) } },
          { "Rent": { $gte: parseInt(minPrice) } }
        );
      }

      if (maxPrice) {
        filter.$or.push(
          { "priceRange.max": { $lte: parseInt(maxPrice) } },
          { "Rent": { $lte: parseInt(maxPrice) } }
        );
      }
    }

    // Add amenities filter if provided
    if (amenities) {
      const amenitiesArray = Array.isArray(amenities) ? amenities : amenities.split(',');
      filter.amenities = { $in: amenitiesArray.map(a => a.trim()) };
    }

    // Build sort object
    const sortOptions = {};
    switch (sortBy) {
      case 'price':
        sortOptions.Rent = sortOrder === 'desc' ? -1 : 1;
        break;
      case 'rating':
        sortOptions.averageRating = sortOrder === 'desc' ? -1 : 1;
        break;
      case 'name':
      default:
        sortOptions.name = sortOrder === 'desc' ? -1 : 1;
    }

    // Calculate pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Execute query with pagination
    const hotels = await hotelModel
      .find(filter)
      .select('name description address images rooms amenities priceRange Rent ourService averageRating reviews')
      .populate('adminId', 'name email contactNo')
      .populate('reviews.user', 'name avatar')
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Get total count for pagination
    const totalHotels = await hotelModel.countDocuments(filter);
    const totalPages = Math.ceil(totalHotels / limitNum);

    // Transform response data
    const transformedHotels = hotels.map(hotel => ({
      _id: hotel._id,
      name: hotel.name,
      description: hotel.description,
      address: hotel.address,
      images: hotel.images || [],
      amenities: hotel.amenities || [],
      pricing: {
        rent: hotel.Rent,
        priceRange: hotel.priceRange || { min: 0, max: 0 },
        currency: "INR"
      },
      services: hotel.ourService || {},
      rating: {
        average: hotel.averageRating || 0,
        totalReviews: hotel.reviews?.length || 0
      },
      rooms: hotel.rooms?.map(room => ({
        type: room.type,
        pricePerNight: room.pricePerNight,
        maxGuests: room.maxGuests,
        amenities: room.amenities || []
      })) || [],
      admin: hotel.adminId ? {
        _id: hotel.adminId._id,
        name: hotel.adminId.name,
        email: hotel.adminId.email,
        contactNo: hotel.adminId.contactNo
      } : null
    }));

    res.json({
      success: true,
      message: `Hotels in ${name} fetched successfully`,
      data: {
        hotels: transformedHotels,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalHotels,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1
        },
        filters: {
          city: name,
          minPrice: minPrice || null,
          maxPrice: maxPrice || null,
          amenities: amenities || null
        }
      }
    });

  } catch (error) {
    console.error("Get hotels by city error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while fetching hotels"
    });
  }
};

// Optional: Get unique cities for search suggestions
export const getCitySuggestions = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.length < 2) {
      return res.json({
        success: true,
        data: []
      });
    }

    const cities = await hotelModel.aggregate([
      {
        $match: {
          "address.city": {
            $regex: query,
            $options: 'i'
          }
        }
      },
      {
        $group: {
          _id: {
            city: "$address.city",
            state: "$address.state"
          },
          hotelCount: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          city: "$_id.city",
          state: "$_id.state",
          hotelCount: 1
        }
      },
      {
        $sort: { hotelCount: -1 }
      },
      {
        $limit: 10
      }
    ]);

    res.json({
      success: true,
      data: cities
    });

  } catch (error) {
    console.error("City suggestions error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};

export const searchHotels = async (req, res) => {
  try {
    const { keyword } = req.query;

    if (!keyword || keyword.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Please provide a search keyword",
      });
    }

    const searchCondition = {
      $or: [
        { name: { $regex: keyword, $options: "i" } },
        { city: { $regex: keyword, $options: "i" } },
        { state: { $regex: keyword, $options: "i" } },
        { address: { $regex: keyword, $options: "i" } },
      ],
    };

    const hotels = await hotelModel.find(searchCondition);

    if (hotels.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No hotels found matching your search",
      });
    }

    return res.status(200).json({
      success: true,
      message: `${hotels.length} hotels found`,
      data: hotels,
    });
  } catch (error) {
    console.error(`Error while searching hotels: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: "Error while searching hotels",
      error: error.message,
    });
  }
};

const parseDate = (dateStr) => {
  const [day, month, year] = dateStr.split("-");
  return new Date(`${year}-${month}-${day}`);
};

export const mainSearchHotels = async (req, res) => {
  try {
    const { city, checkInDate, checkOutDate, adults, children, rooms } = req.query;

    if (!city || !checkInDate || !checkOutDate) {
      return res.status(400).json({
        success: false,
        message: "City, check-in date, and check-out date are required.",
      });
    }

    const checkIn = parseDate(checkInDate);
    const checkOut = parseDate(checkOutDate);

    if (checkOut <= checkIn) {
      return res.status(400).json({
        success: false,
        message: "Check-out date must be after check-in date.",
      });
    }

    const overlappingBookings = await hotelBookingModel.find({
      $and: [
        { "bookingDates.checkInDate": { $lt: checkOut } },
        { "bookingDates.checkOutDate": { $gt: checkIn } },
        { bookingStatus: { $in: ["pending", "upcoming", "completed"] } },
      ],
    }).distinct("hotelId");

    const query = {
      "address.city": { $regex: new RegExp(city, "i") },
      _id: { $nin: overlappingBookings },
    };

    const hotels = await hotelModel.find(query)
      .select("name description address images actualPrice discountPrice averageRating amenities")
      .limit(20)
      .lean();

    return res.status(200).json({
      success: true,
      message: hotels.length ? "Hotels fetched successfully." : "No hotels available.",
      info: {
        city,
        checkInDate,
        checkOutDate,
        adults: Number(adults) || 1,
        children: Number(children) || 0,
        rooms: Number(rooms) || 1
      },
      result: hotels,
    });
  } catch (error) {
    console.error("Hotel Search Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error.",
    });
  }
};

export const updateHotel = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const updateData = { ...req.body };

    const hotel = await hotelModel.findById(hotelId);
    if (!hotel) return sendError(res, "Hotel not found", "Hotel ID is invalid");

    // Handle JSON parsing for form-data strings
    if (updateData.address && typeof updateData.address === "string") {
      updateData.address = JSON.parse(updateData.address);
    }
    if (updateData.location && typeof updateData.location === "string") {
      updateData.location = JSON.parse(updateData.location);
    }
    if (updateData.amenities && typeof updateData.amenities === "string") {
      updateData.amenities = JSON.parse(updateData.amenities);
    }
    if (updateData.ourService && typeof updateData.ourService === "string") {
      updateData.ourService = JSON.parse(updateData.ourService);
    }

    // Convert numbers
    if (updateData.actualPrice) updateData.actualPrice = Number(updateData.actualPrice);
    if (updateData.discountPrice) updateData.discountPrice = Number(updateData.discountPrice);

    // Handle new image uploads
    if (req.files?.hotelImages) {
      updateData.images = [...(hotel.images || []), ...req.files.hotelImages];
    }

    const updatedHotel = await hotelModel.findByIdAndUpdate(
      hotelId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    return sendSuccess(res, "Hotel updated successfully", updatedHotel);
  } catch (error) {
    log.error("updateHotel Error:", error);
    return sendError(res, "Failed to update hotel", error);
  }
};

