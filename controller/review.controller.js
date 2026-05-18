import mongoose from "mongoose";
import reviewModel, { BUSINESS_TYPES } from "../model/review.model.js";
import { uploadToS3, deleteFromS3 } from "../middleware/uploadS3.js";
import { sendSuccess, sendError, sendNotFound, sendBadRequest } from "../utils/responseUtils.js";
import { getRatingText, formatReviewResponse, formatReviewsResponse } from "../utils/reviewUtils.js";
import log from "../utils/logger.js";


const updateBusinessRatingStats = async (businessType, businessId) => {
    const businessConfig = Object.values(BUSINESS_TYPES).find(config => config.type === businessType);
    if (!businessConfig) return;

    const stats = await reviewModel.getBusinessRatingStats(businessId, businessType);

    await businessConfig.model.findByIdAndUpdate(businessId, {
        averageRating: stats.averageRating,
        reviewCount: stats.totalReviews
    });
};

export const addReview = async (req, res) => {
    try {
        const userId = req.user?._id;
        const { businessId } = req.params;
        const { rating, comment, businessType } = req.body;

        if (!mongoose.Types.ObjectId.isValid(businessId)) {
            return sendBadRequest(res, "Invalid business ID");
        }

        if (!rating || isNaN(rating) || rating < 1 || rating > 5) {
            return sendBadRequest(res, "Valid rating (1-5) is required");
        }

        const validType = Object.values(BUSINESS_TYPES).find(config => config.type === businessType);
        if (!validType) {
            return sendBadRequest(res, "Invalid business type");
        }

        
        const business = await validType.model.findById(businessId);
        if (!business) return sendNotFound(res, "Business not found");

        
        const existingReview = await reviewModel.findOne({
            userId,
            businessId,
            businessType,
            isActive: true
        });

        if (existingReview) {
            return sendBadRequest(res, "You have already reviewed this business");
        }

        
        const media = [];
        if (req.files && req.files.media) {
            const files = Array.isArray(req.files.media) ? req.files.media : [req.files.media];
            for (const file of files) {
                const url = await uploadToS3(file.buffer, file.originalname, file.mimetype, "reviews");
                const key = url.split(".amazonaws.com/")[1];
                media.push({
                    url,
                    key,
                    type: file.mimetype.startsWith("video/") ? "video" : "image",
                    uploadDate: new Date()
                });
            }
        }

        const review = await reviewModel.create({
            userId,
            businessId,
            businessType,
            rating: Math.round(rating),
            comment: comment || "",
            media,
        });

        const populatedReview = await reviewModel.findById(review._id)
            .populate("userId", "name avatar profilePicture")
            .lean();

        const finalReview = formatReviewResponse(populatedReview, null);

        updateBusinessRatingStats(businessType, businessId).catch(err => log.error("Update stats error: " + err.message));

        return sendSuccess(res, "Review added successfully", finalReview);

    } catch (error) {
        log.error("addReview Error: " + error.message);
        return sendError(res, "Internal server error", error);
    }
};


export const deleteReview = async (req, res) => {
    try {
        const { reviewId } = req.params;

        const review = await reviewModel.findOne({ _id: reviewId, isActive: true });
        if (!review) return sendNotFound(res, "Review not found");

        for (const m of review.media) {
            if (m.key) await deleteFromS3(m.key).catch(err => log.error("S3 Delete Error: " + err.message));
        }

        const businessId = review.businessId;
        const businessType = review.businessType;

        await reviewModel.findByIdAndDelete(reviewId);

        
        await updateBusinessRatingStats(businessType, businessId);

        return sendSuccess(res, "Review permanently deleted by admin");

    } catch (error) {
        log.error("deleteReview Error: " + error.message);
        return sendError(res, "Internal server error", error);
    }
};

