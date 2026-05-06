import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const stayBookingSchema = new mongoose.Schema({
  bookingId: {
    type: String,
    unique: true,
    required: true,
    default: () => uuidv4(),
    trim: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
    required: true
  },
  stayId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Stay",
    required: true
  },
  // Booking date (single day – hourly stay)
  date: {
    type: Date,
    required: true
  },
  startTime: {
    type: String,
    required: true
  },
  endTime: {
    type: String,
    required: true
  },
  totalHours: {
    type: Number,
    required: true,
    min: 1
  },
  pricing: {
    basePrice: { type: Number, required: true, min: 0 },
    actualPrice: { type: Number, required: true, min: 0 },
    discountPercentage: { type: Number, default: 10, min: 0, max: 100 },
    discountAmount: { type: Number, default: 0, min: 0 },
    discountPrice: { type: Number, default: 0, min: 0 },
    taxesAndFeesPercentage: { type: Number, default: 23, min: 0 },
    taxesAndFeesAmount: { type: Number, default: 0, min: 0 },
    finalAmount: { type: Number, required: true, min: 0 },
    coupon: {
      couponCode: { type: String, default: null },
      couponDiscountPercentage: { type: Number, default: 0 },
      couponDiscount: { type: Number, default: 0 },
      amountAfterCoupon: { type: Number, default: 0 }
    },
    payableAmount: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "INR" }
  },
  bookingStatus: {
    type: String,
    enum: ["pending", "upcoming", "confirmed", "cancelled", "completed", "refunded"],
    default: "pending"
  },
  payment: {
    paymentStatus: {
      type: String,
      enum: ["pending", "confirmed", "cancelled", "completed", "refunded", "failed"],
      default: "pending"
    },
    paymentMethod: {
      type: String,
      default: ""
    },
    transactionId: {
      type: String,
      default: ""
    },
    paymentDate: {
      type: Date
    }
  }
}, { timestamps: true });

stayBookingSchema.index({ userId: 1 });
stayBookingSchema.index({ adminId: 1 });
stayBookingSchema.index({ stayId: 1 });
stayBookingSchema.index({ date: 1 });
stayBookingSchema.index({ bookingStatus: 1 });

const stayBookingModel = mongoose.model("StayBooking", stayBookingSchema);
export default stayBookingModel;