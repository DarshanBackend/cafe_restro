import mongoose from "mongoose";
import { resizeImage, uploadToS3, deleteFromS3 } from "../middleware/uploadS3.js";
import hallModel from "../model/hall.model.js";
import watchListModel from "../model/watchlist.model.js";
import adminModel from "../model/admin.model.js";
import userModel from "../model/user.model.js";
import { sendBadRequest, sendError, sendNotFound, sendSuccess } from "../utils/responseUtils.js";
import log from "../utils/logger.js";
import reviewModel from "../model/review.model.js";
import coupanModel from "../model/coupan.model.js";
import { formatReviewsResponse } from "../utils/reviewUtils.js";

export const createHall = async (req, res) => {
  try {
    const {
      name,
      description,
      actualPrice,
      discountPrice,
      location,
      address,
      type,
      category,
      capacity,
      amenities,
      isAvailable = true,
      ourService
    } = req.body;

    const adminId = req.admin._id;

    const isUser = await userModel.findOne({ _id: adminId });
    if (isUser) {
      return sendBadRequest(res, "You'r user OOPS!")
    }

    if (!name?.trim()) return sendBadRequest(res, "Hall name is required");
    if (!actualPrice || actualPrice <= 0) return sendBadRequest(res, "Valid actual price is required");
    if (!discountPrice || discountPrice <= 0) return sendBadRequest(res, "Valid discount price is required");

    const existingHall = await hallModel.findOne({ name: name.trim() });
    if (existingHall) {
      return sendBadRequest(res, "A hall with this name already exists");
    }

    const imageFile = req.files?.image?.[0] || req.files?.featured?.[0] || req.files?.images?.[0];

    const imageUrl = imageFile
      ? await uploadToS3(
        await resizeImage(imageFile.buffer, { width: 1280, height: 720 }),
        imageFile.originalname,
        imageFile.mimetype,
        "halls"
      )
      : null;

    const parsed = (v, fallback = []) => (typeof v === "string" ? JSON.parse(v) : v || fallback);

    const hall = new hallModel({
      adminId: adminId,
      name: name.trim(),
      description: description?.trim() || "",
      actualPrice: Number(actualPrice),
      discountPrice: Number(discountPrice),
      location: location?.trim() || "",
      address: address?.trim() || "",
      type: type?.trim() || "Banquet Hall",
      category: category?.trim() || "Standard",
      capacity: Number(capacity) || 100,
      amenities: parsed(amenities),
      image: imageUrl,
      ourService: parsed(ourService, {
        connectVieCall: null,
        connectVieMessage: null,
        helpSupport: null
      }),
      isAvailable: isAvailable === "true" || isAvailable === true,
      createdBy: req.admin._id
    });

    await hall.save();

    if (hall.adminId && hall._id) {
      await adminModel.findByIdAndUpdate(
        hall.adminId,
        { $addToSet: { halls: hall._id } },
        { new: true }
      ).catch(err => log.warn("Failed to update admin halls:", err.message));
    }

    console.log(`Hall created: ${hall.name}`);
    return sendSuccess(res, "Hall created successfully", hall);
  } catch (error) {
    console.error(`createHall Error: ${error.message}`);
    return sendError(res, "Failed to create hall", error);
  }
};

export const getAllHalls = async (req, res) => {
  try {
    const {
      location,
      type,
      category,
      minPrice,
      maxPrice,
      search,
      page = 1,
      limit = 10
    } = req.query;

    let filter = { isAvailable: true };

    if (location) filter.location = { $regex: location, $options: 'i' };
    if (type) filter.type = type;
    if (category) filter.category = category;

    if (minPrice || maxPrice) {
      filter.discountPrice = {};
      if (minPrice) filter.discountPrice.$gte = Number(minPrice);
      if (maxPrice) filter.discountPrice.$lte = Number(maxPrice);
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;

    const halls = await hallModel.find(filter)
      .populate('adminId', 'name email')
      .limit(limit * 1)
      .skip(skip)
      .sort({ createdAt: -1 });

    const total = await hallModel.countDocuments(filter);

    let favoriteHallIds = [];
    if (req.user?._id) {
      const watchlist = await watchListModel.findOne({ userId: req.user._id });
      favoriteHallIds = watchlist ? watchlist.hall.map(id => id.toString()) : [];
    }

    const hallsWithFavorite = halls.map(hall => ({
      ...hall.toObject(),
      isFavorite: favoriteHallIds.includes(hall._id.toString())
    }));

    res.json({
      success: true,
      count: halls.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      data: hallsWithFavorite
    });

  } catch (error) {
    console.error("Get halls error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch halls",
      error: error.message
    });
  }
};

