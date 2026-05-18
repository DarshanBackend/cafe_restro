import hotelModel from "../model/hotel.model.js";
import watchListModel from "../model/watchlist.model.js";
import adminModel from "../model/admin.model.js";
import { resizeImage, uploadToS3, deleteFromS3 } from "../middleware/uploadS3.js";
import sharp from "sharp";
import { sendBadRequest, sendSuccess, sendError } from "../utils/responseUtils.js";
import log from "../utils/logger.js";
import { sendNotification } from "../utils/notification.utils.js";

import hotelBookingModel from "../model/hotel.booking.model.js";
import mongoose from "mongoose";
import { formatReviewsResponse } from "../utils/reviewUtils.js";

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
    const hotels = await hotelModel.find({}).sort({ createdAt: -1 }).lean();

    let favoriteHotelIds = [];
    if (req.user?._id) {
      const watchlist = await watchListModel.findOne({ userId: req.user._id });
      favoriteHotelIds = watchlist ? watchlist.hotels.map(id => id.toString()) : [];
    }

    const reviewModel = mongoose.model("Review");
    const hotelsWithStats = await Promise.all(hotels.map(async (hotel) => {
      const latestReviews = await reviewModel.find({ 
        businessId: hotel._id, 
        businessType: 'Hotel', 
        isActive: true 
      })
      .populate('userId', 'name avatar profilePicture')
      .sort({ createdAt: -1 })
      .limit(2)
      .lean();

      return {
        ...hotel,
        isFavorite: favoriteHotelIds.includes(hotel._id.toString()),
        averageRating: hotel.averageRating || 0,
        reviewCount: hotel.reviewCount || 0,
        reviews: formatReviewsResponse(latestReviews, req.user?._id)
      };
    }));

    return sendSuccess(res, "Hotels fetched successfully", hotelsWithStats);

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

    const hotel = await hotelModel.findById(hotelId).populate('adminId').lean();
    if (!hotel) return sendError(res, 404, "Hotel not found");

    // Fetch reviews from centralized Review model
    const reviewModel = mongoose.model("Review");
    const reviews = await reviewModel.find({ businessId: hotelId, businessType: 'Hotel', isActive: true })
      .populate('userId', 'name avatar profilePicture')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const stats = await reviewModel.aggregate([
      { $match: { businessId: new mongoose.Types.ObjectId(hotelId), businessType: 'Hotel', isActive: true } },
      {
        $group: {
          _id: "$rating",
          count: { $sum: 1 }
        }
      }
    ]);

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let totalCount = 0;
    let sumRating = 0;

    stats.forEach(s => {
      distribution[s._id] = s.count;
      totalCount += s.count;
      sumRating += (s._id * s.count);
    });

    const averageRating = totalCount > 0 ? Number((sumRating / totalCount).toFixed(1)) : 0;

    let isFavorite = false;
    if (req.user?._id) {
      const watchlist = await watchListModel.findOne({ userId: req.user._id });
      isFavorite = watchlist ? watchlist.hotels.some(id => id.toString() === hotel._id.toString()) : false;
    }

    const result = {
      ...hotel,
      isFavorite,
      averageRating,
      reviewCount: totalCount,
      reviews: formatReviewsResponse(reviews, req.user?._id),
      reviewSummary: {
        average: averageRating,
        totalReviews: totalCount,
        distribution
      }
    };

    return sendSuccess(res, "Hotel fetched successfully", result);

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

    
    if (Array.isArray(hotel.images) && hotel.images.length > 0) {
      hotel.images.forEach((imgUrl) => {
        const key = imgUrl.split(".amazonaws.com/")[1];
        if (key) imagesToDelete.push(key);
      });
    }

    
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

    
    const filter = {
      "address.city": {
        $regex: name,
        $options: 'i' 
      }
    };

    
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

    
    if (amenities) {
      const amenitiesArray = Array.isArray(amenities) ? amenities : amenities.split(',');
      filter.amenities = { $in: amenitiesArray.map(a => a.trim()) };
    }

    
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

    
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    
    const hotels = await hotelModel
      .find(filter)
      .select('name description address images rooms amenities priceRange Rent ourService averageRating reviewCount')
      .populate('adminId', 'name email contactNo')
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNum)
      .lean();

    
    const totalHotels = await hotelModel.countDocuments(filter);
    const totalPages = Math.ceil(totalHotels / limitNum);

    
    const reviewModel = mongoose.model("Review");
    const transformedHotels = await Promise.all(hotels.map(async (hotel) => {
      const latestReviews = await reviewModel.find({ 
        businessId: hotel._id, 
        businessType: 'Hotel', 
        isActive: true 
      })
      .populate('userId', 'name avatar profilePicture')
      .sort({ createdAt: -1 })
      .limit(2)
      .lean();

      return {
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
          totalReviews: hotel.reviewCount || 0
        },
        reviewCount: hotel.reviewCount || 0,
        averageRating: hotel.averageRating || 0,
        reviews: formatReviewsResponse(latestReviews, req.user?._id),
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
      };
    }));

    if (req.user?._id) {
      const watchlist = await watchListModel.findOne({ userId: req.user._id });
      const favoriteHotelIds = watchlist ? watchlist.hotels.map(id => id.toString()) : [];
      transformedHotels.forEach(hotel => {
        hotel.isFavorite = favoriteHotelIds.includes(hotel._id.toString());
      });
    } else {
      transformedHotels.forEach(hotel => {
        hotel.isFavorite = false;
      });
    }

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

    const hotels = await hotelModel.find(searchCondition).lean();

    if (hotels.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No hotels found matching your search",
      });
    }

    let favoriteHotelIds = [];
    if (req.user?._id) {
      const watchlist = await watchListModel.findOne({ userId: req.user._id });
      favoriteHotelIds = watchlist ? watchlist.hotels.map(id => id.toString()) : [];
    }

    const reviewModel = mongoose.model("Review");
    const hotelsWithStats = await Promise.all(hotels.map(async (hotel) => {
      const latestReviews = await reviewModel.find({ 
        businessId: hotel._id, 
        businessType: 'Hotel', 
        isActive: true 
      })
      .populate('userId', 'name avatar profilePicture')
      .sort({ createdAt: -1 })
      .limit(2)
      .lean();

      return {
        ...hotel,
        isFavorite: favoriteHotelIds.includes(hotel._id.toString()),
        averageRating: hotel.averageRating || 0,
        reviewCount: hotel.reviewCount || 0,
        reviews: formatReviewsResponse(latestReviews, req.user?._id)
      };
    }));

    return res.status(200).json({
      success: true,
      message: `${hotels.length} hotels found`,
      data: hotelsWithStats,
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
      .select("name description address images actualPrice discountPrice averageRating reviewCount amenities")
      .limit(20)
      .lean();

    let favoriteHotelIds = [];
    if (req.user?._id) {
      const watchlist = await watchListModel.findOne({ userId: req.user._id });
      favoriteHotelIds = watchlist ? watchlist.hotels.map(id => id.toString()) : [];
    }

    const reviewModel = mongoose.model("Review");
    const hotelsWithStats = await Promise.all(hotels.map(async (hotel) => {
      const latestReviews = await reviewModel.find({ 
        businessId: hotel._id, 
        businessType: 'Hotel', 
        isActive: true 
      })
      .populate('userId', 'name avatar profilePicture')
      .sort({ createdAt: -1 })
      .limit(2)
      .lean();

      return {
        ...hotel,
        isFavorite: favoriteHotelIds.includes(hotel._id.toString()),
        averageRating: hotel.averageRating || 0,
        reviewCount: hotel.reviewCount || 0,
        reviews: formatReviewsResponse(latestReviews, req.user?._id)
      };
    }));

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
      result: hotelsWithStats,
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

    
    if (updateData.actualPrice) updateData.actualPrice = Number(updateData.actualPrice);
    if (updateData.discountPrice) updateData.discountPrice = Number(updateData.discountPrice);

    
    if (req.files?.hotelImages) {
      // Delete old images from S3
      if (Array.isArray(hotel.images) && hotel.images.length > 0) {
        const imagesToDelete = hotel.images
          .map((imgUrl) => imgUrl.split(".amazonaws.com/")[1])
          .filter(Boolean);
          
        if (imagesToDelete.length > 0) {
          await Promise.allSettled(
            imagesToDelete.map((key) => deleteFromS3(key))
          ).catch((err) => log.warn("Failed to delete old images:", err.message));
        }
      }
      // Replace with new images
      updateData.images = req.files.hotelImages;
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

