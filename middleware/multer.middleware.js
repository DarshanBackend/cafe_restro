import multer from "multer";
import { sendBadRequest } from "../utils/responseUtils.js";
import { uploadToS3, resizeImage } from "./uploadS3.js";
import sharp from "sharp";
import hotelModel from "../model/hotel.model.js";

const storage = multer.memoryStorage();

export const uploadFiles = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"), false);
    }
    cb(null, true);
  },
}).any();

export const processAndUploadImages = async (req, res, next) => {
  try {
    const name = req.body?.name;
    const hotelId = req.params?.hotelId;

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
    const roomImageGroups = {};

    req.files.forEach((file) => {
      if (file.fieldname === "hotelImages") {
        hotelImagesFiles.push(file);
      } else if (file.fieldname.startsWith("roomImages")) {
        const match = file.fieldname.match(/^roomImages[-_](\d+)$/);
        if (match) {
          const roomIndex = match[1];
          if (!roomImageGroups[roomIndex]) roomImageGroups[roomIndex] = [];
          roomImageGroups[roomIndex].push(file);
        }
      }
    });

    req.files.hotelImages = await Promise.all(
      hotelImagesFiles.map(async (file) => {
        const buffer = await resizeImage(file.buffer, { width: 1024, height: 768, quality: 80 });
        return await uploadToS3(buffer, file.originalname, file.mimetype, "hotels");
      })
    );

    req.files.roomImages = {};
    for (const [roomIndex, files] of Object.entries(roomImageGroups)) {
      req.files.roomImages[roomIndex] = await Promise.all(
        files.map(async (file) => {
          const buffer = await resizeImage(file.buffer, { width: 800, height: 600, quality: 80 });
          return await uploadToS3(buffer, file.originalname, file.mimetype, "rooms");
        })
      );
    }

    const amenityIconFiles = [];
    const amenityIconMap = {};

    req.files.forEach((file) => {
      if (file.fieldname === "amenityIcons") {
        amenityIconFiles.push(file);
      } else if (file.fieldname.startsWith("amenityIcons_") || file.fieldname.startsWith("amenityIcons-")) {
        const match = file.fieldname.match(/^amenityIcons[-_](\d+)$/);
        if (match) {
          amenityIconMap[match[1]] = file;
        } else {
          amenityIconFiles.push(file);
        }
      } else if (file.fieldname.match(/^amenities\[(\d+)\]$/)) {
        const match = file.fieldname.match(/^amenities\[(\d+)\]$/);
        amenityIconMap[match[1]] = file;
      }
    });

    req.files.amenityIconsMapped = {};

    for (const [index, file] of Object.entries(amenityIconMap)) {
      req.files.amenityIconsMapped[index] = await uploadToS3(file.buffer, file.originalname, file.mimetype, "amenities");
    }

    req.files.amenityIconsArray = await Promise.all(
      amenityIconFiles.map(async (file) => {
        return await uploadToS3(file.buffer, file.originalname, file.mimetype, "amenities");
      })
    );

    next();
  } catch (error) {
    console.error("S3 Upload Error:", error);
    return sendBadRequest(res, "Error uploading images to S3");
  }
};

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
