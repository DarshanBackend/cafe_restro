import mongoose from "mongoose";
import { deleteFromS3, uploadToS3 } from "../middleware/uploadS3.js";
import stayModel from "../model/stay.model.js";
import adminModel from "../model/admin.model.js";
import log from "../utils/logger.js";
import { sendBadRequest, sendError, sendNotFound, sendSuccess } from "../utils/responseUtils.js";



export const createStay = async (req, res) => {
  try {
    const {
      name,
      description,
      address,
      city,
      capacity,
      actualPrice,
      discountPrice,
      pricePerHour,
      amenities
    } = req.body;
    const { _id: adminId } = req.admin;

    
    const resolvedActualPrice = actualPrice || pricePerHour;

    if (!name || !address || !city || !capacity || !resolvedActualPrice) {
      return sendBadRequest(res, "name, address, city, capacity and actualPrice are required");
    }

    const existingStay = await stayModel.findOne({
      name: name.trim(),
      address: address.trim(),
      city: city.trim()
    });
    if (existingStay) {
      return sendBadRequest(res, "A stay with this name, address and city already exists");
    }

    
    let parsedAmenities = [];
    if (amenities) {
      parsedAmenities = Array.isArray(amenities)
        ? amenities
        : (() => { try { return JSON.parse(amenities); } catch { return [amenities]; } })();
    }

    
    let imageUrls = [];
    const files = req.files?.["stayImage"] || req.files?.["images"] || [];
    const fileArr = Array.isArray(files) ? files : [files];

    for (const file of fileArr) {
      if (file?.buffer) {
        const url = await uploadToS3(file.buffer, file.originalname, file.mimetype, "stayImages");
        imageUrls.push(url);
      }
    }

    const newStay = await stayModel.create({
      name: name.trim(),
      description: description || "",
      address: address.trim(),
      city: city.trim(),
      capacity: Number(capacity),
      actualPrice: Number(resolvedActualPrice),
      discountPrice: discountPrice ? Number(discountPrice) : 0,
      pricePerHour: Number(resolvedActualPrice),
      amenities: parsedAmenities,
      images: imageUrls,
      adminId
    });

    
    if (newStay.adminId && newStay._id) {
      await adminModel.findByIdAndUpdate(
        newStay.adminId,
        { $addToSet: { stays: newStay._id } },
        { new: true }
      ).catch((err) => log.warn("Failed to update admin stays:", err.message));
    }

    return sendSuccess(res, "Stay created successfully", [newStay]);
  } catch (error) {
    log.error(`createStay error: ${error.message}`);
    return sendError(res, "Failed to create stay", error);
  }
};


export const updateStay = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequest(res, "Invalid stay ID");
    }

    const stay = await stayModel.findById(id);
    if (!stay) return sendNotFound(res, "Stay not found or not authorized");

    const updates = { ...req.body };

    
    if (updates.actualPrice) updates.pricePerHour = updates.actualPrice;
    if (updates.pricePerHour && !updates.actualPrice) updates.actualPrice = updates.pricePerHour;

    
    if (updates.amenities && !Array.isArray(updates.amenities)) {
      try { updates.amenities = JSON.parse(updates.amenities); } catch { updates.amenities = [updates.amenities]; }
    }

    
    const files = req.files?.["stayImage"] || req.files?.["images"] || [];
    const fileArr = Array.isArray(files) ? files : [files];

    if (fileArr.length > 0 && fileArr[0]?.buffer) {
      
      if (Array.isArray(stay.images) && stay.images.length > 0) {
        for (const oldUrl of stay.images) {
          const key = oldUrl.split(".amazonaws.com/")[1];
          if (key) await deleteFromS3(key).catch(() => { });
        }
      }

      const newUrls = [];
      for (const file of fileArr) {
        if (file?.buffer) {
          const url = await uploadToS3(file.buffer, file.originalname, file.mimetype, "stayImages");
          newUrls.push(url);
        }
      }
      updates.images = newUrls;
    }

    const updatedStay = await stayModel.findByIdAndUpdate(id, updates, { new: true });
    return sendSuccess(res, "Stay updated successfully", [updatedStay]);
  } catch (error) {
    console.error("updateStay error:", error.message);
    return sendError(res, "Failed to update stay", error);
  }
};


