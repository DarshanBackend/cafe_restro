import mongoose from "mongoose";
import { deleteFromS3, uploadToS3 } from "../middleware/uploadS3.js";
import eventModel from "../model/event.model.js";
import adminModel from "../model/admin.model.js";
import log from "../utils/logger.js";
import { sendError, sendSuccess, sendBadRequest } from "../utils/responseUtils.js";


export const addNewEvent = async (req, res) => {
  try {
    const adminId = req.admin._id;
    const {
      eventName,
      categoryTitle,
      serviceType,
      addresss,
      typesOfEvent,
      contactNo,
      whatsappNo,
      sectionType
    } = req.body;

    
    if (!eventName || !addresss) {
      return sendError(res, "eventName and addresss are required fields", 400);
    }

    
    if (!req.files || !req.files.eventImage || req.files.eventImage.length === 0) {
      return sendError(res, "eventImage file is required", 400);
    }

    const eventImageFile = req.files.eventImage[0];

    
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedMimeTypes.includes(eventImageFile.mimetype)) {
      return sendError(res, "Invalid file type. Only JPEG, JPG, PNG, GIF, and WebP images are allowed", 400);
    }

    
    const maxSize = 5 * 1024 * 1024;
    if (eventImageFile.size > maxSize) {
      return sendError(res, "File size too large. Maximum size is 5MB", 400);
    }

    let eventImageUrl;
    try {
      
      eventImageUrl = await uploadToS3(
        eventImageFile.buffer,
        eventImageFile.originalname,
        eventImageFile.mimetype,
        "events"
      );
      log.info(`Event image uploaded to S3: ${eventImageUrl}`);
    } catch (uploadError) {
      log.error(`S3 Upload failed: ${uploadError.message}`);
      return sendError(res, "Failed to upload event image", uploadError);
    }

    
    let eventTypesArray = [];
    if (typesOfEvent) {
      if (typeof typesOfEvent === 'string') {
        
        eventTypesArray = typesOfEvent.split(',').map(type => type.trim());
      } else if (Array.isArray(typesOfEvent)) {
        eventTypesArray = typesOfEvent;
      }
    }

    const newEvent = new eventModel({
      eventImage: eventImageUrl,
      eventName,
      categoryTitle,
      serviceType,
      adminId: adminId,
      addresss,
      typesOfEvent: eventTypesArray,
      contactNo,
      whatsappNo,
      sectionType: sectionType || 'Regular'
    });

    const savedEvent = await newEvent.save();

    
    if (savedEvent.adminId && savedEvent._id) {
      await adminModel.findByIdAndUpdate(
        savedEvent.adminId,
        { $addToSet: { events: savedEvent._id } },
        { new: true }
      ).catch(err => log.warn("Failed to update admin events:", err.message));
    }

    log.info(`Event created successfully: ${savedEvent._id} by admin: ${adminId}`);
    return sendSuccess(res, "Event created successfully", savedEvent, 201);
  } catch (error) {
    log.error(`Error While Creating a new Event: ${error.message}`);
    return sendError(res, "Error While Creating a new Event", error);
  }
};


export const getAllEvents = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = "createdAt",
      sortOrder = "desc",
      search,
      typesOfEvent
    } = req.query;

    const filter = { sectionType: 'Regular' };

    if (search) {
      filter.$or = [
        { eventName: { $regex: search, $options: "i" } },
        { addresss: { $regex: search, $options: "i" } }
      ];
    }

    if (typesOfEvent) {
      const types = typeof typesOfEvent === 'string'
        ? typesOfEvent.split(',').map(t => t.trim())
        : typesOfEvent;
      filter.typesOfEvent = { $in: types };
    }

    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [allEvents, totalCount] = await Promise.all([
      eventModel.find(filter)
        .select("-rating -experienceYears -totalFollowers")
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      eventModel.countDocuments(filter)
    ]);

    return sendSuccess(res, "Events retrieved successfully", allEvents);
  } catch (error) {
    log.error(`Error While Getting Events: ${error.message}`);
    return sendError(res, "Error While Getting Events", error);
  }
};

