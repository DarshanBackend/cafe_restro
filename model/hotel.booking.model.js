import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const hotelBookingSchema = new mongoose.Schema(
  {
    bookingId: {
      type: String,
      unique: true,
      required: true,
      trim: true,
      default: () => uuidv4(),
    },

    bookingStatus: {
      type: String,
      enum: ["pending", "upcoming", "completed", "cancelled", "refunded"],
      default: "pending",
    },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", required: true },
    guest: {
      isMySelf: { type: Boolean, default: true },
      name: { type: String, default: "" },
      email: { type: String, default: "" },
      phone: { type: String, default: "" },
      address: { type: String, default: "" },
      state: { type: String, default: "" },
      country: { type: String, default: "" },
    },
    userId: {
      type: mongoose.Types.ObjectId,
      ref: "User",
      default: null
    },
    hotelId: { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true },
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: "Hotel", required: true },

    bookingDates: {
      checkInDate: { type: Date, required: true },
      checkOutDate: { type: Date, required: true },
      numberOfNights: { type: Number, default: 1 },
    },

    guestInfo: {
      adults: { type: Number, required: true, min: 1 },
      children: { type: Number, default: 0, min: 0 },
      infants: { type: Number, default: 0, min: 0 },
      specialRequests: { type: String, maxlength: 300, default: "" },
    },

    pricing: {
      roomRatePerNight: { type: Number, required: true, min: 0 },
      totalRoomRate: { type: Number, default: 0 },
      actualPrice: { type: Number, default: 0 },
      discountPercentage: { type: Number, default: 10 },
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

    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// Virtual for duration
hotelBookingSchema.virtual("duration").get(function () {
  const checkIn = new Date(this.bookingDates.checkInDate);
  const checkOut = new Date(this.bookingDates.checkOutDate);
  return Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
});

// Pre-validation auto-calculation
// hotelBookingSchema.pre("validate", function (next) {
//   if (this.bookingDates.checkOutDate <= this.bookingDates.checkInDate) {
//     return next(new Error("Check-out date must be after check-in date"));
//   }

//   const nights = Math.ceil(
//     (new Date(this.bookingDates.checkOutDate) - new Date(this.bookingDates.checkInDate)) /
//     (1000 * 60 * 60 * 24)
//   );
//   this.bookingDates.numberOfNights = nights;

//   // Calculate pricing
//   this.pricing.totalRoomRate = this.pricing.roomRatePerNight * nights;
//   this.pricing.discountAmount =
//     (this.pricing.totalRoomRate * this.pricing.discountPercentage) / 100;
//   const subtotal = this.pricing.totalRoomRate - this.pricing.discountAmount;

//   this.pricing.taxAmount = (subtotal * this.pricing.taxPercentage) / 100;
//   this.pricing.serviceFeeAmount = (subtotal * this.pricing.serviceFeePercentage) / 100;
//   this.pricing.totalAmount =
//     subtotal + this.pricing.taxAmount + this.pricing.serviceFeeAmount;

//   next();
// });

const hotelBookingModel = mongoose.model("HotelBooking", hotelBookingSchema);
export default hotelBookingModel;