export const getBusinessReviews = async (req, res) => {
    try {
        const { businessId } = req.params;
        const { page = 1, limit = 10, rating, businessType } = req.query;

        if (!mongoose.Types.ObjectId.isValid(businessId)) {
            return sendBadRequest(res, "Invalid business ID");
        }

        const query = { businessId, isActive: true };
        if (rating) query.rating = Number(rating);
        if (businessType) query.businessType = businessType;

        const reviews = await reviewModel
            .find(query)
            .populate("userId", "name avatar profilePicture")
            .sort({ createdAt: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit))
            .lean();

        const total = await reviewModel.countDocuments(query);

        
        const stats = await reviewModel.aggregate([
            { $match: { businessId: new mongoose.Types.ObjectId(businessId), isActive: true } },
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

        const average = totalCount > 0 ? (sumRating / totalCount).toFixed(1) : 0;

        const formattedReviews = formatReviewsResponse(reviews, req.user?._id);

        return sendSuccess(res, "Reviews fetched successfully", {
            summary: {
                average: Number(average),
                totalReviews: totalCount,
                distribution
            },
            reviews: formattedReviews,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        log.error("getBusinessReviews Error: " + error.message);
        return sendError(res, "Internal server error", error);
    }
};

export const likeReview = async (req, res) => {
    try {
        const userId = req.user?._id;
        const { reviewId } = req.params;

        const review = await reviewModel.findById(reviewId);
        if (!review) return sendNotFound(res, "Review not found");

        
        review.dislikes = review.dislikes.filter(id => id.toString() !== userId.toString());

        const alreadyLiked = review.likes.some(id => id.toString() === userId.toString());
        if (alreadyLiked) {
            review.likes = review.likes.filter(id => id.toString() !== userId.toString());
        } else {
            review.likes.push(userId);
        }

        await review.save();
        return sendSuccess(res, alreadyLiked ? "Like removed" : "Review liked", {
            likes: review.likes.length,
            dislikes: review.dislikes.length
        });

    } catch (error) {
        return sendError(res, "Internal server error", error);
    }
};

export const dislikeReview = async (req, res) => {
    try {
        const userId = req.user?._id;
        const { reviewId } = req.params;

        const review = await reviewModel.findById(reviewId);
        if (!review) return sendNotFound(res, "Review not found");

        
        review.likes = review.likes.filter(id => id.toString() !== userId.toString());

        const alreadyDisliked = review.dislikes.some(id => id.toString() === userId.toString());
        if (alreadyDisliked) {
            review.dislikes = review.dislikes.filter(id => id.toString() !== userId.toString());
        } else {
            review.dislikes.push(userId);
        }

        await review.save();
        return sendSuccess(res, alreadyDisliked ? "Dislike removed" : "Review disliked", {
            likes: review.likes.length,
            dislikes: review.dislikes.length
        });

    } catch (error) {
        return sendError(res, "Internal server error", error);
    }
};

export const getUserReviews = async (req, res) => {
    try {
        const userId = req.user?._id;
        const { page = 1, limit = 10 } = req.query;

        const reviews = await reviewModel
            .find({ userId, isActive: true })
            .populate("userId", "name avatar profilePicture")
            .populate("businessId", "name images address")
            .sort({ createdAt: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit))
            .lean();

        const total = await reviewModel.countDocuments({ userId, isActive: true });

        const formattedReviews = formatReviewsResponse(reviews, req.user?._id);

        return sendSuccess(res, "User reviews fetched successfully", {
            reviews: formattedReviews,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        return sendError(res, "Internal server error", error);
    }
};

export const getAllReviews = async (req, res) => {
    try {
        const { page = 1, limit = 20, businessType, rating } = req.query;

        const filter = { isActive: true };
        if (businessType) filter.businessType = businessType;
        if (rating) filter.rating = parseInt(rating);

        const reviews = await reviewModel
            .find(filter)
            .populate("userId", "name email avatar profilePicture")
            .populate("businessId", "name images")
            .sort({ createdAt: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit))
            .lean();

        const total = await reviewModel.countDocuments(filter);

        const formattedReviews = formatReviewsResponse(reviews, req.user?._id);

        return sendSuccess(res, "All reviews fetched successfully", {
            reviews: formattedReviews,
            total,
            pages: Math.ceil(total / limit)
        });
    } catch (error) {
        return sendError(res, "Internal server error", error);
    }
};