export const getHallById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequest(res, "Invalid hall ID");
    }

    const hall = await hallModel.findById(id).populate('adminId', 'name email contact phone');

    if (!hall) {
      return sendNotFound(res, "Hall not found");
    }

    const reviews = await reviewModel.find({ businessId: id, businessType: 'Hall', isActive: true })
      .populate('userId', 'name avatar profilePicture')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const stats = await reviewModel.aggregate([
      { $match: { businessId: new mongoose.Types.ObjectId(id), businessType: 'Hall', isActive: true } },
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

    const result = {
      _id: hall._id,
      name: hall.name,
      description: hall.description,
      actualPrice: hall.actualPrice,
      discountPrice: hall.discountPrice,
      location: hall.location,
      address: hall.address,
      type: hall.type,
      category: hall.category,
      capacity: hall.capacity,
      rating: averageRating,
      reviewCount: totalCount,
      amenities: hall.amenities || [],
      image: hall.image || null,
      ourService: hall.ourService || {
        connectVieCall: null,
        connectVieMessage: null,
        helpSupport: null
      },
      isAvailable: hall.isAvailable,
      admin: hall.adminId,
      reviews: formatReviewsResponse(reviews, req.user?._id),
      reviewSummary: {
        average: averageRating,
        totalReviews: totalCount,
        distribution
      }
    };

    if (req.user?._id) {
      const watchlist = await watchListModel.findOne({ userId: req.user._id });
      result.isFavorite = watchlist ? watchlist.hall.some(id => id.toString() === hall._id.toString()) : false;
    } else {
      result.isFavorite = false;
    }

    return sendSuccess(res, "Hall details fetched successfully", result);

  } catch (error) {
    console.error("Get hall by ID error:", error);
    return sendError(res, "Server error while fetching hall details", error);
  }
};

export const getPopularHalls = async (req, res) => {
  try {
    const { limit = 8 } = req.query;

    const popularHalls = await hallModel
      .find({
        isAvailable: true,
        rating: { $gte: 4 }
      })
      .select('name actualPrice discountPrice location type category capacity amenities image rating reviewCount')
      .sort({
        rating: -1,
        reviewCount: -1,
        createdAt: -1
      })
      .limit(parseInt(limit))
      .populate('adminId', 'name email');

    if (popularHalls.length === 0) {
      const recentHalls = await hallModel
        .find({ isAvailable: true })
        .select('name actualPrice discountPrice location type category capacity amenities image rating reviewCount')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .populate('adminId', 'name email');

      return res.status(200).json({
        success: true,
        message: "Recent halls fetched successfully",
        count: recentHalls.length,
        data: await attachHallFavorite(req, recentHalls)
      });
    }

    res.status(200).json({
      success: true,
      message: "Popular halls fetched successfully",
      count: popularHalls.length,
      data: await attachHallFavorite(req, popularHalls)
    });

  } catch (error) {
    console.error("Get popular halls error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch popular halls",
      error: error.message
    });
  }
};

const attachHallFavorite = async (req, halls) => {
  if (req.user?._id) {
    const watchlist = await watchListModel.findOne({ userId: req.user._id });
    const favoriteHallIds = watchlist ? watchlist.hall.map(id => id.toString()) : [];
    return halls.map(hall => ({
      ...hall.toObject(),
      isFavorite: favoriteHallIds.includes(hall._id.toString())
    }));
  }
  return halls.map(hall => ({
    ...hall.toObject(),
    isFavorite: false
  }));
};

