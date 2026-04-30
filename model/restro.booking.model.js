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
      enum: ["Confirmed", "Pending", "Upcoming", "Completed", "Cancelled", "Refunded", "No-Show"],
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

    restaurantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restro",
      required: true,
    },

    tableGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    tableId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    tableNumber: {
      type: String,
      required: true,
    },
  
    bookingDate: {
      type: Date,
      required: true,
    },
  
    timeSlot: {
      startTime: {
        type: String,
        required: true,
        trim: true,
      },
      endTime: {
        type: String,
        required: true,
        trim: true,
      },
      duration: {
        type: Number, // in minutes
        default: 60,
      },
    },

    numberOfGuests: {
      type: Number,
      required: true,
      min: 1,
      max: 20,
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
    },

    // Services from Figma design
    // services: {
    //   connectViaCall: { type: String, default: null },
    //   connectViaMessage: { type: String, default: null },
    //   helpSupport: { type: Boolean, String: null },
    // },

    billing: {
      baseAmount: { type: Number, required: true, min: 0 },
      actualPrice: { type: Number, default: 0 },
      discountPrice: { type: Number, default: 0 },
      discount: {
        percentage: { type: Number, default: 10, min: 0, max: 100 },
        amount: { type: Number, default: 0, min: 0 },
        description: { type: String, default: "10% Flat Discount" },
      },
      villaDiscount: { type: Number, default: 0 },
      taxesAndFeesPercentage: { type: Number, default: 23 },
      taxesAndFeesAmount: { type: Number, default: 0 },
      additionalCharges: [
        {
          description: String,
          amount: { type: Number, default: 0 },
        },
      ],
      totalAmount: { type: Number, default: 0 },
      currency: { type: String, default: "INR" },
    },

    payment: {
      transactionId: { type: String, default: "" },
      paymentStatus: {
        type: String,
        enum: ["pending", "cancelled", "completed", "failed", "refunded"],
        default: "pending",
      },
      paymentMethod: {
        type: String,
        enum: ["Cash", "Credit Card", "Debit Card", "UPI", "Digital Wallet", "APP"],
        default: "APP"
      },
      paymentDate: { type: Date },
      paidAmount: { type: Number, default: 0 },
    },

    // Booking timeline
    timeline: {
      bookedAt: { type: Date, default: Date.now },
      confirmedAt: { type: Date },
      checkedInAt: { type: Date },
      checkedOutAt: { type: Date },
      cancelledAt: { type: Date },
    },

    cancellation: {
      isCancelled: { type: Boolean, default: false },
      reason: { type: String, maxlength: 500, default: "" },
      refundAmount: { type: Number, default: 0 },
      refundStatus: {
        type: String,
        enum: ["pending", "processed", "failed"],
        default: "pending",
      },
    },

    notes: {
      type: String,
      maxlength: 1000,
      default: "",
    },
  },
  { timestamps: true }
);

// Virtuals for formatted data
restaurantBookingSchema.virtual("formattedDate").get(function () {
  return this.bookingDate.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
});

restaurantBookingSchema.virtual("formattedTime").get(function () {
  return this.timeSlot.startTime;
});

restaurantBookingSchema.virtual("totalDiscountAmount").get(function () {
  if (this.billing.discount.percentage > 0) {
    return (this.billing.baseAmount * this.billing.discount.percentage) / 100;
  }
  return this.billing.discount.amount + this.billing.villaDiscount;
});

restaurantBookingSchema.virtual("amountAfterDiscount").get(function () {
  return this.billing.baseAmount - this.totalDiscountAmount;
});

restaurantBookingSchema.virtual("finalAmount").get(function () {
  const amountAfterDiscount = this.amountAfterDiscount;
  const additionalCharges = this.billing.additionalCharges.reduce(
    (sum, charge) => sum + charge.amount,
    0
  );

  return amountAfterDiscount + (this.billing.taxesAndFeesAmount || 0) + additionalCharges;
});

