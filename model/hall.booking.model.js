import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const bookingSchema = new mongoose.Schema({
  bookingId: {
    type: String,
    unique: true,
    required: true,
    default: () => uuidv4(),
    trim: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  hallId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hall',
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
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
  totalDays: {
    type: Number,
    required: true,
    min: 1
  },
  peoples: {
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
    currency: { type: String, default: "INR" }
  },
  bookingStatus: {
    type: String,
    enum: ['pending', 'Upcoming', 'Confirmed', 'Cancelled', 'Completed', 'Refunded'],
    default: 'pending'
  },
  payment: {
    paymentStatus: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled', 'completed', 'refunded', 'failed'],
      default: 'pending'
    },
    paymentMethod: {
      type: String,
      default: ''
    },
    transactionId: {
      type: String,
      default: ''
    },
    paymentDate: {
      type: Date
    }
  }
}, {
  timestamps: true
});

bookingSchema.index({ userId: 1 });
bookingSchema.index({ adminId: 1 });
bookingSchema.index({ hallId: 1 });
bookingSchema.index({ bookingId: 1 });
bookingSchema.index({ startDate: 1, endDate: 1 });
bookingSchema.index({ bookingStatus: 1 });

const hallBookingModel = mongoose.model('HallBooking', bookingSchema);

export default hallBookingModel;
