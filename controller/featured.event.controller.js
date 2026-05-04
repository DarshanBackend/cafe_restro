import mongoose from "mongoose";
import { deleteFromS3, uploadToS3 } from "../middleware/uploadS3.js";
import eventModel from "../model/event.model.js";
import adminModel from "../model/admin.model.js";
import log from "../utils/logger.js";
import { sendError, sendSuccess, sendBadRequest, sendNotFound } from "../utils/responseUtils.js";

export const addNewFeaturedEvent = async (req, res) => {
  try {
    const adminId = req.admin._id;
    const { eventName, categoryTitle, serviceType, addresss, typesOfEvent, rating, experienceYears, totalFollowers } = req.body;

    if (!eventName || !addresss) return sendBadRequest(res, "eventName and addresss are required");
    if (!req.files || !req.files.image) return sendBadRequest(res, "Image file is required");

    const imageFile = req.files.image[0];
    const imageUrl = await uploadToS3(imageFile.buffer, imageFile.originalname, imageFile.mimetype, "featured-events");

    let eventTypesArray = [];
    if (typesOfEvent) {
      eventTypesArray = typeof typesOfEvent === 'string' ? typesOfEvent.split(',').map(t => t.trim()) : typesOfEvent;
    }

    const newEvent = new eventModel({
      eventImage: imageUrl,
      eventName,
      categoryTitle,
      serviceType,
      adminId,
      addresss,
      typesOfEvent: eventTypesArray,
      rating: rating || 5,
      experienceYears: experienceYears || 10,
      totalFollowers: totalFollowers || "50k+",
      sectionType: 'Featured'
    });

    await newEvent.save();
    return sendSuccess(res, "Featured Event created successfully", newEvent, 201);
  } catch (error) {
    return sendError(res, "Error creating featured event", error);
  }
};

export const getAllFeaturedEvents = async (req, res) => {
  try {
    const events = await eventModel.find({ sectionType: 'Featured' }).sort({ createdAt: -1 });
    return sendSuccess(res, "Featured Events retrieved successfully", events);
  } catch (error) {
    return sendError(res, "Error retrieving featured events", error);
  }
};

export const getFeaturedEventById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequest(res, "Invalid Event ID");
    }

    const event = await eventModel.findOne({ _id: id, sectionType: 'Featured' });
    if (!event) return sendNotFound(res, "Featured Event not found");
    return sendSuccess(res, "Featured Event retrieved successfully", event);
  } catch (error) {
    return sendError(res, "Error retrieving featured event", error);
  }
};

export const updateFeaturedEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const adminId = req.admin._id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequest(res, "Invalid Event ID");
    }

    const event = await eventModel.findOne({ _id: id, sectionType: 'Featured', adminId });
    if (!event) return sendNotFound(res, "Featured Event not found or unauthorized");

    if (req.files && req.files.image) {
      if (event.eventImage) {
        const oldKey = event.eventImage.split(".amazonaws.com/")[1];
        await deleteFromS3(oldKey).catch(err => log.warn("S3 Delete Error:", err));
      }
      const imageFile = req.files.image[0];
      updateData.eventImage = await uploadToS3(imageFile.buffer, imageFile.originalname, imageFile.mimetype, "featured-events");
    }

    if (updateData.typesOfEvent && typeof updateData.typesOfEvent === "string") {
      updateData.typesOfEvent = updateData.typesOfEvent.split(",").map(t => t.trim());
    }

    const updatedEvent = await eventModel.findByIdAndUpdate(id, updateData, { new: true });
    return sendSuccess(res, "Featured Event updated successfully", updatedEvent);
  } catch (error) {
    return sendError(res, "Error updating featured event", error);
  }
};

export const deleteFeaturedEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.admin._id;

    const event = await eventModel.findOne({ _id: id, sectionType: 'Featured', adminId });
    if (!event) return sendNotFound(res, "Featured Event not found or unauthorized");

    if (event.eventImage) {
      const key = event.eventImage.split(".amazonaws.com/")[1];
      await deleteFromS3(key).catch(err => log.warn("S3 Delete Error:", err));
    }

    await eventModel.findByIdAndDelete(id);
    return sendSuccess(res, "Featured Event deleted successfully");
  } catch (error) {
    return sendError(res, "Error deleting featured event", error);
  }
};
