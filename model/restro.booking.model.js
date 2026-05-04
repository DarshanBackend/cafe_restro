import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const restaurantBookingSchema = new mongoose.Schema(
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
      enum: ["pending", "Upcoming", "Confirmed", "Completed", "Cancelled", "Refunded", "No-Show"],
      default: "pending",
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

    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restro",
      required: true,
    },
  
    bookingDate: {
      type: Date,
    },

    checkInDate: {
      type: Date,
      required: true,
    },

    checkOutDate: {
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
      min: 1,
    },

    adults: {
      type: Number,
      default: 1,
    },

    children: {
      type: Number,
      default: 0,
    },

    infants: {
      type: Number,
      default: 0,
    },

    numberOfRooms: {
      type: Number,
      default: 1, 
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
      specialRequests: { type: String, maxlength: 500, default: "" },
      adults: { type: Number },
      children: { type: Number },
      infants: { type: Number }
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
        enum: ["pending", "confirmed", "cancelled", "completed", "failed", "refunded"],
        default: "pending",
      },
      paymentMethod: { type: String, default: "" },
      paymentDate: { type: Date },
    },
  },
  { timestamps: true }
);

// Pre-validate hook for calculations (Same as Cafe/Hotel)
restaurantBookingSchema.pre("validate", function (next) {
  const guests = (this.adults || 0) + (this.children || 0);
  const numGuests = this.numberOfGuests || guests || 1;
  const numRooms = this.numberOfRooms || 1;

  if (!this.pricing.totalGuestRate) {
    this.pricing.totalGuestRate = this.pricing.perGuestRate * numGuests * numRooms;
  }

  if (!this.pricing.actualPrice) {
    this.pricing.actualPrice = this.pricing.totalGuestRate;
  }

  if (!this.pricing.discountAmount && this.pricing.discountPercentage) {
    this.pricing.discountAmount = (this.pricing.actualPrice * this.pricing.discountPercentage) / 100;
  }

  if (!this.pricing.discountPrice) {
    this.pricing.discountPrice = this.pricing.actualPrice - (this.pricing.discountAmount || 0);
  }

  if (!this.pricing.taxesAndFeesAmount && this.pricing.taxesAndFeesPercentage) {
    this.pricing.taxesAndFeesAmount = (this.pricing.discountPrice * this.pricing.taxesAndFeesPercentage) / 100;
  }

  if (!this.pricing.totalAmount) {
    this.pricing.totalAmount = this.pricing.discountPrice + (this.pricing.taxesAndFeesAmount || 0);
  }

  next();
});

const restaurantBookingModel = mongoose.model("RestaurantBooking", restaurantBookingSchema);

export default restaurantBookingModel;