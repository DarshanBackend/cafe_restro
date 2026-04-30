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

const tableGroupSchema = new mongoose.Schema({
  capacity: {
    type: Number,
    required: true,
    min: 1,
    max: 20
  },
  totalTables: {
    type: Number,
    required: true,
    min: 1
  },
  tables: [
    {
      tableNumber: {
        type: String,
        required: true
      },
      isBooked: {
        type: Boolean,
        default: false
      },
      currentBooking: {
        bookingDate: {
          type: Date
        },
        timeSlot: {
          type: String
        },
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User"
        },
        numberOfGuests: {
          type: Number
        },
        specialRequests: {
          type: String,
          maxlength: 500
        },
        status: {
          type: String,
          enum: ["booked", "seated", "completed", "cancelled", "no-show"],
          default: "booked",
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      },
    },
  ],
});

const timeSlotSchema = new mongoose.Schema({
  startTime: {
    type: String,
    required: true,
    match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
  },
  endTime: {
    type: String,
    required: true,
    match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
  },
  maxCapacity: {
    type: Number,
    default: 0
  }
});

const restaurantSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    name: {
      type: String,
      required: [true, "Restaurant name is required"],
      trim: true,
      maxlength: [100, "Restaurant name cannot exceed 100 characters"],
    },
    description: {
      type: String,
      maxlength: [1000, "Description cannot exceed 1000 characters"],
      default: "",
    },
    address: {
      street: {
        type: String,
        required: [true, "Street address is required"],
        trim: true
      },
      city: {
        type: String,
        required: [true, "City is required"],
        trim: true
      },
      state: {
        type: String,
        required: [true, "State is required"],
        trim: true
      },
      country: {
        type: String,
        default: "India",
        trim: true
      },
      postalCode: {
        type: String,
        trim: true
      },
      lat: {
        type: Number,
        min: -90,
        max: 90
      },
      lng: {
        type: Number,
        min: -180,
        max: 180
      },
    },
    contact: {
      phone: {
        type: String,
        required: [true, "Phone number is required"],
        match: [/^[0-9]{10}$/, "Please enter a valid 10-digit phone number"]
      },
      email: {
        type: String,
        lowercase: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, "Please enter a valid email"]
      },
      website: {
        type: String,
        default: ""
      }
    },
    cuisineTypes: [
      {
        type: String,
        trim: true,
        maxlength: 50
      },
    ],
    actualPrice: {
      type: Number,
      required: [true, "Actual price is required"],
      min: [0, "Cost cannot be negative"],
    },
    discountPrice: {
      type: Number,
      required: [true, "Discount price is required"],
      min: [0, "Cost cannot be negative"],
    },
    currency: {
      type: String,
      default: "INR",
      enum: ["INR", "USD", "EUR", "GBP"]
    },
    operatingHours: {
      openingTime: {
        type: String,
        required: true,
        match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
      },
      closingTime: {
        type: String,
        required: true,
        match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
      },
      closedOn: [{
        type: String,
        enum: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
      }]
    },
    timeSlots: [timeSlotSchema],
    slotDuration: {
      type: Number,
      default: 60,
      min: 30,
      max: 120
    },
    amenities: [
      {
        type: String,
        trim: true,
        maxlength: 50
      },
    ],
    services: [
      {
        type: String,
        trim: true,
        enum: ["Dine-In", "Takeaway", "Delivery", "Catering", "Outdoor Seating"]
      },
    ],
    paymentMethods: [{
      type: String,
      enum: ["Cash", "Credit Card", "Debit Card", "UPI", "Digital Wallet"]
    }],
    images: {
      featured: {
        type: String,
        default: null
      },
      gallery: [{
        type: String
      }],
      menu: [{
        type: String
      }]
    },
    tableGroups: [tableGroupSchema],
    reviews: [reviewSchema],
    averageRating: { type: Number, default: 0 },
    socialMedia: {
      facebook: { type: String, default: "" },
      instagram: { type: String, default: "" },
      twitter: { type: String, default: "" }
    },
    isPopular: {
      type: Boolean,
      default: false,
    },
    isVerified: {
      type: Boolean,
      default: false
    },
    status: {
      type: String,
      enum: ["active", "inactive", "pending", "suspended"],
      default: "active",
    },
    lastBookingDate: {
      type: Date
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual for full address
restaurantSchema.virtual("address.full").get(function () {
  return `${this.address.street}, ${this.address.city}, ${this.address.state}, ${this.address.country}${this.address.postalCode ? ' - ' + this.address.postalCode : ''}`;
});


restaurantSchema.virtual("isOpen").get(function () {
  // 🕒 Safe defaults
  const now = new Date();
  const currentTime = now.getHours().toString().padStart(2, "0") + ":" + now.getMinutes().toString().padStart(2, "0");
  const currentDay = now.toLocaleString("en-us", { weekday: "long" }).toLowerCase();

  // 🧩 Guard clause: if no operating hours defined
  if (!this.operatingHours || !this.operatingHours.openingTime || !this.operatingHours.closingTime) {
    return false;
  }

  // 🧩 Guard clause: if closedOn is missing or not array
  const closedOn = Array.isArray(this.operatingHours.closedOn)
    ? this.operatingHours.closedOn
    : [];

  // 🧩 Check if today is closed
  if (closedOn.includes(currentDay)) {
    return false;
  }

  // 🧩 Compare current time with open/close times
  return (
    currentTime >= this.operatingHours.openingTime &&
    currentTime <= this.operatingHours.closingTime
  );
});


// Indexes for performance
restaurantSchema.index({ "address.city": 1 });
restaurantSchema.index({ "address.lat": 1, "address.lng": 1 });
restaurantSchema.index({ cuisineTypes: 1 });
restaurantSchema.index({ "tableGroups.capacity": 1 });
restaurantSchema.index({ "rating.average": -1 });
restaurantSchema.index({ status: 1 });
restaurantSchema.index({ ownerId: 1 });

// Methods
restaurantSchema.methods.findAvailableTables = function (capacity, date, timeSlot) {
  const targetDate = new Date(date).toDateString();

  return this.tableGroups.filter(group =>
    group.capacity >= capacity
  ).map(group => ({
    capacity: group.capacity,
    availableTables: group.tables.filter(table =>
      !table.isBooked ||
      (table.currentBooking &&
        table.currentBooking.bookingDate.toDateString() !== targetDate &&
        table.currentBooking.timeSlot !== timeSlot)
    ).length
  })).filter(group => group.availableTables > 0);
};

restaurantSchema.methods.getAvailableTimeSlots = function (date, partySize) {
  const availableSlots = [];

  this.timeSlots.forEach(slot => {
    const totalCapacity = this.tableGroups
      .filter(group => group.capacity >= partySize)
      .reduce((sum, group) => sum + group.tables.length, 0);

    if (totalCapacity >= 1) {
      availableSlots.push({
        startTime: slot.startTime,
        endTime: slot.endTime,
        availableTables: totalCapacity
      });
    }
  });

  return availableSlots;
};

restaurantSchema.methods.updateRating = function (newRating) {
  const oldTotal = this.rating.average * this.rating.totalReviews;
  this.rating.totalReviews += 1;
  this.rating.average = (oldTotal + newRating) / this.rating.totalReviews;

  // Update rating breakdown
  const ratingKey = `${newRating}Star`;
  if (this.rating.breakdown[ratingKey] !== undefined) {
    this.rating.breakdown[ratingKey] += 1;
  }
};

// Static methods
restaurantSchema.statics.findByLocation = function (lat, lng, maxDistance = 5000) {
  return this.find({
    "address.lat": { $exists: true },
    "address.lng": { $exists: true },
    status: "active"
  }).where("location").near({
    center: [lng, lat],
    maxDistance: maxDistance / 6371, // Convert meters to radians
    spherical: true
  });
};

restaurantSchema.statics.findByCuisine = function (cuisine, city = null) {
  const query = {
    cuisineTypes: { $in: [new RegExp(cuisine, 'i')] },
    status: "active"
  };

  if (city) {
    query["address.city"] = new RegExp(city, 'i');
  }

  return this.find(query);
};

// Pre-save middleware to generate time slots if not provided
restaurantSchema.pre('save', function (next) {
  if (this.timeSlots.length === 0 && this.operatingHours.openingTime && this.operatingHours.closingTime) {
    this.generateTimeSlots();
  }
  next();
});

// Method to generate time slots
restaurantSchema.methods.generateTimeSlots = function () {
  const slots = [];
  const start = parseInt(this.operatingHours.openingTime.split(':')[0]);
  const end = parseInt(this.operatingHours.closingTime.split(':')[0]);
  const duration = this.slotDuration;

  for (let hour = start; hour < end; hour += duration / 60) {
    const startHour = Math.floor(hour);
    const startMinute = (hour % 1) * 60;
    const endHour = Math.floor(hour + duration / 60);
    const endMinute = ((hour + duration / 60) % 1) * 60;

    slots.push({
      startTime: `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`,
      endTime: `${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`,
      maxCapacity: this.calculateMaxCapacity()
    });
  }

  this.timeSlots = slots;
};

restaurantSchema.methods.calculateMaxCapacity = function () {
  return this.tableGroups.reduce((total, group) => {
    return total + (group.capacity * group.tables.length);
  }, 0);
};

const restroModel = mongoose.model("Restro", restaurantSchema);

export default restroModel;