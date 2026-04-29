import offerModel from "../model/offer.model.js";
import { sendBadRequest, sendError, sendSuccess, sendCreated } from "../utils/responseUtils.js";
import { uploadToS3, deleteFromS3 } from "../middleware/uploadS3.js";
import mongoose from "mongoose";

export const createOffer = async (req, res) => {
  try {
    const { title, discountText, subtitle } = req.body;
    let backgroundImage = req.body.backgroundImage;

    if (req.file) {
      backgroundImage = await uploadToS3(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        "offers"
      );
    }

    if (!discountText) {
      return sendBadRequest(res, "discountText is required");
    }

    const newOffer = await offerModel.create({
      title: title || "Get Up to",
      discountText: discountText,
      subtitle: subtitle || "on your dining",
      backgroundImage: backgroundImage || null,
    });

    return sendCreated(res, "Offer created successfully", newOffer);
  } catch (error) {
    console.log("Error creating offer:", error.message);
    return sendError(res, "Failed to create offer", error.message);
  }
};

export const getAllOffers = async (req, res) => {
  try {
    const offers = await offerModel.find().sort({ createdAt: -1 });
    return sendSuccess(res, "Offers fetched successfully", offers);
  } catch (error) {
    return sendError(res, "Failed to fetch offers", error.message);
  }
};

export const getOfferById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequest(res, "Invalid Id");
    }
    const offer = await offerModel.findById(id);


    if (!offer) return sendError(res, "Offer not found");
    return sendSuccess(res, "Offer fetched successfully", offer);
  } catch (error) {
    return sendError(res, "Failed to fetch offer", error.message);
  }
};

export const updateOffer = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, discountText, subtitle, isActive } = req.body;

    const existingOffer = await offerModel.findById(id);
    if (!existingOffer) return sendError(res, "Offer not found");

    let updateData = { title, discountText, subtitle, isActive };
    if (req.file) {
      updateData.backgroundImage = await uploadToS3(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        "offers"
      );

      // Delete old image from S3 if a new one is uploaded
      if (existingOffer.backgroundImage) {
        try {
          const key = existingOffer.backgroundImage.split(".amazonaws.com/")[1];
          if (key) await deleteFromS3(key);
        } catch (err) {
          console.error("Failed to delete old image from S3:", err.message);
        }
      }
    } else if (req.body.backgroundImage !== undefined) {
      updateData.backgroundImage = req.body.backgroundImage;
    }

    const updated = await offerModel.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updated) return sendError(res, "Offer not found");
    return sendSuccess(res, "Offer updated successfully", updated);
  } catch (error) {
    return sendError(res, "Failed to update offer", error.message);
  }
};

export const deleteOffer = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await offerModel.findByIdAndDelete(id);
    if (!deleted) return sendError(res, "Offer not found");

    // Delete associated image from S3
    if (deleted.backgroundImage) {
      try {
        const key = deleted.backgroundImage.split(".amazonaws.com/")[1];
        if (key) await deleteFromS3(key);
      } catch (err) {
        console.error("Failed to delete image from S3:", err.message);
      }
    }

    return sendSuccess(res, "Offer deleted successfully");
  } catch (error) {
    return sendError(res, "Failed to delete offer", error.message);
  }
};

export const toggleOfferStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const offer = await offerModel.findById(id);
    if (!offer) return sendError(res, "Offer not found");

    offer.isActive = !offer.isActive;
    await offer.save();

    return sendSuccess(res, `Offer is now ${offer.isActive ? "Active" : "Inactive"}`, offer);
  } catch (error) {
    return sendError(res, "Failed to toggle offer status", error.message);
  }
};
