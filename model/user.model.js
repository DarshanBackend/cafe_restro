import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    default: null
  },
  email: {
    type: String,
    default: null,
    unique: true
  },
  password: {
    type: String,
    default: null
  },
  avatar: {
    type: String,
    default: null
  },
  uid: {
    type: String,
    default: null
  },
  sessions: [
    {
      deviceName: {
        type: String,
        default: null,
      },
      ipAddress: {
        type: String,
        default: null,
      },
      status: {
        type: String,
        enum: ["active", "inactive"],
        default: "active",
      },
      loginAt: {
        type: Date,
        default: Date.now,
      },
      lastUsedAt: {
        type: Date,
        default: Date.now,
      }
    },
  ],
  DOB: {
    type: String,
    default: null
  },
  gender: {
    type: String,
    enum: ["male", "female"],
    default: null,
    lowercase: true,
  },
  maritalStatus: {
    type: String,
    enum: ["single", "married", "divorced", "widowed", "separated", "other"],
    default: null,
    lowercase: true,
  },
  city: {
    type: String,
    default: null
  },
  state: {
    type: String,
    default: null
  },
  nationality: {
    type: String,
    default: null
  },
  contactNo: {
    type: String,
    default: null
  },
  role: {
    type: String,
    enum: ["user", "superadmin"],
    default: "user"
  },
  otp: {
    type: String,
    default: null
  },
  otpExpires: {
    type: Date,
    default: null
  }
});

const userModel = mongoose.model("User", UserSchema);

export default userModel;