// Pre-save middleware for calculations
restaurantBookingSchema.pre("save", function (next) {
  this.billing.actualPrice = this.billing.baseAmount;
  this.billing.discountPrice = this.amountAfterDiscount;

  this.billing.taxesAndFeesAmount = (this.amountAfterDiscount * (this.billing.taxesAndFeesPercentage || 23)) / 100;

  // Calculate total amount
  this.billing.totalAmount = this.finalAmount;

  // Update payment paidAmount if payment is completed
  if (this.payment.paymentStatus === "completed" && this.payment.paidAmount === 0) {
    this.payment.paidAmount = this.billing.totalAmount;
  }

  // Update timeline
  if (this.isModified("bookingStatus")) {
    const now = new Date();
    switch (this.bookingStatus) {
      case "Completed":
        this.timeline.confirmedAt = this.timeline.confirmedAt || now;
        break;
      case "Cancelled":
        this.timeline.cancelledAt = now;
        this.cancellation.isCancelled = true;
        break;
    }
  }

  next();
});

// Indexes for performance
restaurantBookingSchema.index({ restaurantId: 1 });
restaurantBookingSchema.index({ userId: 1 });
restaurantBookingSchema.index({ adminId: 1 });
restaurantBookingSchema.index({ bookingDate: 1 });
restaurantBookingSchema.index({ bookingStatus: 1 });
restaurantBookingSchema.index({ "timeSlot.startTime": 1 });
restaurantBookingSchema.index({ createdAt: 1 });

// Static methods
restaurantBookingSchema.statics.findByRestaurant = function (restaurantId, date = null) {
  const query = { restaurantId };
  if (date) {
    query.bookingDate = {
      $gte: new Date(date.setHours(0, 0, 0, 0)),
      $lt: new Date(date.setHours(23, 59, 59, 999)),
    };
  }
  return this.find(query).sort({ bookingDate: 1, "timeSlot.startTime": 1 });
};

restaurantBookingSchema.statics.findByUser = function (userId, status = null) {
  const query = { userId };
  if (status) {
    query.bookingStatus = status;
  }
  return this.find(query)
    .populate("restaurantId", "name address contact images")
    .sort({ bookingDate: -1 });
};

// Instance methods
restaurantBookingSchema.methods.calculateBill = function () {
  const calculations = {
    baseAmount: this.billing.baseAmount,
    actualPrice: this.billing.actualPrice,
    discountAmount: this.totalDiscountAmount,
    discountPrice: this.billing.discountPrice,
    taxesAndFeesPercentage: this.billing.taxesAndFeesPercentage,
    taxesAndFeesAmount: this.billing.taxesAndFeesAmount,
    additionalCharges: this.billing.additionalCharges.reduce((sum, charge) => sum + charge.amount, 0),
    totalAmount: this.finalAmount,
  };

  return calculations;
};

restaurantBookingSchema.methods.applyDiscount = function (percentage = null, amount = null, description = "") {
  if (percentage !== null) {
    this.billing.discount.percentage = percentage;
    this.billing.discount.amount = 0;
  } else if (amount !== null) {
    this.billing.discount.amount = amount;
    this.billing.discount.percentage = 0;
  }

  if (description) {
    this.billing.discount.description = description;
  }

  return this;
};

restaurantBookingSchema.methods.markAsCompleted = function () {
  this.bookingStatus = "Completed";
  this.timeline.checkedOutAt = new Date();
  return this;
};

restaurantBookingSchema.methods.cancelBooking = function (reason = "", refundAmount = 0) {
  this.bookingStatus = "Cancelled";
  this.cancellation.isCancelled = true;
  this.cancellation.reason = reason;
  this.cancellation.refundAmount = refundAmount;
  this.timeline.cancelledAt = new Date();

  if (this.payment.paymentStatus === "completed" && refundAmount > 0) {
    this.cancellation.refundStatus = "pending";
  }

  return this;
};

const restaurantBookingModel = mongoose.model("RestaurantBooking", restaurantBookingSchema);

export default restaurantBookingModel;