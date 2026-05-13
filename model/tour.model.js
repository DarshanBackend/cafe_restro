import mongoose from "mongoose";

const tourSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Types.ObjectId,
    ref: "Admin",
    required: true
  },
  tourImage: {
    type: String,
    default: null
  },
  tourName: {
    type: String,
    default: null
  },
  dayNight: {
    type: String,
    default: null
  },
  tourViews: {
    type: [String],
    default: []
  },
  ourServiceForTour: {
    type: [String],
    default: []
  },
  emiOption: { // Fixed typo from emiOPtion to emiOption
    type: String,
    default: null,
  },
  pricePerPerson: {
    type: Number,
    default: null
  },
  totalPrice: {
    type: Number,
    default: null
  },
  contactNo: { // Fixed typo from contatcNo to contactNo
    type: String,
    default: null
  },
  whatsAppNo: {
    type: String,
    default: null
  },
  bestOffer: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  averageRating: {
    type: Number,
    default: 0
  },
  reviewCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

const tourModel = mongoose.model("Tour", tourSchema);

export default tourModel;