import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Types.ObjectId, ref: "User" },
    admin: { type: mongoose.Types.ObjectId, ref: "Admin" },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String },
  },
  { timestamps: true }
);

const CafeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Cafe name is required"],
    trim: true,
    maxlength: [100, "Name cannot exceed 100 characters"]
  },
  description: {
    type: String,
    maxlength: [1000, "Description cannot exceed 1000 characters"],
    default: ""
  },
  location: {
    address: {
      type: String,
      required: [true, "Address is required"],
      trim: true
    },
    city: {
      type: String,
      trim: true,
      required: [true, "City is required"]
    },
    state: {
      type: String,
      trim: true
    },
    country: {
      type: String,
      trim: true,
      default: "United States"
    },
    coordinates: {
      lat: {
        type: Number,
        min: -90,
        max: 90
      },
      lng: {
        type: Number,
        min: -180,
        max: 180
      }
    }
  },
  themeCategory: {
    image: {
      type: String,
      default: null,
      validate: {
        validator: function (v) {
          return v === null || /^https?:\/\/.+\..+/.test(v);
        },
        message: "Invalid image URL"
      }
    },
    name: {
      type: String,
      enum: ["Cazy", "Modern", "Rustic", "Vintage", "Industrial", "Minimalist"],
      default: null,
      required: true
    }
  },
  images: [{
    type: String,
    validate: {
      validator: function (v) {
        return /^https?:\/\/.+\..+/.test(v);
      },
      message: "Invalid image URL"
    }
  }],
  reviews: [reviewSchema],
  averageRating: { type: Number, default: 0 },
  popular: {
    type: Boolean,
    default: false
  },
  amenities: [{
    type: String,
    trim: true
  }],
  services: [{
    type: String,
    trim: true
  }],
  operatingHours: {
    monday: { open: String, close: String },
    tuesday: { open: String, close: String },
    wednesday: { open: String, close: String },
    thursday: { open: String, close: String },
    friday: { open: String, close: String },
    saturday: { open: String, close: String },
    sunday: { open: String, close: String }
  },
  contact: {
    phone: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, "Invalid email format"]
    },
    website: {
      type: String,
      trim: true
    }
  },
  pricing: {
    actualPrice: {
      type: Number,
      min: [0, "Price cannot be negative"]
    },
    discountPrice: {
      type: Number,
      min: [0, "Price cannot be negative"]
    },
    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
      enum: {
        values: ['USD','INR', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'],
        message: '{VALUE} is not a supported currency'
      }
    }
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'closed'],
    default: 'active'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for better query performance
CafeSchema.index({ "location.coordinates": "2dsphere" });
CafeSchema.index({ name: "text", description: "text" });
CafeSchema.index({ popular: -1, rating: -1 });
CafeSchema.index({ "location.city": 1 });
CafeSchema.index({ status: 1 });
CafeSchema.index({ createdBy: 1 });

// Update the updatedAt field before saving
CafeSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Static method to find cafes by location
CafeSchema.statics.findByLocation = function (city, country) {
  return this.find({
    'location.city': new RegExp(city, 'i'),
    'location.country': new RegExp(country, 'i'),
    status: 'active'
  });
};

// Static method to find popular cafes
CafeSchema.statics.findPopular = function (limit = 10) {
  return this.find({
    popular: true,
    status: 'active'
  })
    .sort({ rating: -1 })
    .limit(limit);
};

// Instance method to check if cafe is open
CafeSchema.methods.isOpenNow = function () {
  const now = new Date();
  const today = now.toLocaleString('en-us', { weekday: 'long' }).toLowerCase();
  const currentTime = now.toTimeString().slice(0, 5); // HH:MM format

  const hours = this.operatingHours[today];
  if (!hours || !hours.open || !hours.close) return false;

  return currentTime >= hours.open && currentTime <= hours.close;
};

const cafeModel = mongoose.model("Cafes", CafeSchema);
export default cafeModel;