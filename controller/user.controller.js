import userModel from "../model/user.model.js";
import log from "../utils/logger.js"
import { sendBadRequest, sendError, sendNotFound, sendSuccess } from "../utils/responseUtils.js";
import jwt from 'jsonwebtoken';
import bcrypt from "bcryptjs";
import transporter from "../utils/Email.config.js";
import { uploadToS3, deleteFromS3 } from "../middleware/uploadS3.js";

export const sendOtpEmail = async (email, name, otp) => {
  // Let errors propagate so callers can handle failures appropriately
  const info = await transporter.sendMail({
    from: `"Cafe & Restro" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Your Password Reset OTP",
    template: "otpEmail",
    context: {
      name,
      otp,
    },
  });
  log.success("OTP email sent successfully");
  return info;
};

export const newUserRegister = async (req, res) => {
  try {
    const { name, email, password, deviceName, ipAddress } = req.body;

    if (!name || !email || !password) {
      return sendBadRequest(res, "name, email, password are required");
    }

    let user = await userModel.findOne({ email });

    if (user) {
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return sendBadRequest(res, "Incorrect password");

      const existingSession = user.sessions.find(
        s => s.deviceName === deviceName && s.ipAddress === ipAddress
      );

      if (existingSession) {
        existingSession.status = "active";
        existingSession.lastUsedAt = new Date();
      } else {
        user.sessions.push({
          deviceName: deviceName || "Unknown Device",
          ipAddress: ipAddress || req.ip,
          status: "active",
          loginAt: new Date(),
          lastUsedAt: new Date(),
        });
      }

      await user.save();

      const payload = {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      };
      const token = jwt.sign(payload, process.env.JWT_SECET, { expiresIn: "30d" });

      log.success(`${user.name} Login Successful`);
      return sendSuccess(res, { user, token }, "Login Successful");
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;

    const newUser = new userModel({
      name,
      email,
      password: hashedPassword,
      avatar,
      sessions: [
        {
          deviceName: deviceName || "Unknown Device",
          ipAddress: ipAddress || req.ip,
          status: "active",
          loginAt: new Date(),
          lastUsedAt: new Date(),
        },
      ],
    });

    await newUser.save();

    const payload = {
      _id: newUser._id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
    };
    const token = jwt.sign(payload, process.env.JWT_SECET, { expiresIn: "30d" });

    return sendSuccess(res, { user: newUser, token }, "User created successfully");
  } catch (error) {
    log.error(`Error During Create A New User: ${error.message}`);
    return sendError(res, error, `Error During Create A New User: ${error.message}`);
  }
};


export const getAllUsers = async (req, res) => {
  try {
    const { name, email, gender, maritalStatus, city, state, role } = req.query;

    const filter = {};

    if (name) filter.name = { $regex: name, $options: "i" };
    if (email) filter.email = { $regex: email, $options: "i" };
    if (gender) filter.gender = gender;
    if (maritalStatus) filter.maritalStatus = maritalStatus;
    if (city) filter.city = { $regex: city, $options: "i" };
    if (state) filter.state = { $regex: state, $options: "i" };
    if (role) filter.role = role;

    const users = await userModel.find(filter).select("-password -otp -otpExpires");

    return sendSuccess(res, users, "Users fetched successfully");
  } catch (error) {
    return sendError(res, error, `Error fetching users: ${error.message}`);
  }
};

export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await userModel.findById(id).select("-password -otp -otpExpires");
    if (!user) return sendNotFound(res, "User not found");

    return sendSuccess(res, user, "User fetched successfully");
  } catch (error) {
    return sendError(res, error, `Error fetching user: ${error.message}`);
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Prevent updating sensitive fields directly
    delete updates.password;
    delete updates.email;
    delete updates.otp;
    delete updates.otpExpires;
    
    if (updates.gender) updates.gender = String(updates.gender).toLowerCase();
    if (updates.maritalStatus) updates.maritalStatus = String(updates.maritalStatus).toLowerCase();

    const user = await userModel.findById(id);
    if (!user) return sendNotFound(res, "User not found");

    if (req.file) {
      // Upload new avatar to S3
      updates.avatar = await uploadToS3(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        "users"
      );
      
      // Delete old avatar from S3 if it exists and is an S3 url
      if (user.avatar && user.avatar.includes(".amazonaws.com/")) {
        try {
          const key = user.avatar.split(".amazonaws.com/")[1];
          if (key) await deleteFromS3(key);
        } catch (err) {
          log.error("Failed to delete old avatar from S3:", err.message);
        }
      }
    }

    const updatedUser = await userModel.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    }).select("-password -otp -otpExpires");

    return sendSuccess(res, updatedUser, "User updated successfully");
  } catch (error) {
    return sendError(res, error, `Error updating user: ${error.message}`);
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedUser = await userModel.findByIdAndDelete(id);
    if (!deletedUser) return sendNotFound(res, "User not found");

    return sendSuccess(res, deletedUser, "User deleted successfully");
  } catch (error) {
    return sendError(res, error, `Error deleting user: ${error.message}`);
  }
};

export const googleLogin = async (req, res) => {
  try {
    const { email, name, avatar, uid, deviceName, ipAddress } = req.body;

    if (!email || !name) {
      return sendBadRequest(res, "Name and email are required");
    }

    let query = { email };
    if (uid) {
      query = { $or: [{ uid: uid }, { email: email }] };
    }

    let user = await userModel.findOne(query);
    let isNew = false;

    if (user) {
      // Update uid or avatar if they are missing
      if (uid && !user.uid) user.uid = uid;
      if (avatar && !user.avatar) user.avatar = avatar;

      const existingSession = user.sessions.find(
        s => s.deviceName === deviceName && s.ipAddress === ipAddress
      );

      if (existingSession) {
        existingSession.status = "active";
        existingSession.lastUsedAt = new Date();
      } else {
        user.sessions.push({
          deviceName: deviceName || "Unknown Device",
          ipAddress: ipAddress || req.ip,
          status: "active",
          loginAt: new Date(),
          lastUsedAt: new Date(),
        });
      }

      await user.save();
      log.success(`${user.name} login successful`);
    } else {
      user = new userModel({
        name,
        email,
        uid: uid || null,
        avatar: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
        password: "SOCIAL_LOGIN",
        sessions: [
          {
            deviceName: deviceName || "Unknown Device",
            ipAddress: ipAddress || req.ip,
            status: "active",
            loginAt: new Date(),
            lastUsedAt: new Date(),
          },
        ],
      });

      await user.save();
      log.success(`${user.name} account created`);
      isNew = true;
    }

    const payload = {
      _id: user._id,
      name: user.name,
      email: user.email,
      uid: user.uid,
      role: user.role,
    };
    const token = jwt.sign(payload, process.env.JWT_SECET, { expiresIn: "30d" });

    return sendSuccess(
      res,
      { user, token },
      isNew
        ? "New User Registered Successfully With Google Login"
        : "Google Registered User Login Successful"
    );
  } catch (error) {
    log.error(`Login/Register error: ${error.message}`);
    return sendError(res, error, `Login/Register error: ${error.message}`);
  }
};

export const userLogin = async (req, res) => {
  try {
    const { email, password, deviceName, ipAddress } = req.body;

    if (!email || !password) {
      return sendBadRequest(res, "Email and password are required");
    }

    const user = await userModel.findOne({ email }).select("+password");
    if (!user) {
      return sendBadRequest(res, "User not found, please register");
    }
    console.log({
      inputPassword: password,
      storedPassword: user.password,
      type: typeof password
    });

    const isMatch = await bcrypt.compare(String(password), user.password);

    if (!isMatch) {
      return sendBadRequest(res, "Incorrect password");
    }

    const existingSession = user.sessions.find(
      s => s.deviceName === deviceName && s.ipAddress === ipAddress
    );

    if (existingSession) {
      existingSession.status = "active";
      existingSession.lastUsedAt = new Date();
    } else {
      user.sessions.push({
        deviceName: deviceName || "Unknown Device",
        ipAddress: ipAddress || req.ip,
        status: "active",
        loginAt: new Date(),
        lastUsedAt: new Date(),
      });
    }

    await user.save();

    const payload = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role
    };

    const token = jwt.sign(payload, process.env.JWT_SECET, { expiresIn: "30d" });

    log.success(`${user.name} Login Successful`);

    return sendSuccess(res, { user, token }, "Login Successful");
  } catch (error) {
    log.error(`Error During Login: ${error.message}`);
    return sendError(res, error, `Error During Login: ${error.message}`);
  }
};

export const ForgotOtpSend = async (req, res) => {
  try {
    let { email } = req?.body;
    if (!email) {
      return sendBadRequest(res, "email is required");
    }
    email = String(email).trim().toLowerCase();

    const user = await userModel.findOne({ email: email });
    if (!user) {
      return sendNotFound(res, "User Not Found");
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);
    const otpExpires = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    try {
      await userModel.findOneAndUpdate({ email }, { otp, otpExpires }, { new: true });
      await sendOtpEmail(email, user.name, otp);
      return sendSuccess(res, `Forgot Otp Send Successfully : ${email}`);
    } catch (error) {
      log.error(`Transporter email send error ${error.message}`);
      return sendError(res, "Transporter Email Send Error", error);
    }

  } catch (error) {
    log.error(`Error While Send Forget OTP : ${error.message}`)
    return sendError(res, `Error While Send Forget OTP : ${error.message}`, error);
  }
}

export const VerifyOtp = async (req, res) => {
  try {
    const MASTER_OTP = process.env.MASTER_OTP || "1111";
    let { email, otp } = req?.body;
    if (!email || !otp) {
      return sendBadRequest(res, "Email and OTP are required");
    }
    email = String(email).trim().toLowerCase();
    otp = String(otp).trim();
    const user = await userModel.findOne({ email });
    if (!user) {
      return sendNotFound(res, "User Not Found");
    }
    const now = new Date();
    const isMaster = MASTER_OTP && otp === MASTER_OTP;
    const isExpired = user.otpExpires && now > new Date(user.otpExpires);

    if (!isMaster) {
      if (!user.otp || user.otp !== otp) {
        return sendBadRequest(res, "Invalid OTP");
      }
      if (isExpired) {
        return sendBadRequest(res, "OTP expired");
      }
    }

    await userModel.findOneAndUpdate({ email }, { otp: null, otpExpires: null }, { new: true });
    return sendSuccess(res, "OTP verified successfully");
  } catch (error) {
    log.error(`Error verifying OTP: ${error.message}`);
    return sendError(res, `Error verifying OTP: ${error.message}`, error);
  }
}

export const ResetPassword = async (req, res) => {
  try {
    const { email, password } = req?.body;
    if (!email || !password) {
      return sendBadRequest(res, "Email and password are required");
    }
    const user = await userModel.findOne({ email });
    if (!user) {
      return sendNotFound(res, "User Not Found");
    }
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    await userModel.findOneAndUpdate({ email }, { password: hashedPassword }, { new: true });
    return sendSuccess(res, "Password reset successfully");
  } catch (error) {
    log.error(`Error resetting password: ${error.message}`);
    return sendError(res, error, `Error resetting password: ${error.message}`);
  }
}

export const changeUserPassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const { _id } = req.user;

    // Validate input
    if (!oldPassword || !newPassword) {
      return sendBadRequest(res, "Both oldPassword and newPassword are required.");
    }

    // Find user
    const user = await userModel.findById(_id);
    if (!user) {
      return sendNotFound(res, "User not found.");
    }

    // Compare old password
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return sendBadRequest(res, "Old password is incorrect.");
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password and save
    user.password = hashedPassword;
    await user.save();

    return sendSuccess(res, null, "Password changed successfully.");
  } catch (error) {
    console.error("Error while changing password:", error.message);
    return sendError(res, "Error while changing password.", error.message);
  }
};

export const userLogout = async (req, res) => {
  try {
    const { deviceName, ipAddress } = req.body;
    const { _id } = req.user;

    const user = await userModel.findById(_id);
    if (!user) return sendNotFound(res, "User not found");

    user.sessions = user.sessions.filter(
      s => !(s.deviceName === deviceName && s.ipAddress === ipAddress)
    );

    await user.save();

    return sendSuccess(res, null, "Logout successful and session removed");
  } catch (error) {
    log.error(`Error During Logout: ${error.message}`);
    return sendError(res, error, `Error During Logout: ${error.message}`);
  }
};

//profile section controller
export const getUserProfile = async (req, res) => {
  try {
    const { _id } = req?.user;

    if (!_id) {
      return sendBadRequest(res, "User not authenticated");
    }

    // Fetch user data
    const user = await userModel.findById(_id).select("-password");

    if (!user) {
      return sendBadRequest(res, "User not found");
    }

    return sendSuccess(res, { user }, "User profile fetched successfully");
  } catch (error) {
    log.error(`Error fetching user profile: ${error.message}`);
    return sendError(res, error, `Error fetching user profile: ${error.message}`);
  }
};
