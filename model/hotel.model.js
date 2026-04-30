import mongoose from "mongoose";

const roomSchema = new mongoose.Schema({
  type: { type: String, required: true },
  actualPrice: { type: Number, required: true },
  discountPrice: { type: Number, required: true },
  maxGuests: { type: Number, required: true },
  amenities: [{ type: String }],
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
    rooms: [roomSchema],
    amenities: [{ type: String }],
    priceRange: {
      min: Number,
      max: Number,
    },
    Rent: {
      type: Number,
      default: null
    },
    ourService: {
      connectVieCall: { type: String, default: null },
      connectVieMessage: { type: String, default: null },
      helpSupport: { type: String, default: null }
    },
    averageRating: { type: Number, default: 0 },
    reviews: [reviewSchema],
  },
  { timestamps: true }
);

export default mongoose.model("Hotel", hotelSchema);  
