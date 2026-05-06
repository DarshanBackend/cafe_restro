import mongoose from "mongoose";
import { deleteFromS3, uploadToS3 } from "../middleware/uploadS3.js";
import stayModel from "../model/stay.model.js";
import adminModel from "../model/admin.model.js";
import log from "../utils/logger.js";
import { sendBadRequest, sendError, sendNotFound, sendSuccess } from "../utils/responseUtils.js";

// ==================== ADMIN CONTROLLERS ==================== //

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

    // Support both old (pricePerHour) and new (actualPrice) field names
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

    // Parse amenities (may arrive as JSON string from multipart form)
    let parsedAmenities = [];
    if (amenities) {
      parsedAmenities = Array.isArray(amenities)
        ? amenities
        : (() => { try { return JSON.parse(amenities); } catch { return [amenities]; } })();
    }

    // Upload images
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

    // Sync with admin document
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

    // Sync pricePerHour ↔ actualPrice
    if (updates.actualPrice) updates.pricePerHour = updates.actualPrice;
    if (updates.pricePerHour && !updates.actualPrice) updates.actualPrice = updates.pricePerHour;

    // Parse amenities if sent as JSON string from multipart form
    if (updates.amenities && !Array.isArray(updates.amenities)) {
      try { updates.amenities = JSON.parse(updates.amenities); } catch { updates.amenities = [updates.amenities]; }
    }

    // Handle image replacement
    const files = req.files?.["stayImage"] || req.files?.["images"] || [];
    const fileArr = Array.isArray(files) ? files : [files];

    if (fileArr.length > 0 && fileArr[0]?.buffer) {
      // Delete old images
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

    // Remove from admin document
    await adminModel.findByIdAndUpdate(
      stay.adminId,
      { $pull: { stays: id } },
      { new: true }
    ).catch((err) => log.warn("Failed to remove stay from admin:", err.message));

    // Delete S3 images
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


// ==================== USER CONTROLLERS ==================== //

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

    const stays = await stayModel.find(filter).sort({ createdAt: -1 });
    return sendSuccess(res, "Stays fetched successfully", stays);
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

    const stay = await stayModel.findOne({ _id: id, isActive: true });
    if (!stay) return sendNotFound(res, "Stay not found");

    return sendSuccess(res, "Stay fetched successfully", [stay]);
  } catch (err) {
    console.error("getStayById error:", err);
    return sendError(res, "Failed to fetch stay", err);
  }
};