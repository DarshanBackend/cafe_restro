import mongoose from 'mongoose';

const hallSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Hall name is required'],
    trim: true
  },
  description: {
    type: String,
    required: [true, 'Hall description is required']
  },
  actualPrice: {
    type: Number,
    required: [true, 'Actual price is required'],
    min: 0
  },
  discountPrice: {
    type: Number,
    required: [true, 'Discount price is required'],
    min: 0
  },
  location: {
    type: String,
    required: [true, 'Location is required']
  },
  address: {
    type: String,
    required: [true, 'Address is required']
  },
  type: {
    type: String,
    required: [true, 'Hall type is required'],
    enum: ['Banquet Hall', 'Conference Hall', 'Wedding Hall', 'Party Hall', 'Meeting Hall']
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: ['Premium', 'Standard', 'Economy', 'Luxury']
  },
  capacity: {
    type: Number,
    required: [true, 'Capacity is required'],
    min: 1
  },
  amenities: [{
    type: String,
    trim: true
  }],
  // FIXED: Proper images structure
  images: {
    featuredImage: {
      type: String,
      default: null
    },
    galleryImages: [{
      type: String,
      default: []
    }]
  },
  // FIXED: Use adminId (not adminid)
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  reviewCount: {
    type: Number,
    default: 0
  },
  isAvailable: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

const hallModel = mongoose.model('Hall', hallSchema);

export default hallModel