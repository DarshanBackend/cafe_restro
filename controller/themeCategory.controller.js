import themeCategoryModel from "../model/themeCategory.model.js";
import { uploadToS3, resizeImage, deleteFromS3 } from "../middleware/uploadS3.js";
import { sendError, sendSuccess, sendNotFound, sendBadRequest } from "../utils/responseUtils.js";
import log from "../utils/logger.js";
import mongoose from "mongoose"; 


export const createThemeCategory = async (req, res) => {
    try {
        const { name, area } = req.body;

        if (!name?.trim() || !area?.trim()) {
            return sendBadRequest(res, "Name and area are required");
        }

        if (!req.file) {
            return sendBadRequest(res, "Theme category image is required");
        }

        const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
        if (!allowedMimeTypes.includes(req.file.mimetype)) {
            return sendBadRequest(res, "Invalid image type. Only JPEG, PNG, and WebP allowed.");
        }

        let imageUrl = null;
        try {
            const resizedBuffer = await resizeImage(req.file.buffer, {
                width: 800,
                height: 600,
                quality: 80,
            });

            imageUrl = await uploadToS3(
                resizedBuffer,
                req.file.originalname,
                req.file.mimetype,
                "cafes/themes"
            );
        } catch (err) {
            log.error("Image Processing/S3 Error: " + err.message);
            return sendError(res, "Failed to process or upload image", err);
        }

        const themeCategory = await themeCategoryModel.create({
            name: name.trim(),
            image: imageUrl,
            area: area.trim()
        });

        return sendSuccess(res, "Theme category created successfully", themeCategory);
    } catch (error) {
        log.error("Create Theme Category Error: " + error.message);
        return sendError(res, "Internal Server Error", error);
    }
}


export const getAllThemeCategories = async (req, res) => {
    try {
        const { area } = req.query;
        const filter = area ? { area: area.trim() } : {};
        const categories = await themeCategoryModel.find(filter).sort({ createdAt: -1 });
        return sendSuccess(res, "Theme categories fetched successfully", categories);
    } catch (error) {
        log.error("Get All Theme Categories Error: " + error.message);
        return sendError(res, "Internal Server Error", error);
    }
}


export const getThemeCategory = async (req, res) => {
    try {
        const { id } = req.params;

        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequest(res, "Invalid Theme Category ID format");
        }

        const themeCategory = await themeCategoryModel.findById(id);

        if (!themeCategory) {
            return sendNotFound(res, "Theme category not found");
        }

        return sendSuccess(res, "Theme category fetched successfully", themeCategory);
    } catch (error) {
        log.error("Get Theme Category Error: " + error.message);
        return sendError(res, "Internal Server Error", error);
    }
}


export const updateThemeCategory = async (req, res) => {
    try {
        const { id } = req.params;

        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequest(res, "Invalid Theme Category ID format");
        }

        const { name, area } = req.body;

        const existingCategory = await themeCategoryModel.findById(id);
        if (!existingCategory) {
            return sendNotFound(res, "Theme category not found");
        }

        let imageUrl = existingCategory.image;

        if (req.file) {
            const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
            if (!allowedMimeTypes.includes(req.file.mimetype)) {
                return sendBadRequest(res, "Invalid image type");
            }

            if (existingCategory.image) {
                const oldKey = existingCategory.image.split(".amazonaws.com/")[1];
                if (oldKey) await deleteFromS3(oldKey).catch(err => log.warn("S3 Delete Error: " + err.message));
            }

            const resizedBuffer = await resizeImage(req.file.buffer, {
                width: 800,
                height: 600,
                quality: 80,
            });

            imageUrl = await uploadToS3(resizedBuffer, req.file.originalname, req.file.mimetype, "cafes/themes");
        }

        const updatedCategory = await themeCategoryModel.findByIdAndUpdate(
            id,
            {
                name: name ? name.trim() : existingCategory.name,
                area: area ? area.trim() : existingCategory.area,
                image: imageUrl
            },
            { new: true, runValidators: true }
        );

        return sendSuccess(res, "Theme category updated successfully", updatedCategory);
    } catch (error) {
        log.error("Update Theme Category Error: " + error.message);
        return sendError(res, "Internal Server Error", error);
    }
}


export const deleteThemeCategory = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequest(res, "Invalid Theme Category ID format");
        }

        const themeCategory = await themeCategoryModel.findById(id);

        if (!themeCategory) {
            return sendNotFound(res, "Theme category not found");
        }

        if (themeCategory.image) {
            const key = themeCategory.image.split(".amazonaws.com/")[1];
            if (key) await deleteFromS3(key).catch(err => log.warn("S3 Delete Error: " + err.message));
        }

        await themeCategoryModel.findByIdAndDelete(id);
        return sendSuccess(res, "Theme category deleted successfully", themeCategory);
    } catch (error) {
        log.error("Delete Theme Category Error: " + error.message);
        return sendError(res, "Internal Server Error", error);
    }
}

export const getThemesByArea = async (req, res) => {
    try {
        const { area } = req.query;

        if (!area || !area.trim()) {
            return sendBadRequest(res, "Area is required (cafe or restaurant)");
        }

        const trimmedArea = area.trim().toLowerCase();

        if (!["cafe", "restaurant"].includes(trimmedArea)) {
            return sendBadRequest(res, "Invalid area. Must be 'cafe' or 'restaurant'");
        }

        const categories = await themeCategoryModel.find({ area: trimmedArea }).sort({ createdAt: -1 });
        
        return sendSuccess(res, `Theme categories for ${trimmedArea} fetched successfully`, categories);
    } catch (error) {
        log.error("Get Themes By Area Error: " + error.message);
        return sendError(res, "Internal Server Error", error);
    }
}