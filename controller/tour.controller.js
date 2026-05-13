import tourModel from "../model/tour.model.js";
import adminModel from "../model/admin.model.js";
import { upload, uploadToS3, resizeImage, deleteFromS3 } from "../middleware/uploadS3.js";
import mongoose from "mongoose";
import { sendBadRequest, sendSuccess, sendError, sendNotFound } from "../utils/responseUtils.js";
import log from "../utils/logger.js";

export const uploadTourImage = upload.single('tourImage');

export const createTour = async (req, res) => {
  try {
    const adminId = req.admin._id;
    const {
      tourName,
      dayNight,
      tourViews,
      ourServiceForTour,
      emiOption,
      pricePerPerson,
      totalPrice,
      contactNo,
      whatsAppNo,
      bestOffer
    } = req.body;

    if (!tourName?.trim()) return sendBadRequest(res, "Tour name is required");

    const existingTour = await tourModel.findOne({ tourName: tourName.trim() });
    if (existingTour) return sendBadRequest(res, "A tour with this name already exists");

    let tourImageUrl = null;
    if (req.file) {
      const resizedImageBuffer = await resizeImage(req.file.buffer, { width: 1200, height: 800, quality: 85 });
      tourImageUrl = await uploadToS3(resizedImageBuffer, req.file.originalname, req.file.mimetype, "tours");
    }

    const parsedTourViews = Array.isArray(tourViews) ? tourViews : (tourViews ? JSON.parse(tourViews) : []);
    const parsedServices = Array.isArray(ourServiceForTour) ? ourServiceForTour : (ourServiceForTour ? JSON.parse(ourServiceForTour) : []);

    const newTour = new tourModel({
      adminId,
      tourImage: tourImageUrl,
      tourName,
      dayNight,
      tourViews: parsedTourViews,
      ourServiceForTour: parsedServices,
      emiOption,
      pricePerPerson,
      totalPrice,
      contactNo,
      whatsAppNo,
      bestOffer: bestOffer === 'true' || bestOffer === true
    });

    const savedTour = await newTour.save();

    if (savedTour.adminId && savedTour._id) {
      await adminModel.findByIdAndUpdate(
        savedTour.adminId,
        { $addToSet: { tours: savedTour._id } },
        { new: true }
      ).catch(err => log.warn("Failed to update admin tours:", err.message));
    }

    return sendSuccess(res, "Tour created successfully", savedTour, 201);
  } catch (error) {
    return sendError(res, "Error creating tour", error);
  }
};

export const getAllTours = async (req, res) => {
  try {
    const adminId = req.admin._id;
    const {
      tourName,
      minPrice,
      maxPrice,
      bestOffer,
      isActive,
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc"
    } = req.query;

    const filter = {};
    if (adminId) filter.adminId = adminId;
    if (tourName) filter.tourName = { $regex: tourName, $options: 'i' };
    if (minPrice || maxPrice) {
      filter.pricePerPerson = {};
      if (minPrice) filter.pricePerPerson.$gte = Number(minPrice);
      if (maxPrice) filter.pricePerPerson.$lte = Number(maxPrice);
    }
    if (bestOffer !== undefined) filter.bestOffer = bestOffer === 'true';
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const sortConfig = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const reviewModel = mongoose.model("Review");
    const toursWithStats = await Promise.all(tours.map(async (tour) => {
      const latestReviews = await reviewModel.find({ 
        businessId: tour._id, 
        businessType: 'Tour', 
        isActive: true 
      })
      .populate('userId', 'name avatar profilePicture')
      .sort({ createdAt: -1 })
      .limit(2)
      .lean();

      return {
        ...tour,
        averageRating: tour.averageRating || 0,
        reviewCount: tour.reviewCount || 0,
        reviews: latestReviews.map(r => ({
          ...r,
          ratingText: r.rating === 5 ? "Great" : r.rating === 4 ? "Good" : r.rating === 3 ? "Okay" : r.rating === 2 ? "Bad" : "Terrible"
        }))
      };
    }));

    return sendSuccess(res, "Tours fetched successfully", toursWithStats);
  } catch (error) {
    return sendError(res, "Error fetching tours", error);
  }
};

