import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Types.ObjectId, ref: "User" },
    admin: { type: mongoose.Types.ObjectId, ref: "Admin" },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String },
  },
  { timestamps: true }
);

const restaurantSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    address: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String },
    country: { type: String, default: "India" },
    lat: { type: Number },
    lng: { type: Number },
    
    contact: {
      phone: { type: String },
      email: { type: String },
      website: { type: String, default: "" }
    },
    themeCategoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ThemeCategory",
    },
    actualPrice: {
      type: Number,
      required: true,
    },
    discountPrice: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "INR",
    },
    operatingHours: {
      monday: { open: String, close: String },
      tuesday: { open: String, close: String },
      wednesday: { open: String, close: String },
      thursday: { open: String, close: String },
      friday: { open: String, close: String },
      saturday: { open: String, close: String },
      sunday: { open: String, close: String }
    },
    amenities: [{ type: String }],
    services: [{ type: String }],
    images: [{ type: String }],
    reviews: [reviewSchema],
    averageRating: { type: Number, default: 0 },

    popular: {
      type: Boolean,
      default: false,
    },
    isVerified: {
      type: Boolean,
      default: false
    },
    status: {
      type: String,
      enum: ["active", "inactive", "pending", "suspended"],
      default: "active",
    },
  },
  { timestamps: true }
);

const restroModel = mongoose.model("Restro", restaurantSchema);

export default restroModel;