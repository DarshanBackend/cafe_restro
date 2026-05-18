import mongoose from "mongoose";

const roomSchema = new mongoose.Schema({
  type: { type: String, required: true },
  actualPrice: { type: Number, required: true },
  discountPrice: { type: Number, required: true },
  maxGuests: { type: Number, required: true },
  amenities: [{
    name: { type: String },
    icon: { type: String }
  }],
  images: [{ type: String }],
});

const reviewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Types.ObjectId, ref: "User" },
    admin: { type: mongoose.Types.ObjectId, ref: "Admin" },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String },
  },
  { timestamps: true }
);

const hotelSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: String,
    adminId: {
      type: mongoose.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    address: {
      street: String,
      city: String,
      state: String,
      country: String,
      zipCode: String,
    },
    location: {
      lat: Number,
      lng: Number,
    },
    images: [{ type: String }],
    actualPrice: { type: Number, required: true },  
    discountPrice: { type: Number, required: true },
    amenities: [{
      name: { type: String },
      icon: { type: String }
    }],
    ourService: {
      connectVieCall: { type: String, default: null },
      connectVieMessage: { type: String, default: null },
      helpSupport: { type: String, default: null }
    },
    averageRating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("Hotel", hotelSchema);  