export const searchEvents = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim() === '') return sendBadRequest(res, "Search query 'q' is required");

    const events = await eventModel.find({
      $or: [
        { eventName: { $regex: q.trim(), $options: "i" } },
        { addresss: { $regex: q.trim(), $options: "i" } }
      ]
    })
    return sendSuccess(res, "Search results retrieved successfully", events);
  } catch (error) {
    log.error(`Error While Searching Events: ${error.message}`);
    return sendError(res, "Error While Searching Events", error);
  }
};

export const filterEvents = async (req, res) => {
  try {
    const {
      typesOfEvent,
      sortBy = "createdAt",
      sortOrder = "desc",
      page = 1,
      limit = 10
    } = req.query;

    const filter = { sectionType: 'Regular' };

    if (typesOfEvent) {
      const types = typeof typesOfEvent === 'string'
        ? typesOfEvent.split(',').map(t => t.trim())
        : typesOfEvent;
      filter.typesOfEvent = { $in: types };
    }

    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const events = await eventModel.find(filter)
      .select("-rating -experienceYears -totalFollowers")
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    return sendSuccess(res, "Filtered events retrieved successfully", events);
  } catch (error) {
    log.error(`Error While Filtering Events: ${error.message}`);
    return sendError(res, "Error While Filtering Events", error);
  }
};



export const getEventById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, "Invalid event ID", 400);
    }

    const event = await eventModel.findById(id);

    if (!event) {
      return sendError(res, "Event not found", 404);
    }

    log.info(`Event retrieved: ${id}`);
    return sendSuccess(res, "Event retrieved successfully", event);
  } catch (error) {
    log.error(`Error While Getting Event: ${error.message}`);
    return sendError(res, "Error While Getting Event", error);
  }
};


export const updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, "Invalid event ID", 400);
    }

    const adminId = req.admin?._id;
    if (!adminId) return sendError(res, "Admin ID not found", 400);

    
    const eventObjectId = new mongoose.Types.ObjectId(id);
    const adminObjectId = new mongoose.Types.ObjectId(adminId);

    log.info(`Updating event: ${eventObjectId} by admin: ${adminObjectId}`);

    
    const existingEvent = await eventModel.findOne({
      _id: eventObjectId,
    });

    if (!existingEvent) {
      return sendError(res, "Event not found or unauthorized", 404);
    }

    
    if (updateData.typesOfEvent && typeof updateData.typesOfEvent === "string") {
      updateData.typesOfEvent = updateData.typesOfEvent.split(",").map(t => t.trim()).filter(Boolean);
    }

    
    if (updateData.ourService && typeof updateData.ourService === "string") {
      updateData.ourService = JSON.parse(updateData.ourService);
    }

    
    if (req.files && (req.files.eventImage || req.files.image)) {
      const eventImageFile = (req.files.eventImage || req.files.image)[0];

      const allowedMimeTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
        "image/webp",
      ];
      const maxSize = 5 * 1024 * 1024;

      if (!allowedMimeTypes.includes(eventImageFile.mimetype)) {
        return sendError(
          res,
          "Invalid file type. Only JPEG, JPG, PNG, GIF, and WebP allowed",
          400
        );
      }

      if (eventImageFile.size > maxSize) {
        return sendError(res, "File too large. Max 5MB allowed", 400);
      }

      
      if (existingEvent.eventImage) {
        try {
          const key = existingEvent.eventImage.split(".amazonaws.com/")[1];
          await deleteFromS3(key);
          log.info(`Old event image deleted from S3: ${key}`);
        } catch (err) {
          log.warn(`Failed to delete old event image: ${err.message}`);
        }
      }

      
      const newImageUrl = await uploadToS3(
        eventImageFile.buffer,
        eventImageFile.originalname,
        eventImageFile.mimetype,
        "events"
      );
      updateData.eventImage = newImageUrl;
      log.info(`New event image uploaded: ${newImageUrl}`);
    }

    
    Object.keys(updateData).forEach((key) => {
      if (updateData[key] === undefined) delete updateData[key];
    });

    
    updateData.updatedAt = new Date();

    
    const updatedEvent = await eventModel.findOneAndUpdate(
      { _id: eventObjectId, adminId: adminObjectId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedEvent) {
      return sendError(res, "Event not found after update", 404);
    }

    log.info(`Event updated successfully: ${updatedEvent._id}`);
    return sendSuccess(res, "Event updated successfully", updatedEvent);
  } catch (error) {
    log.error(`Error while updating event: ${error.message}`);
    return sendError(res, "Error while updating event", error.message);
  }
};


