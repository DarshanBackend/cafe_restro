import multer from "multer";
import { sendBadRequest } from "../utils/responseUtils.js";
import { uploadToS3, resizeImage } from "./uploadS3.js"; // your S3 helper
import sharp from "sharp";
import hotelModel from "../model/hotel.model.js";

// 1️⃣ Multer memory storage
const storage = multer.memoryStorage();

// 2️⃣ Multer setup
export const uploadFiles = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per file
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"), false);
    }
    cb(null, true);
  },
}).any();

// 3️⃣ Middleware to normalize & upload images to S3
// NOTE: Check for duplicate hotel BEFORE uploading to S3 to prevent orphaned images
export const processAndUploadImages = async (req, res, next) => {
  try {
    // Check for duplicate hotel BEFORE uploading images
    const name = req.body?.name;
    const hotelId = req.params?.hotelId; // For updates
    
    if (name) {
      const existingHotel = await hotelModel.findOne({ name: name.trim() });
      if (existingHotel) {
        if (!hotelId || existingHotel._id.toString() !== hotelId) {
          return sendBadRequest(res, "Hotel already exists");
        }
      }
    }

    if (!req.files || req.files.length === 0) return next();

    const hotelImagesFiles = [];
    const roomImageGroups = {}; // { "0": [file1, file2], "1": [file3] }

    // Separate hotelImages vs roomImages and group room images by index
    req.files.forEach((file) => {
      if (file.fieldname === "hotelImages") {
        hotelImagesFiles.push(file);
      } else if (file.fieldname.startsWith("roomImages")) {
        // Support both "roomImages_0" and "roomImages-0" naming
        const match = file.fieldname.match(/^roomImages[-_](\d+)$/);
        if (match) {
          const roomIndex = match[1];
          if (!roomImageGroups[roomIndex]) roomImageGroups[roomIndex] = [];
          roomImageGroups[roomIndex].push(file);
        }
      }
    });

    // 1️⃣ Upload hotel images to S3
    req.files.hotelImages = await Promise.all(
      hotelImagesFiles.map(async (file) => {
        const buffer = await resizeImage(file.buffer, { width: 1024, height: 768, quality: 80 });
        return await uploadToS3(buffer, file.originalname, file.mimetype, "hotels");
      })
    );

    // 2️⃣ Upload room images to S3 grouped by room index
    req.files.roomImages = {};
    for (const [roomIndex, files] of Object.entries(roomImageGroups)) {
      req.files.roomImages[roomIndex] = await Promise.all(
        files.map(async (file) => {
          const buffer = await resizeImage(file.buffer, { width: 800, height: 600, quality: 80 });
          return await uploadToS3(buffer, file.originalname, file.mimetype, "rooms");
        })
      );
    }

    next();
  } catch (error) {
    console.error("S3 Upload Error:", error);
    return sendBadRequest(res, "Error uploading images to S3");
  }
};

// 4️⃣ Handle multer errors
export const handleMulterErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") return sendBadRequest(res, "File size too large. Max 20MB per file");
    if (err.code === "LIMIT_UNEXPECTED_FILE") return sendBadRequest(res, "Too many files uploaded");
    return sendBadRequest(res, err.message);
  } else if (err) {
    return sendBadRequest(res, err.message);
  }
  next();
};
