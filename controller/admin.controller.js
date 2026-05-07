import log from '../utils/logger.js'
import { sendBadRequest, sendError, sendNotFound, sendSuccess } from "../utils/responseUtils.js";
import adminModel from "../model/admin.model.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from 'dotenv'
config();

const JWT_SECRET = process.env.JWT_SECET;

export const newAdminRegister = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return sendBadRequest(res, "name, email & password are required to register admin");
    }

    const existingAdmin = await adminModel.findOne({ email });

    if (existingAdmin) {
      const isMatch = await bcrypt.compare(password, existingAdmin.password);

      if (!isMatch) {
        return sendBadRequest(res, "Invalid password");
      }

      const payload = {
        _id: existingAdmin._id,
        name: existingAdmin.name,
        email: existingAdmin.email,
        role: "superadmin"
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });

      return sendSuccess(res, "Admin Login Successful", {
        admin: {
          _id: existingAdmin._id,
          name: existingAdmin.name,
          email: existingAdmin.email,
        },
        token,
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newAdmin = await adminModel.create({
      name,
      email,
      password: hashedPassword,
    });

    const payload = {
      _id: newAdmin._id,
      name: newAdmin.name,
      email: newAdmin.email,
      role: "superadmin"
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });

    return sendSuccess(res, "New Admin Registered Successfully", {
      admin: {
        _id: newAdmin._id,
        name: newAdmin.name,
        email: newAdmin.email,
      },
      token,
    });

  } catch (error) {
    log.error(`Error during new admin register: ${error.message}`);
    return sendError(res, "Error during admin registration", error);
  }
};

export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendBadRequest(res, "Email and password are required");
    }

    const admin = await adminModel.findOne({ email });
    if (!admin) {
      return sendBadRequest(res, "Admin not found with this email");
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return sendBadRequest(res, "Invalid password");
    }

    const payload = {
      _id: admin._id,
      name: admin.name,
      email: admin.email,
      role: "superadmin"
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });

    return sendSuccess(res, "Admin login successful", {
      admin: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
      },
      token,
    });
  } catch (error) {
    log.error(`Error during admin login: ${error.message}`);
    return sendError(res, "Error during admin login", error);
  }
};

export const getAllAdmins = async (req, res) => {
  try {
    const admins = await adminModel.find().select("-password");

    if (!admins || admins.length === 0) {
      return sendNotFound(res, "No admins found");
    }

    return sendSuccess(res, "All admins fetched successfully", {
      total: admins.length,
      admins,
    });
  } catch (error) {
    log.error(`Error fetching all admins: ${error.message}`);
    return sendError(res, "Error fetching all admins", error);
  }
};


export const getAdminById = async (req, res) => {
  try {
    const { adminId } = req.params;

    if (!adminId) {
      return sendBadRequest(res, "Admin ID is required");
    }

    const admin = await adminModel.findById(adminId).select("-password");

    if (!admin) {
      return sendNotFound(res, "Admin not found");
    }

    return sendSuccess(res, "Admin fetched successfully", { admin });
  } catch (error) {
    log.error(`Error fetching admin by ID: ${error.message}`);
    return sendError(res, "Error fetching admin by ID", error);
  }
};

export const adminUpdate = async (req, res) => {
  try {
    const { adminId } = req.params;
    const { name, email, password } = req.body;

    if (!adminId) {
      return sendBadRequest(res, "Admin ID is required");
    }

    const admin = await adminModel.findById(adminId);
    if (!admin) {
      return sendNotFound(res, "Admin not found");
    }

    if (name) admin.name = name;
    if (email) admin.email = email;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      admin.password = await bcrypt.hash(password, salt);
    }

    await admin.save();

    return sendSuccess(res, "Admin updated successfully", {
      admin: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
      },
    });
  } catch (error) {
    log.error(`Error updating admin: ${error.message}`);
    return sendError(res, "Error updating admin", error);
  }
};

export const deleteAdmin = async (req, res) => {
  try {
    const { adminId } = req.params;

    if (!adminId) {
      return sendBadRequest(res, "Admin ID is required");
    }

    const deleted = await adminModel.findByIdAndDelete(adminId);
    if (!deleted) {
      return sendNotFound(res, "Admin not found or already deleted");
    }

    return sendSuccess(res, "Admin deleted successfully");
  } catch (error) {
    log.error(`Error deleting admin: ${error.message}`);
    return sendError(res, "Error deleting admin", error);
  }
};
