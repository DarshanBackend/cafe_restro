import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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
  basePrice: {
    type: Number,
    required: true,
    min: 0
  },
  actualPrice: {
    type: Number,
    required: true,
    min: 0
  },
  discountPercentage: {
    type: Number,
    default: 10,
    min: 0,
    max: 100
  },
  discountAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  discountPrice: {
    type: Number,
    default: 0,
    min: 0
  },
  taxesAndFeesPercentage: {
    type: Number,
    default: 23,
    min: 0
  },
  taxesAndFeesAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  finalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'completed'],
    default: 'pending'
  },
  specialRequests: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Index for better query performance
bookingSchema.index({ userId: 1 });
bookingSchema.index({ hallId: 1 });
bookingSchema.index({ startDate: 1, endDate: 1 });
bookingSchema.index({ status: 1 });

const hallBookingModel = mongoose.model('HallBooking', bookingSchema);

export default hallBookingModel;