import mongoose from "mongoose";
import { resizeImage, uploadToS3, deleteFromS3 } from "../middleware/uploadS3.js";
import hallModel from "../model/hall.model.js";
import adminModel from "../model/admin.model.js";
import userModel from "../model/user.model.js";
import { sendBadRequest, sendError, sendNotFound, sendSuccess } from "../utils/responseUtils.js";
import log from "../utils/logger.js";
import reviewModel from "../model/review.model.js";


// In your controller - CHANGE THIS:
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

    // Validation
    if (!name?.trim()) return sendBadRequest(res, "Hall name is required");
    if (!actualPrice || actualPrice <= 0) return sendBadRequest(res, "Valid actual price is required");
    if (!discountPrice || discountPrice <= 0) return sendBadRequest(res, "Valid discount price is required");

    // Check for duplicate hall BEFORE uploading images
    const existingHall = await hallModel.findOne({ name: name.trim() });
    if (existingHall) {
      return sendBadRequest(res, "A hall with this name already exists");
    }

    // ---- File uploads ----
    const imageFile = req.files?.image?.[0] || req.files?.featured?.[0] || req.files?.images?.[0];

    const imageUrl = imageFile
      ? await uploadToS3(
        await resizeImage(imageFile.buffer, { width: 1280, height: 720 }),
        imageFile.originalname,
        imageFile.mimetype,
        "halls"
      )
      : null;

    // ---- Parse JSON fields ----
    const parsed = (v, fallback = []) => (typeof v === "string" ? JSON.parse(v) : v || fallback);

    // ---- Create hall ----
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

    // ✅ Append hall ID to admin model
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

// @desc    Get all halls with filtering and pagination
// @route   GET /api/halls
// @access  Public
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

    // Build filter
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

    // Pagination
    const skip = (page - 1) * limit;

    const halls = await hallModel.find(filter)
      .populate('adminId', 'name email')
      .limit(limit * 1)
      .skip(skip)
      .sort({ createdAt: -1 });

    const total = await hallModel.countDocuments(filter);

    res.json({
      success: true,
      count: halls.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      data: halls
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

// @desc    Get single hall by ID
// @route   GET /api/halls/:id
// @access  Public
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

    // Fetch reviews
    const reviews = await reviewModel.find({ businessId: id, businessType: 'Hall', isActive: true })
      .populate('userId', 'name avatar profilePicture')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // Stats calculation
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

    // Standardized response for premium UI
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
      reviews: reviews.map(r => ({
        ...r,
        ratingText: r.rating === 5 ? "Great" : r.rating === 4 ? "Good" : r.rating === 3 ? "Okay" : r.rating === 2 ? "Bad" : "Terrible"
      })),
      reviewSummary: {
        average: averageRating,
        totalReviews: totalCount,
        distribution
      }
    };

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
        rating: { $gte: 4 } // Only halls with rating 4+ 
      })
      .select('name actualPrice discountPrice location type category capacity amenities image rating reviewCount')
      .sort({
        rating: -1,
        reviewCount: -1,
        createdAt: -1
      })
      .limit(parseInt(limit))
      .populate('adminId', 'name email'); // Populate admin info if needed

    // If no high-rated halls, get recently added available halls
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
        data: recentHalls
      });
    }

    res.status(200).json({
      success: true,
      message: "Popular halls fetched successfully",
      count: popularHalls.length,
      data: popularHalls
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

    // Check if admin owns this hall
    if (hall.createdBy.toString() !== req.admin._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this hall"
      });
    }

    // File uploads
    const imageFile = req.files?.image?.[0] || req.files?.featured?.[0] || req.files?.images?.[0];

    // Update image if provided
    if (imageFile) {
      // Delete old image
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

    // Parse JSON fields
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

    // Update fields
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

    // Check if admin owns this hall
    if (hall.adminId.toString() !== req.admin._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this hall"
      });
    }

    // ✅ Remove hall ID from admin model before deleting
    if (hall.adminId) {
      await adminModel.findByIdAndUpdate(
        hall.adminId,
        { $pull: { halls: req.params.id } },
        { new: true }
      ).catch(err => log.warn("Failed to remove hall from admin:", err.message));
    }

    // Collect all images to delete from S3
    const imagesToDelete = [];

    // Image
    if (hall.image) {
      const key = hall.image.split(".amazonaws.com/")[1];
      if (key) imagesToDelete.push(key);
    }

    // Delete all images from S3
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
    const { numberOfday = 1 } = req.query;

    if (!hallId || !mongoose.Types.ObjectId.isValid(hallId)) {
      return sendBadRequest(res, "Invalid hall ID");
    }

    const numberOfDays = parseInt(numberOfday);
    if (isNaN(numberOfDays) || numberOfDays <= 0) {
      return sendBadRequest(res, "Number of days must be a positive number");
    }

    const hall = await hallModel.findById(hallId);
    if (!hall) {
      return sendNotFound(res, "Hall not found");
    }

    const basePricePerDay = hall.discountPrice || hall.actualPrice;
    const baseSubtotal = basePricePerDay * numberOfDays;

    const actualPrice = baseSubtotal;
    const discountPercentage = 10;
    const discountAmount = (actualPrice * discountPercentage) / 100;
    const amountAfterDiscount = actualPrice - discountAmount;

    const taxesAndFeesPercentage = 23;
    const taxesAndFeesAmount = (amountAfterDiscount * taxesAndFeesPercentage) / 100;
    const totalAmount = amountAfterDiscount + taxesAndFeesAmount;

    const round = (num) => Math.round(num * 100) / 100;

    const formattedResponse = {
      hallDetails: {
        id: hall._id,
        name: hall.name,
        type: hall.type,
        address: hall.address,
        image: hall.image || null
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
          {
            label: "Taxes \u0026 Services",
            value: `\u20B9${round(taxesAndFeesAmount).toFixed(2)}`
          },
          {
            label: "Total Amount of Paid",
            value: `\u20B9${round(totalAmount).toFixed(2)}`,
            bold: true
          }
        ],
        totalAmount: round(totalAmount).toFixed(2),
        currency: "INR",
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

// @desc    Get all halls created by the logged-in admin
// @route   GET /api/getAdminHalls
// @access  Private (Admin)
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