export const deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendError(res, "Invalid event ID");
    }

    
    const event = await eventModel.findById(id);

    if (!event) {
      return sendError(res, "Event not found");
    }

    
    if (event.adminId) {
      await adminModel.findByIdAndUpdate(
        event.adminId,
        { $pull: { events: id } },
        { new: true }
      ).catch(err => log.warn("Failed to remove event from admin:", err.message));
    }

    if (event.eventImage) {
      try {
        const key = event.eventImage.split(".amazonaws.com/")[1];
        await deleteFromS3(key);
        log.info(`Event image deleted from S3: ${event.eventImage}`);
      } catch (deleteError) {
        log.warn(`Failed to delete event image from S3: ${deleteError.message}`);
      }
    }


    const deletedEvent = await eventModel.findByIdAndDelete(id);

    log.info(`Event deleted: ${id}`);
    return sendSuccess(res, "Event deleted successfully", deletedEvent);
  } catch (error) {
    log.error(`Error While Deleting Event: ${error.message}`);
    return sendError(res, "Error While Deleting Event", error);
  }
};


export const bulkDeleteEvents = async (req, res) => {
  try {
    const { eventIds } = req.body;

    if (!Array.isArray(eventIds) || eventIds.length === 0) {
      return sendError(res, "eventIds array is required", 400);
    }

    
    const invalidIds = eventIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return sendError(res, `Invalid event IDs: ${invalidIds.join(", ")}`, 400);
    }

    const result = await eventModel.deleteMany({ _id: { $in: eventIds } });

    if (result.deletedCount === 0) {
      return sendError(res, "No events found to delete", 404);
    }

    log.info(`Bulk deleted ${result.deletedCount} events`);
    return sendSuccess(res, `${result.deletedCount} events deleted successfully`, {
      deletedCount: result.deletedCount
    });
  } catch (error) {
    log.error(`Error While Bulk Deleting Events: ${error.message}`);
    return sendError(res, "Error While Bulk Deleting Events", error);
  }
};


export const getEventStats = async (req, res) => {
  try {
    const stats = await eventModel.aggregate([
      {
        $group: {
          _id: "$typesOfEvent",
          count: { $sum: 1 },
          latestEvent: { $max: "$createdAt" }
        }
      },
      {
        $project: {
          eventType: "$_id",
          count: 1,
          latestEvent: 1,
          _id: 0
        }
      }
    ]);

    const totalEvents = await eventModel.countDocuments();
    const eventsWithContact = await eventModel.countDocuments({
      $or: [{ contactNo: { $exists: true, $ne: "" } }, { whatsappNo: { $exists: true, $ne: "" } }]
    });

    const response = {
      totalEvents,
      eventsWithContact,
      eventsByType: stats
    };

    return sendSuccess(res, "Event statistics retrieved successfully", response);
  } catch (error) {
    log.error(`Error While Getting Event Statistics: ${error.message}`);
    return sendError(res, "Error While Getting Event Statistics", error);
  }
};