export const updateHall = async (req, res) => {
  try {
    const {
      name,
      description,
      actualPrice,
      discountPrice,
      location,
      address,
      type,
      category,
      capacity,
      amenities,
      isAvailable,
      ourService
    } = req.body;

    const hall = await hallModel.findById(req.params.id);
    if (!hall) {
      return res.status(404).json({
        success: false,
        message: "Hall not found"
      });
    }

    if (hall.createdBy.toString() !== req.admin._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this hall"
      });
    }

    const imageFile = req.files?.image?.[0] || req.files?.featured?.[0] || req.files?.images?.[0];

    if (imageFile) {
      if (hall.image) {
        const oldImageKey = hall.image.split(".amazonaws.com/")[1];
        if (oldImageKey) {
          await deleteFromS3(oldImageKey).catch(err => log.warn("Failed to delete old image:", err.message));
        }
      }

      hall.image = await uploadToS3(
        await resizeImage(imageFile.buffer, { width: 1280, height: 720 }),
        imageFile.originalname,
        imageFile.mimetype,
        "halls"
      );
    }

    const parseArray = (value) => {
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return undefined;
        }
      }
      return value;
    };

    if (name !== undefined) hall.name = name.trim();
    if (description !== undefined) hall.description = description.trim();
    if (actualPrice !== undefined) hall.actualPrice = Number(actualPrice);
    if (discountPrice !== undefined) hall.discountPrice = Number(discountPrice);
    if (location !== undefined) hall.location = location.trim();
    if (address !== undefined) hall.address = address.trim();
    if (type !== undefined) hall.type = type;
    if (category !== undefined) hall.category = category;
    if (capacity !== undefined) hall.capacity = Number(capacity);
    if (amenities !== undefined) hall.amenities = parseArray(amenities) || hall.amenities;
    if (isAvailable !== undefined) hall.isAvailable = isAvailable === 'true' || isAvailable === true;
    if (ourService !== undefined) hall.ourService = parseArray(ourService) || hall.ourService;

    await hall.save();

    res.json({
      success: true,
      message: "Hall updated successfully",
      data: hall
    });

  } catch (error) {
    console.error("Update hall error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update hall",
      error: error.message
    });
  }
};

export const deleteHall = async (req, res) => {
  try {
    const hall = await hallModel.findById(req.params.id);
    if (!hall) {
      return res.status(404).json({
        success: false,
        message: "Hall not found"
      });
    }

    if (hall.adminId.toString() !== req.admin._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this hall"
      });
    }

    if (hall.adminId) {
      await adminModel.findByIdAndUpdate(
        hall.adminId,
        { $pull: { halls: req.params.id } },
        { new: true }
      ).catch(err => log.warn("Failed to remove hall from admin:", err.message));
    }

    const imagesToDelete = [];

    if (hall.image) {
      const key = hall.image.split(".amazonaws.com/")[1];
      if (key) imagesToDelete.push(key);
    }

    if (imagesToDelete.length > 0) {
      await Promise.allSettled(imagesToDelete.map((key) => deleteFromS3(key)));
      log.info(`Deleted ${imagesToDelete.length} images from S3 for hall: ${req.params.id}`);
    }

    await hallModel.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Hall deleted successfully"
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete hall",
      error: error.message
    });
  }
};

export const deleteGalleryImage = async (req, res) => {
  return res.status(410).json({ success: false, message: "Gallery feature is no longer available" });
};

