import mongoose from "mongoose";
import hotelModel from "./hotel.model.js";
import cafeModel from "./cafe.model.js";
import restroModel from "./restro.model.js";
import eventModel from "./event.model.js";
import hallModel from "./hall.model.js";
import stayModel from "./stay.model.js";
import tourModel from "./tour.model.js";

// Business types configuration
const BUSINESS_TYPES = {
  HOTEL: { type: "Hotel", model: hotelModel },
  CAFE: { type: "Cafes", model: cafeModel },
  RESTRO: { type: "Restro", model: restroModel },
  EVENT: { type: "Event", model: eventModel },
  HALL: { type: "Hall", model: hallModel },
  STAY: { type: "Stay", model: stayModel },
  TOUR: { type: "Tour", model: tourModel }
};

const mediaSchema = new mongoose.Schema({
  url: { type: String, required: true },
  key: { type: String },
  type: { type: String, enum: ['image', 'video'], required: true },
  uploadDate: { type: Date, default: Date.now }
});

const reviewSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "businessType",
    },
    businessType: {
      type: String,
      required: true,
      enum: Object.values(BUSINESS_TYPES).map(config => config.type),
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: {
        validator: Number.isInteger,
        message: 'Rating must be an integer between 1-5'
      }
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: ""
    },
    media: [mediaSchema],
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    dislikes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual populate for user details
reviewSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Index for better query performance
reviewSchema.index({ businessId: 1, businessType: 1 });
// Unique index only for active reviews (Partial Index)
reviewSchema.index(
  { userId: 1, businessId: 1, businessType: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

// Static method to get business rating stats
reviewSchema.statics.getBusinessRatingStats = async function (businessId, businessType) {
  const result = await this.aggregate([
    {
      $match: {
        businessId: new mongoose.Types.ObjectId(businessId),
        businessType,
        isActive: true
      }
    },
    {
      $group: {
        _id: null,
        averageRating: { $avg: "$rating" },
        totalReviews: { $sum: 1 }
      }
    }
  ]);
  return {
    averageRating: result.length ? Math.round(result[0].averageRating * 10) / 10 : 0,
    totalReviews: result.length ? result[0].totalReviews : 0
  };
};

const reviewModel = mongoose.model("Review", reviewSchema);

export { BUSINESS_TYPES };
export default reviewModel;