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
      discountPercentage: { type: Number, default: 0 },
      couponCode: { type: String, default: null },
      discountAmount: { type: Number, default: 0 },
      taxPercentage: { type: Number, default: 18 },
      taxAmount: { type: Number, default: 0 },
      serviceFeePercentage: { type: Number, default: 5 },
      serviceFeeAmount: { type: Number, default: 0 },
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

  if (!this.pricing.discountAmount && this.pricing.discountPercentage) {
    this.pricing.discountAmount =
      (this.pricing.totalGuestRate * this.pricing.discountPercentage) / 100;
  }

  const subtotal = this.pricing.totalGuestRate - (this.pricing.discountAmount || 0);

  if (!this.pricing.taxAmount) {
    this.pricing.taxAmount = (subtotal * this.pricing.taxPercentage) / 100;
  }

  if (!this.pricing.serviceFeeAmount && this.pricing.serviceFeePercentage) {
    this.pricing.serviceFeeAmount = (subtotal * this.pricing.serviceFeePercentage) / 100;
  }

  if (!this.pricing.totalAmount) {
    this.pricing.totalAmount =
      subtotal +
      this.pricing.taxAmount +
      (this.pricing.serviceFeeAmount || 0);
  }

  next();
});


const cafeBookingModel = mongoose.model("CafeBooking", cafeBookingSchema);
export default cafeBookingModel;