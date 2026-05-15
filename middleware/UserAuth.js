import jwt from "jsonwebtoken";
import { sendBadRequest, sendError } from "../utils/responseUtils.js";

export const UserAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    } else if (req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return sendBadRequest(res, "Authorization token missing");
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECET);

    // Attach user info to request
    req.user = {
      _id: decoded._id,
      name: decoded.name,
      email: decoded.email,
      role: decoded.role
    };

    next(); // proceed to the next middleware / route handler
  } catch (error) {
    return sendError(res, error, "Invalid or expired token");
  }
};

export const isSuperAdmin = (req, res, next) => {
  try {
    // Make sure user info exists
    if (!req.user) {
      return sendBadRequest(res, "User not authenticated");
    }

    // Check role
    if (req.user.role !== "superadmin") {
      return sendBadRequest(res, "Access denied: Superadmin only");
    }

    next(); // proceed if superadmin
  } catch (error) {
    return sendBadRequest(res, "Error checking user role");
  }
};
