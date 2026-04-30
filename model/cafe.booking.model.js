import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const cafeBookingSchema = new mongoose.Schema(
  {
    bookingId: {
      type: String,
      unique: true,
      required: true,
      default: () => uuidv4(),
      trim: true,
    },

    bookingStatus: {
      type: String,
      enum: ["Upcoming", "Completed", "Cancelled", "Refunded"],
      default: "Upcoming",
    },

    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    cafeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Cafes",
      required: true,
    },

    bookingDate: {
      type: Date,
      required: true,
    },

    timeSlot: {
      type: String,
      required: true,
      trim: true,
    },

    numberOfGuests: {
      type: Number,
      required: true,
      min: 1,
    },

    guest: {
      isMySelf: { type: Boolean, default: true },
      name: { type: String, default: "" },
      email: { type: String, default: "" },
      phone: { type: String, default: "" },
      address: { type: String, default: "" },
      state: { type: String, default: "" },
      country: { type: String, default: "" },
    },

    guestInfo: {
      specialRequests: { type: String, maxlength: 300, default: "" },
    },

    pricing: {
      perGuestRate: { type: Number, required: true, min: 0 },
      totalGuestRate: { type: Number, default: 0 },
      actualPrice: { type: Number, default: 0 },
      discountPercentage: { type: Number, default: 10 },
      couponCode: { type: String, default: null },
      discountAmount: { type: Number, default: 0 },
      discountPrice: { type: Number, default: 0 },
      taxesAndFeesPercentage: { type: Number, default: 23 },
      taxesAndFeesAmount: { type: Number, default: 0 },
      totalAmount: { type: Number, default: 0 },
      currency: { type: String, default: "INR" },
    },

    payment: {
      transactionId: { type: String, default: "" },
      paymentStatus: {
        type: String,
        enum: ["pending", "confirmed", "cancelled", "completed", "refunded", "failed"],
        default: "pending",
      },
      paymentMethod: { type: String, default: "" },
      paymentDate: { type: Date },
    },
  },
  { timestamps: true }
);


cafeBookingSchema.pre("validate", function (next) {
  // Only auto-calculate if not already set
  if (!this.pricing.totalGuestRate) {
    this.pricing.totalGuestRate = this.pricing.perGuestRate * this.numberOfGuests;
  }

  if (!this.pricing.actualPrice) {
    this.pricing.actualPrice = this.pricing.totalGuestRate;
  }

  if (!this.pricing.discountAmount && this.pricing.discountPercentage) {
    this.pricing.discountAmount =
      (this.pricing.actualPrice * this.pricing.discountPercentage) / 100;
  }

  if (!this.pricing.discountPrice) {
    this.pricing.discountPrice = this.pricing.actualPrice - (this.pricing.discountAmount || 0);
  }

  if (!this.pricing.taxesAndFeesAmount && this.pricing.taxesAndFeesPercentage) {
    this.pricing.taxesAndFeesAmount = (this.pricing.discountPrice * this.pricing.taxesAndFeesPercentage) / 100;
  }

  if (!this.pricing.totalAmount) {
    this.pricing.totalAmount =
      this.pricing.discountPrice + (this.pricing.taxesAndFeesAmount || 0);
  }

  next();
});


const cafeBookingModel = mongoose.model("CafeBooking", cafeBookingSchema);
export default cafeBookingModel;