export const deleteStay = async (req, res) => {
  try {
    const { id } = req.params;
    const { _id: adminId } = req.admin;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequest(res, "Invalid stay ID");
    }

    const stay = await stayModel.findById(id);
    if (!stay) return sendNotFound(res, "Stay not found");

    
    await adminModel.findByIdAndUpdate(
      stay.adminId,
      { $pull: { stays: id } },
      { new: true }
    ).catch((err) => log.warn("Failed to remove stay from admin:", err.message));

    
    if (Array.isArray(stay.images) && stay.images.length > 0) {
      for (const imageUrl of stay.images) {
        const key = imageUrl.split(".amazonaws.com/")[1];
        if (key) await deleteFromS3(key).catch(() => { });
      }
    }

    await stayModel.findByIdAndDelete(id);
    return sendSuccess(res, "Stay deleted successfully");
  } catch (err) {
    console.error("deleteStay error:", err);
    return sendError(res, "Failed to delete stay", err);
  }
};


export const getAdminStays = async (req, res) => {
  try {
    const { _id: adminId } = req.admin;
    const stays = await stayModel.find({ adminId }).sort({ createdAt: -1 });
    return sendSuccess(res, "Stays fetched successfully", stays);
  } catch (err) {
    console.error("getAdminStays error:", err);
    return sendError(res, "Failed to fetch stays", err);
  }
};




export const getAllStays = async (req, res) => {
  try {
    const { city, minPrice, maxPrice, search } = req.query;
    const filter = { isActive: true };

    if (city) filter.city = { $regex: city, $options: "i" };
    if (search) filter.name = { $regex: search, $options: "i" };
    if (minPrice || maxPrice) {
      filter.actualPrice = {};
      if (minPrice) filter.actualPrice.$gte = Number(minPrice);
      if (maxPrice) filter.actualPrice.$lte = Number(maxPrice);
    }

    const reviewModel = mongoose.model("Review");
    const staysWithStats = await Promise.all(stays.map(async (stay) => {
      const latestReviews = await reviewModel.find({ 
        businessId: stay._id, 
        businessType: 'Stay', 
        isActive: true 
      })
      .populate('userId', 'name avatar profilePicture')
      .sort({ createdAt: -1 })
      .limit(2)
      .lean();

      return {
        ...stay,
        averageRating: stay.averageRating || 0,
        reviewCount: stay.reviewCount || 0,
        reviews: latestReviews.map(r => ({
          ...r,
          ratingText: r.rating === 5 ? "Great" : r.rating === 4 ? "Good" : r.rating === 3 ? "Okay" : r.rating === 2 ? "Bad" : "Terrible"
        }))
      };
    }));

    return sendSuccess(res, "Stays fetched successfully", staysWithStats);
  } catch (err) {
    console.error("getAllStays error:", err);
    return sendError(res, "Failed to fetch stays", err);
  }
};


export const getStayById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequest(res, "Invalid stay ID");
    }

    const stay = await stayModel.findOne({ _id: id, isActive: true }).lean();
    if (!stay) return sendNotFound(res, "Stay not found");

    // Fetch reviews from centralized Review model
    const reviewModel = mongoose.model("Review");
    const reviews = await reviewModel.find({ businessId: id, businessType: 'Stay', isActive: true })
      .populate('userId', 'name avatar profilePicture')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const stats = await reviewModel.aggregate([
      { $match: { businessId: new mongoose.Types.ObjectId(id), businessType: 'Stay', isActive: true } },
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
      ...stay,
      averageRating,
      reviewCount: totalCount,
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

    return sendSuccess(res, "Stay fetched successfully", [result]);
  } catch (err) {
    console.error("getStayById error:", err);
    return sendError(res, "Failed to fetch stay", err);
  }
};