export const getTourById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequest(res, "Invalid Tour ID");

    const tour = await tourModel.findById(id).lean();
    if (!tour) return sendNotFound(res, "Tour not found");

    // Fetch reviews from centralized Review model
    const reviewModel = mongoose.model("Review");
    const reviews = await reviewModel.find({ businessId: id, businessType: 'Tour', isActive: true })
      .populate('userId', 'name avatar profilePicture')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const stats = await reviewModel.aggregate([
      { $match: { businessId: new mongoose.Types.ObjectId(id), businessType: 'Tour', isActive: true } },
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
      ...tour,
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

    return sendSuccess(res, "Tour fetched successfully", result);
  } catch (error) {
    return sendError(res, "Error fetching tour", error);
  }
};

export const updateTour = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequest(res, "Invalid Tour ID");

    const updateData = { ...req.body };

    const existingTour = await tourModel.findById(id);
    if (!existingTour) return sendNotFound(res, "Tour not found");

    if (req.file) {
      if (existingTour.tourImage) {
        const oldImageKey = existingTour.tourImage.split('.amazonaws.com/')[1];
        await deleteFromS3(oldImageKey).catch(err => log.warn("S3 Delete Error:", err));
      }
      const resizedImageBuffer = await resizeImage(req.file.buffer, { width: 1200, height: 800, quality: 85 });
      updateData.tourImage = await uploadToS3(resizedImageBuffer, req.file.originalname, req.file.mimetype, "tours");
    }

    if (updateData.tourViews && typeof updateData.tourViews === 'string') updateData.tourViews = JSON.parse(updateData.tourViews);
    if (updateData.ourServiceForTour && typeof updateData.ourServiceForTour === 'string') updateData.ourServiceForTour = JSON.parse(updateData.ourServiceForTour);
    if (updateData.bestOffer !== undefined) updateData.bestOffer = updateData.bestOffer === 'true' || updateData.bestOffer === true;

    const updatedTour = await tourModel.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });

    return sendSuccess(res, "Tour updated successfully", updatedTour);
  } catch (error) {
    return sendError(res, "Error updating tour", error);
  }
};

export const deleteTour = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequest(res, "Invalid Tour ID");

    const tour = await tourModel.findById(id);
    if (!tour) return sendNotFound(res, "Tour not found");

    if (tour.adminId) {
      await adminModel.findByIdAndUpdate(
        tour.adminId,
        { $pull: { tours: id } },
        { new: true }
      ).catch(err => log.warn("Failed to remove tour from admin:", err.message));
    }

    if (tour.tourImage) {
      const imageKey = tour.tourImage.split('.amazonaws.com/')[1];
      await deleteFromS3(imageKey).catch(err => log.warn("S3 Delete Error:", err));
    }

    await tourModel.findByIdAndDelete(id);
    return sendSuccess(res, "Tour deleted successfully");
  } catch (error) {
    return sendError(res, "Error deleting tour", error);
  }
};

export const getBestOfferTours = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const tours = await tourModel
      .find({ bestOffer: true, isActive: true })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    return sendSuccess(res, "Best offer tours fetched successfully", tours);
  } catch (error) {
    return sendError(res, "Error fetching best offer tours", error);
  }
};

export const updateTourImage = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequest(res, "Invalid Tour ID");
    if (!req.file) return sendBadRequest(res, "Image file is required");

    const tour = await tourModel.findById(id);
    if (!tour) return sendNotFound(res, "Tour not found");

    if (tour.tourImage) {
      const oldImageKey = tour.tourImage.split('.amazonaws.com/')[1];
      await deleteFromS3(oldImageKey).catch(err => log.warn("S3 Delete Error:", err));
    }

    const resizedImageBuffer = await resizeImage(req.file.buffer, { width: 1200, height: 800, quality: 85 });
    const newImageUrl = await uploadToS3(resizedImageBuffer, req.file.originalname, req.file.mimetype, "tours");

    const updatedTour = await tourModel.findByIdAndUpdate(id, { tourImage: newImageUrl }, { new: true });
    return sendSuccess(res, "Tour image updated successfully", updatedTour);
  } catch (error) {
    return sendError(res, "Error updating tour image", error);
  }
};