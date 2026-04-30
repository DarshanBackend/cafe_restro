import mongoose from "mongoose";
import { resizeImage, uploadToS3, deleteFromS3 } from "../middleware/uploadS3.js";
import hallModel from "../model/hall.model.js";
import adminModel from "../model/admin.model.js";
import userModel from "../model/user.model.js";
import { sendBadRequest, sendError, sendNotFound, sendSuccess } from "../utils/responseUtils.js";
import log from "../utils/logger.js";


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
      isAvailable = true
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

    // ---- File uploads - USE EXACT SAME FIELD NAMES ----
    const featuredFile = req.files?.featured?.[0];
    const galleryFiles = Array.isArray(req.files?.gallery) ? req.files.gallery : [];

    const featuredUrl = featuredFile
      ? await uploadToS3(
        await resizeImage(featuredFile.buffer, { width: 1280, height: 720 }),
        featuredFile.originalname,
        featuredFile.mimetype,
        "halls"
      )
      : null;

    const galleryUrls = await Promise.all(
      galleryFiles.map(async (file) => {
        const buffer = await resizeImage(file.buffer, { width: 1024, height: 768 });
        return await uploadToS3(buffer, file.originalname, file.mimetype, "halls/gallery");
      })
    );

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
      images: {
        featuredImage: featuredUrl,
        galleryImages: galleryUrls
      },
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
    return sendError(res, 500, "Failed to create hall", error.message);
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
    const hall = await hallModel.findById(req.params.id)
      .populate('adminId');

    if (!hall) {
      return res.status(404).json({
        success: false,
        message: "Hall not found"
      });
    }

    res.json({
      success: true,
      data: hall
    });

  } catch (error) {
    if (error.kind === 'ObjectId') {
      return res.status(404).json({
        success: false,
        message: "Hall not found"
      });
    }
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
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
      .select('name actualPrice discountPrice location type category capacity amenities images rating reviewCount')
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
        .select('name actualPrice discountPrice location type category capacity amenities images rating reviewCount')
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
      isAvailable
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
    const featuredFile = req.files?.featuredImage?.[0];
    const galleryFiles = req.files?.galleryImages || [];

    // Update featured image if provided
    if (featuredFile) {
      // Delete old featured image
      if (hall.images.featuredImage) {
        const oldImageKey = hall.images.featuredImage.split(".amazonaws.com/")[1];
        if (oldImageKey) {
          await deleteFromS3(oldImageKey).catch(err => log.warn("Failed to delete old featured image:", err.message));
        }
      }

      hall.images.featuredImage = await uploadToS3(
        await resizeImage(featuredFile.buffer, { width: 1280, height: 720 }),
        featuredFile.originalname,
        featuredFile.mimetype,
        "halls/featured"
      );
    }

    // Add new gallery images if provided
    if (galleryFiles.length > 0) {
      const newGalleryUrls = await Promise.all(
        galleryFiles.map(async (file) => {
          const buffer = await resizeImage(file.buffer, { width: 1024, height: 768 });
          return await uploadToS3(
            buffer,
            file.originalname,
            file.mimetype,
            "halls/gallery"
          );
        })
      );
      hall.images.galleryImages.push(...newGalleryUrls);
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

    // Featured image
    if (hall.images.featuredImage) {
      const key = hall.images.featuredImage.split(".amazonaws.com/")[1];
      if (key) imagesToDelete.push(key);
    }

    // Gallery images
    if (Array.isArray(hall.images.galleryImages) && hall.images.galleryImages.length > 0) {
      hall.images.galleryImages.forEach((url) => {
        const key = url.split(".amazonaws.com/")[1];
        if (key) imagesToDelete.push(key);
      });
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
    console.error("Delete hall error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete hall",
      error: error.message
    });
  }
};

export const deleteGalleryImage = async (req, res) => {
  try {
    const { id, imageIndex } = req.params;

    const hall = await hallModel.findById(id);
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
        message: "Not authorized to modify this hall"
      });
    }

    const index = parseInt(imageIndex);
    if (index < 0 || index >= hall.images.galleryImages.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid image index"
      });
    }

    // Delete image from S3
    const imageUrl = hall.images.galleryImages[index];
    const key = imageUrl.split(".amazonaws.com/")[1];
    if (key) {
      await deleteFromS3(key).catch(err => log.warn("Failed to delete gallery image from S3:", err.message));
    }

    // Remove from array
    hall.images.galleryImages.splice(index, 1);
    await hall.save();

    res.json({
      success: true,
      message: "Gallery image deleted successfully",
      data: hall
    });

  } catch (error) {
    console.error("Delete gallery image error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete gallery image",
      error: error.message
    });
  }
};

export const getPreviewBillingOfHall = async (req, res) => {
  try {
    const { hallId } = req.params;
    const { numberOfday } = req.query;

    if (!hallId || !mongoose.Types.ObjectId.isValid(hallId)) {
      return sendBadRequest(res, "Something went wrong with hallId");
    }

    // Convert numberOfday to number and validate
    const numberOfDays = parseInt(numberOfday);
    if (isNaN(numberOfDays) || numberOfDays <= 0) {
      return sendBadRequest(res, "Query parameter (numberOfday must be a positive number)");
    }

    const hall = await hallModel.findOne({ _id: hallId });

    if (!hall) {
      return sendNotFound(res, "Hall Not Found");
    }

    const basePricePerDay = hall.discountPrice; 
    const subTotal = basePricePerDay * numberOfDays;

    const actualPriceTotal = subTotal;
    const discountPercentage = 10;
    const discountAmount = (actualPriceTotal * discountPercentage) / 100;
    const discountPriceTotal = actualPriceTotal - discountAmount;

    const taxesAndFeesPercentage = 23;
    const taxesAndFeesAmount = (discountPriceTotal * taxesAndFeesPercentage) / 100;
    const totalAmount = discountPriceTotal + taxesAndFeesAmount;

    const formattedResponse = {
      hallDetails: {
        hallId: hall._id,
        hallName: hall.name,
        actualPrice: hall.actualPrice,
        offeredPrice: hall.discountPrice
      },
      billingSummary: {
        numberOfDays: numberOfDays,
        subTotal: subTotal,
        mandatoryDiscount: {
          percentage: discountPercentage,
          amount: discountAmount
        },
        discountPrice: discountPriceTotal,
        taxesAndFees: {
          percentage: taxesAndFeesPercentage,
          amount: taxesAndFeesAmount
        },
        totalAmount: Number(totalAmount.toFixed(2))
      },
      breakdown: {
        basePrice: subTotal,
        additionalCharges: [
          {
            name: `Tax (${taxesAndFeesPercentage}%)`,
            amount: taxesAndFeesAmount
          }
        ]
      }
    };

    return res.status(200).json({
      success: true,
      message: "Billing preview generated successfully",
      data: formattedResponse
    });

  } catch (error) {
    console.log("Error While Preview hall Billing", error.message);
    return sendError(res, "Error While Preview hall Billing", error);
  }
};