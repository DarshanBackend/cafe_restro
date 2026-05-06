import mongoose from "mongoose";

const staySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Stay name is required"],
    trim: true
  },
  description: {
    type: String,
    default: ""
  },
  address: {
    type: String,
    required: [true, "Address is required"]
  },
  city: {
    type: String,
    required: [true, "City is required"]
  },
  capacity: {
    type: Number,
    required: [true, "Capacity is required"],
    min: 1
  },
  actualPrice: {
    type: Number,
    required: [true, "Actual price is required"],
    min: 0
  },
  discountPrice: {
    type: Number,
    default: 0,
    min: 0
  },
  // pricePerHour kept for backward-compat, mapped from actualPrice
  pricePerHour: {
    type: Number,
    min: 0,
    default: 0
  },

  amenities: [{
    type: String,
    trim: true
  }],
  images: [String],
  isActive: {
    type: Boolean,
    default: true
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  reviewCount: {
    type: Number,
    default: 0
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    required: true
  },
}, { timestamps: true });

staySchema.index({ city: 1 });
staySchema.index({ adminId: 1 });
staySchema.index({ isActive: 1 });

const stayModel = mongoose.model("Stay", staySchema);
export default stayModel;