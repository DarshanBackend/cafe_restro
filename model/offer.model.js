import mongoose from "mongoose";

const offerSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      default: "Get Up to",
    },
    discountText: {
      type: String,
      required: true,
    },
    subtitle: {
      type: String,
      required: true,
      default: "on your dining",
    },
    backgroundImage: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const offerModel = mongoose.model("Offer", offerSchema);

export default offerModel;