export const getPreviewBillingOfHall = async (req, res) => {
  try {
    const { hallId } = req.params;
    const { startDate, endDate, startTime, endTime, peoples, couponCode } = req.body;

    if (!hallId || !mongoose.Types.ObjectId.isValid(hallId)) {
      return sendBadRequest(res, "Invalid hall ID");
    }

    if (!startDate || !endDate) {
      return sendBadRequest(res, "Start date and end date are required");
    }

    const convertToDate = (dateString) => {
      const [day, month, year] = dateString.split('-');
      return new Date(`${year}-${month}-${day}`);
    };

    const start = convertToDate(startDate);
    const end = convertToDate(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return sendBadRequest(res, "Invalid date format. Please use DD-MM-YYYY");
    }

    if (end < start) {
      return sendBadRequest(res, "End date cannot be before start date");
    }

    const hall = await hallModel.findById(hallId);
    if (!hall) {
      return sendNotFound(res, "Hall not found");
    }

    if (peoples && Number(peoples) > hall.capacity) {
      return sendBadRequest(res, `Hall capacity exceeded. Maximum capacity is ${hall.capacity} people.`);
    }

    const numberOfDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) || 1;

    const basePricePerDay = hall.discountPrice || hall.actualPrice;
    const baseSubtotal = basePricePerDay * numberOfDays;

    const actualPrice = baseSubtotal;
    const discountPercentage = 10;
    const discountAmount = (actualPrice * discountPercentage) / 100;
    const amountAfterDiscount = actualPrice - discountAmount;

    let couponDetails = null;
    let amountAfterCoupon = amountAfterDiscount;

    if (couponCode) {
      const coupon = await coupanModel.findOne({ couponCode: couponCode.toUpperCase() });
      
      if (!coupon) {
        return sendBadRequest(res, "Invalid coupon code");
      }
      
      if (!coupon.isActive) {
        return sendBadRequest(res, "This coupon is no longer active");
      }
      
      if (coupon.couponExpire && new Date(coupon.couponExpire) < new Date()) {
        return sendBadRequest(res, "This coupon has expired");
      }

      const couponDiscountPercent = coupon.couponPerc || 0;
      const couponDiscountAmount = (amountAfterDiscount * couponDiscountPercent) / 100;
      amountAfterCoupon = amountAfterDiscount - couponDiscountAmount;

      couponDetails = {
        code: coupon.couponCode,
        discountPercent: couponDiscountPercent,
        discountAmount: couponDiscountAmount,
        description: `Additional ${couponDiscountPercent}% Coupon Discount Applied`,
      };
    }

    const taxesAndFeesPercentage = 23;
    const taxesAndFeesAmount = (amountAfterCoupon * taxesAndFeesPercentage) / 100;
    const totalAmount = amountAfterCoupon + taxesAndFeesAmount;

    const round = (num) => Math.round(num * 100) / 100;

    const formatToAMPM = (timeStr) => {
      if (!timeStr) return null;

      const match = timeStr.toLowerCase().match(/(\d{1,2}):(\d{2})\s*(am|pm)?/);
      if (!match) return { time: timeStr, ampm: null };

      let [_, hours, minutes, ampm] = match;
      let h = parseInt(hours);

      if (ampm) {
        return {
          time: `${h}:${minutes}`,
          ampm: ampm.toUpperCase()
        };
      } else {
        const finalAmpm = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        h = h ? h : 12;
        return {
          time: `${h}:${minutes}`,
          ampm: finalAmpm
        };
      }
    };

    const formattedResponse = {
      hallDetails: {
        id: hall._id,
        name: hall.name,
        type: hall.type,
        address: hall.address,
        image: hall.image || null
      },
      bookingDetails: {
        startDate,
        endDate,
        startTime: formatToAMPM(startTime),
        endTime: formatToAMPM(endTime),
        peoples: peoples || null
      },
      paymentSummary: {
        title: "Payment Information",
        items: [
          {
            label: `1 Hall * ${numberOfDays} Day${numberOfDays > 1 ? 's' : ''}`,
            value: `\u20B9${round(baseSubtotal).toFixed(2)}`
          },
          {
            label: "Discount",
            value: `${discountPercentage}%`,
            color: "blue"
          },
          {
            label: "With Discount",
            value: `\u20B9${round(amountAfterDiscount).toFixed(2)}`
          },
          couponDetails ? {
            label: `Promo Code (${couponDetails.code})`,
            value: `-₹${round(couponDetails.discountAmount).toFixed(2)}`,
            type: "discount"
          } : null,
          {
            label: "Taxes \u0026 Services",
            value: `\u20B9${round(taxesAndFeesAmount).toFixed(2)}`
          },
          {
            label: "Total Amount of Paid",
            value: `\u20B9${round(totalAmount).toFixed(2)}`,
            bold: true
          }
        ].filter(Boolean),
        totalAmount: round(totalAmount),
        currency: "INR",
        coupon: couponDetails ? {
          code: couponDetails.code,
          discountPercent: couponDetails.discountPercent,
          discountAmount: round(couponDetails.discountAmount)
        } : null,
        proceedAction: "Process To Paid"
      }
    };

    return res.status(200).json({
      success: true,
      message: "Hall billing preview generated successfully",
      result: [formattedResponse],
      length: 1
    });

  } catch (error) {
    console.error("Error in getPreviewBillingOfHall:", error.message);
    return sendError(res, "Error while generating billing preview", error);
  }
};

export const getAdminHalls = async (req, res) => {
  try {
    const adminId = req.admin._id;

    const halls = await hallModel.find({ adminId })
      .sort({ createdAt: -1 });

    return sendSuccess(res, "Admin halls fetched successfully", halls);
  } catch (error) {
    console.error("GetAdminHalls error:", error);
    return sendError(res, "Failed to fetch admin halls", error);
  }
};