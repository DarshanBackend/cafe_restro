import mongoose from "mongoose";
import { deleteFromS3, resizeImage, uploadToS3 } from "../middleware/uploadS3.js";
import restroModel from "../model/restro.model.js";
import adminModel from "../model/admin.model.js";
import log from "../utils/logger.js";
import { sendBadRequest, sendError, sendSuccess } from "../utils/responseUtils.js";
import { sendNotification } from "../utils/notificatoin.utils.js";

export const createNewRestaurant = async (req, res) => {
  // Track uploaded images for cleanup on error
  const uploadedImages = { featured: null, gallery: [], menu: [] };

  try {
    const {
      name,
      description,
      address,
      contact,
      cuisineTypes,
      actualPrice,
      discountPrice,
      currency,
      operatingHours,
      amenities,
      services,
      paymentMethods,
      socialMedia,
      isPopular,
      isVerified,
      tableGroups,
    } = req.body;

    // Basic validation
    if (!name?.trim()) return sendBadRequest(res, "Restaurant name is required");
    if (!actualPrice) return sendBadRequest(res, "Actual price is required");
    if (!discountPrice) return sendBadRequest(res, "Discount price is required");
    if (!address) return sendBadRequest(res, "Address is required");

    // Note: Duplicate check is done in validateRestroDuplicate middleware BEFORE S3 upload

    // ---- File uploads ----
    const featuredFile = req.files?.featured?.[0];
    const galleryFiles = Array.isArray(req.files?.gallery) ? req.files.gallery : [];
    const menuFiles = Array.isArray(req.files?.menu) ? req.files.menu : [];

    const featuredUrl = featuredFile
      ? await uploadToS3(
        await resizeImage(featuredFile.buffer, { width: 1280, height: 720 }),
        featuredFile.originalname,
        featuredFile.mimetype,
        "restaurants/featured"
      )
      : null;
    uploadedImages.featured = featuredUrl;

    const galleryUrls = await Promise.all(
      galleryFiles.map(async (file) => {
        const buffer = await resizeImage(file.buffer, { width: 1024, height: 768 });
        return await uploadToS3(buffer, file.originalname, file.mimetype, "restaurants/gallery");
      })
    );
    uploadedImages.gallery = galleryUrls;

    const menuUrls = await Promise.all(
      menuFiles.map(async (file) => {
        const buffer = await resizeImage(file.buffer, { width: 1024, height: 768 });
        return await uploadToS3(buffer, file.originalname, file.mimetype, "restaurants/menu");
      })
    );
    uploadedImages.menu = menuUrls;

    // ---- Parse JSON-like fields ----
    const parsed = (v, fallback = []) => (typeof v === "string" ? JSON.parse(v) : v || fallback);
    const parsedAddress = typeof address === "string" ? JSON.parse(address) : address;
    const parsedContact = typeof contact === "string" ? JSON.parse(contact) : contact;
    const parsedOperatingHours = typeof operatingHours === "string" ? JSON.parse(operatingHours) : operatingHours;
    const parsedTableGroups = parsed(tableGroups).map((group) => ({
      ...group,
      tables: Array.from({ length: group.totalTables }).map((_, i) => ({
        tableNumber: `${group.capacity}P-${i + 1}`,
        isBooked: false,
      })),
    }));

    // Validate payment methods
    const validPaymentMethods = ["Cash", "Credit Card", "Debit Card", "UPI", "Digital Wallet"];
    const parsedPaymentMethods = parsed(paymentMethods);
    if (parsedPaymentMethods.length > 0) {
      const invalidPayments = parsedPaymentMethods.filter(
        (method) => !validPaymentMethods.includes(method)
      );
      if (invalidPayments.length > 0) {
        // Delete uploaded images if validation fails
        if (featuredUrl) {
          const key = featuredUrl.split(".amazonaws.com/")[1];
          if (key) await deleteFromS3(key).catch(() => { });
        }
        if (galleryUrls.length > 0) {
          const keys = galleryUrls.map(url => url.split(".amazonaws.com/")[1]).filter(Boolean);
          await Promise.allSettled(keys.map(key => deleteFromS3(key)));
        }
        if (menuUrls.length > 0) {
          const keys = menuUrls.map(url => url.split(".amazonaws.com/")[1]).filter(Boolean);
          await Promise.allSettled(keys.map(key => deleteFromS3(key)));
        }
        return sendBadRequest(
          res,
          `Invalid payment method(s): ${invalidPayments.join(", ")}. Allowed values: ${validPaymentMethods.join(", ")}`
        );
      }
    }

    // ---- Create restaurant ----
    const restaurant = new restroModel({
      ownerId: req.admin._id,
      name,
      description,
      address: parsedAddress,
      contact: parsedContact,
      cuisineTypes: parsed(cuisineTypes),
      actualPrice,
      discountPrice,
      currency: currency || "INR",
      operatingHours: parsedOperatingHours,
      amenities: parsed(amenities),
      services: parsed(services),
      paymentMethods: parsedPaymentMethods,
      socialMedia: parsed(socialMedia, {}),
      isPopular: !!isPopular,
      isVerified: !!isVerified,
      images: { featured: featuredUrl, gallery: galleryUrls, menu: menuUrls },
      tableGroups: parsedTableGroups,
    });

    await restaurant.save();

    // ✅ Append restaurant ID to admin model
    if (restaurant.ownerId && restaurant._id) {
      await adminModel.findByIdAndUpdate(
        restaurant.ownerId,
        { $addToSet: { restro: restaurant._id } },
        { new: true }
      ).catch(err => log.warn("Failed to update admin restro:", err.message));
    }

    await sendNotification({
      adminId: restaurant.ownerId,
      title: `New Restro Created: ${restaurant.name}`,
      description: `Restaurant created successfully with ${restaurant.images.gallery.length} gallery images and ${restaurant.tableGroups.length} table groups.`,
      image: restaurant.images.featured || null,
      type: "broadcast"
    }).catch(err => log.warn("Notification Error:", err.message));

    log.success(`Restaurant created: ${restaurant.name}`);
    return sendSuccess(res, "Restaurant created successfully", restaurant);
  } catch (error) {
    log.error(`createNewRestaurant Error: ${error.message}`);

    // Clean up uploaded images on error
    try {
      if (uploadedImages.featured) {
        const key = uploadedImages.featured.split(".amazonaws.com/")[1];
        if (key) await deleteFromS3(key).catch(() => { });
      }
      if (uploadedImages.gallery.length > 0) {
        const keys = uploadedImages.gallery.map(url => url.split(".amazonaws.com/")[1]).filter(Boolean);
        await Promise.allSettled(keys.map(key => deleteFromS3(key)));
      }
      if (uploadedImages.menu.length > 0) {
        const keys = uploadedImages.menu.map(url => url.split(".amazonaws.com/")[1]).filter(Boolean);
        await Promise.allSettled(keys.map(key => deleteFromS3(key)));
      }
    } catch (cleanupError) {
      log.warn("Failed to cleanup images on error:", cleanupError.message);
    }

    return sendError(res, 500, "Failed to create restaurant", error.message);
  }
};

export const getAllRestos = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search,
      city,
      cuisine,
      minRating,
      maxCost,
      hasTableCapacity,
      services,
      isPopular,
      isVerified,
      status,
      sortBy = "rating.average",
      sortOrder = "desc"
    } = req.query;

    const filter = {};

    // Search filter
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { "address.city": { $regex: search, $options: "i" } }
      ];
    }

    // Location filter
    if (city) {
      filter["address.city"] = { $regex: city, $options: "i" };
    }

    // Cuisine filter
    if (cuisine) {
      filter.cuisineTypes = { $in: [new RegExp(cuisine, 'i')] };
    }

    // Rating filter
    if (minRating) {
      filter["rating.average"] = { $gte: parseFloat(minRating) };
    }

    // Cost filter
    if (maxCost) {
      filter.discountPrice = { $lte: parseFloat(maxCost) };
    }

    // Table capacity filter
    if (hasTableCapacity) {
      filter["tableGroups.capacity"] = { $gte: parseInt(hasTableCapacity) };
    }

    // Services filter
    if (services) {
      const servicesArray = Array.isArray(services) ? services : [services];
      filter.services = { $in: servicesArray };
    }

    // Boolean filters
    if (isPopular !== undefined) filter.isPopular = isPopular === "true";
    if (isVerified !== undefined) filter.isVerified = isVerified === "true";
    if (status) filter.status = status;

    // Sort options
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const restaurants = await restroModel
      .find(filter)
      .populate("ownerId", "name email")
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .select("-tableGroups.tables.currentBooking"); // Exclude sensitive booking info

    const total = await restroModel.countDocuments(filter);

    return sendSuccess(res, "Restaurants fetched successfully", {
      total: restaurants.length,
      restaurants,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalRestaurants: total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    log.error(`getAllRestaurants Error: ${error.message}`);
    return sendError(res, 500, "Failed to fetch restaurants", error.message);
  }
};

export const getSingleRestro = async (req, res) => {
  try {
    const { id } = req.params;

    const restaurant = await restroModel.findById(id).populate("ownerId", "name email");
    if (!restaurant) return sendBadRequest(res, "Restaurant not found");

    return sendSuccess(res, "Restaurant fetched successfully", restaurant);
  } catch (error) {
    log.error(`getSingleRestro Error: ${error.message}`);
    return sendError(res, 500, "Failed to fetch restaurant", error.message);
  }
};

export const filterRestaurants = async (req, res) => {
  try {
    const { cuisine, minCost, maxCost, city, rating, service, isPopular, isVerified } = req.query;
    const filter = { status: "active" };

    if (city) filter["address.city"] = new RegExp(city, "i");
    if (cuisine) filter.cuisineTypes = { $in: [new RegExp(cuisine, "i")] };
    if (service) filter.services = { $in: [service] };
    if (rating) filter["rating.average"] = { $gte: parseFloat(rating) };
    if (minCost || maxCost) {
      filter.discountPrice = {
        ...(minCost && { $gte: parseFloat(minCost) }),
        ...(maxCost && { $lte: parseFloat(maxCost) }),
      };
    }
    if (isPopular !== undefined) filter.isPopular = isPopular === "true";
    if (isVerified !== undefined) filter.isVerified = isVerified === "true";

    const restaurants = await restroModel.find(filter).sort({ "rating.average": -1 });
    return sendSuccess(res, "Filtered restaurants fetched", restaurants);
  } catch (error) {
    log.error(`filterRestaurants Error: ${error.message}`);
    return sendError(res, 500, "Failed to filter restaurants", error.message);
  }
};

const parseDate = (dateStr) => {
  // Expecting "DD-MM-YYYY"
  const [day, month, year] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day); // month is 0-indexed
};


export const getAvailableTables = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, partySize } = req.query;

    if (!date || !partySize) return sendBadRequest(res, "date and partySize are required");

    const requestedDate = parseDate(date); // parse DD-MM-YYYY
    if (isNaN(requestedDate.getTime())) return sendBadRequest(res, "Invalid date format. Use DD-MM-YYYY");

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (requestedDate < today) return sendBadRequest(res, "Date cannot be in the past");

    const restaurant = await restroModel.findById(id);
    if (!restaurant) return sendBadRequest(res, "Restaurant not found");

    const availableTables = restaurant.findAvailableTables(parseInt(partySize), requestedDate);
    return sendSuccess(res, "Available tables fetched", availableTables);
  } catch (error) {
    log.error(`getAvailableTables Error: ${error.message}`);
    return sendError(res, 500, "Failed to get available tables", error.message);
  }
};

export const getAvailableRestoTimeSlots = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, partySize } = req.query;

    if (!date || !partySize) return sendBadRequest(res, "date and partySize are required");

    const requestedDate = parseDate(date); // parse DD-MM-YYYY
    if (isNaN(requestedDate.getTime())) return sendBadRequest(res, "Invalid date format. Use DD-MM-YYYY");

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (requestedDate < today) return sendBadRequest(res, "Date cannot be in the past");

    const restaurant = await restroModel.findById(id);
    if (!restaurant) return sendBadRequest(res, "Restaurant not found");

    const slots = restaurant.getAvailableTimeSlots(requestedDate, parseInt(partySize));
    return sendSuccess(res, "Available time slots fetched", slots);
  } catch (error) {
    log.error(`getAvailableTimeSlots Error: ${error.message}`);
    return sendError(res, 500, "Failed to get time slots", error.message);
  }
};

export const searchRestaurants = async (req, res) => {
  try {
    const { name, city, cuisine, minCost, maxCost, rating, service, isPopular, isVerified } = req.query;

    const filter = { status: "active" };

    if (name) {
      filter.name = { $regex: name, $options: "i" };
    }
    if (city) filter["address.city"] = { $regex: city, $options: "i" };
    if (cuisine) filter.cuisineTypes = { $in: [new RegExp(cuisine, "i")] };
    if (service) filter.services = { $in: [service] };
    if (rating) filter["rating.average"] = { $gte: parseFloat(rating) };
    if (minCost || maxCost) {
      filter.discountPrice = {
        ...(minCost && { $gte: parseFloat(minCost) }),
        ...(maxCost && { $lte: parseFloat(maxCost) }),
      };
    }
    if (isPopular !== undefined) filter.isPopular = isPopular === "true";
    if (isVerified !== undefined) filter.isVerified = isVerified === "true";

    const restaurants = await restroModel.find(filter).sort({ "rating.average": -1 });

    return sendSuccess(res, "Restaurants fetched successfully", restaurants);
  } catch (error) {
    log.error(`searchRestaurants Error: ${error.message}`);
    return sendError(res, 500, "Failed to search restaurants", error.message);
  }
};

export const updateRestaurant = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await restroModel.findById(id);
    if (!existing) return sendBadRequest(res, "Restaurant not found");

    // Handle file updates
    const featuredFile = req.files?.featured?.[0];
    const galleryFiles = Array.isArray(req.files?.gallery) ? req.files.gallery : [];
    const menuFiles = Array.isArray(req.files?.menu) ? req.files.menu : [];

    let featuredUrl = existing.images.featured;
    let galleryUrls = existing.images.gallery || [];
    let menuUrls = existing.images.menu || [];

    // Replace featured image
    if (featuredFile) {
      if (featuredUrl) {
        const oldKey = featuredUrl.split(".amazonaws.com/")[1];
        if (oldKey) {
          await deleteFromS3(oldKey).catch(err => log.warn("Failed to delete old featured image:", err.message));
        }
      }
      featuredUrl = await uploadToS3(
        await resizeImage(featuredFile.buffer, { width: 1280, height: 720 }),
        featuredFile.originalname,
        featuredFile.mimetype,
        "restaurants/featured"
      );
    }

    // Replace gallery images
    if (galleryFiles.length > 0) {
      const oldGalleryKeys = galleryUrls.map(url => url.split(".amazonaws.com/")[1]).filter(Boolean);
      await Promise.allSettled(oldGalleryKeys.map(key => deleteFromS3(key)));

      const uploads = await Promise.all(
        galleryFiles.map(async (file) => {
          const buffer = await resizeImage(file.buffer, { width: 1024, height: 768 });
          return await uploadToS3(buffer, file.originalname, file.mimetype, "restaurants/gallery");
        })
      );
      galleryUrls = uploads;
    }

    // Replace menu images
    if (menuFiles.length > 0) {
      const oldMenuKeys = menuUrls.map(url => url.split(".amazonaws.com/")[1]).filter(Boolean);
      await Promise.allSettled(oldMenuKeys.map(key => deleteFromS3(key)));

      const uploads = await Promise.all(
        menuFiles.map(async (file) => {
          const buffer = await resizeImage(file.buffer, { width: 1024, height: 768 });
          return await uploadToS3(buffer, file.originalname, file.mimetype, "restaurants/menu");
        })
      );
      menuUrls = uploads;
    }

    // Parse JSON-like fields
    const parsed = (v, fallback = []) => (typeof v === "string" ? JSON.parse(v) : v || fallback);

    const updateData = {
      ...req.body,
      actualPrice: req.body.actualPrice ? Number(req.body.actualPrice) : undefined,
      discountPrice: req.body.discountPrice ? Number(req.body.discountPrice) : undefined,
      cuisineTypes: parsed(req.body.cuisineTypes),
      amenities: parsed(req.body.amenities),
      services: parsed(req.body.services),
      paymentMethods: parsed(req.body.paymentMethods),
      socialMedia: parsed(req.body.socialMedia, {}),
      images: { featured: featuredUrl, gallery: galleryUrls, menu: menuUrls },
    };

    const updated = await restroModel.findByIdAndUpdate(id, updateData, { new: true });
    return sendSuccess(res, "Restaurant updated successfully", {
      total: updated.length,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalRestaurants: total,
        hasNext: page * limit < total,
        hasPrev: page > 1
      },
      updated,
    });
  } catch (error) {
    log.error(`updateRestaurant Error: ${error.message}`);
    return sendError(res, 500, "Failed to update restaurant", error.message);
  }
};

export const restroChangeStatus = async (req, res) => {
  try {
    const { id } = req?.params;
    const { status } = req?.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequest(res, "Invalid restaurant ID");
    }

    let validStatuses = ["active", "inactive", "suspended", "pending"];

    if (!validStatuses.includes(status)) {
      return sendBadRequest(res, "Invalid status value");
    }
    const restaurant = await restroModel.findById(id);
    if (!restaurant) {
      return sendBadRequest(res, "Restaurant not found");
    }

    restaurant.status = status;
    await restaurant.save();

    return sendSuccess(res, "Restaurant status updated successfully", restaurant);

  } catch (error) {
    log.error(`Error while Change Restro Status : ${error.message}`)
    return sendError(res, 500, "Failed to Change Restro Status", error.message);
  }
}

export const deleteRestaurant = async (req, res) => {
  try {
    const { id } = req.params;
    const restaurant = await restroModel.findById(id);
    if (!restaurant) return sendBadRequest(res, "Restaurant not found");

    if (restaurant.ownerId) {
      await adminModel.findByIdAndUpdate(
        restaurant.ownerId,
        { $pull: { restro: id } },
        { new: true }
      ).catch(err => log.warn("Failed to remove restaurant from admin:", err.message));
    }

    const imagesToDelete = [];

    if (restaurant.images.featured) {
      const key = restaurant.images.featured.split(".amazonaws.com/")[1];
      if (key) imagesToDelete.push(key);
    }

    if (Array.isArray(restaurant.images.gallery) && restaurant.images.gallery.length > 0) {
      restaurant.images.gallery.forEach((url) => {
        const key = url.split(".amazonaws.com/")[1];
        if (key) imagesToDelete.push(key);
      });
    }

    if (Array.isArray(restaurant.images.menu) && restaurant.images.menu.length > 0) {
      restaurant.images.menu.forEach((url) => {
        const key = url.split(".amazonaws.com/")[1];
        if (key) imagesToDelete.push(key);
      });
    }


    if (imagesToDelete.length > 0) {
      await Promise.allSettled(imagesToDelete.map((key) => deleteFromS3(key)));
    }


    await restaurant.deleteOne();

    log.info(`Deleted restaurant: ${id}`);
    return sendSuccess(res, "Restaurant deleted successfully");
  } catch (error) {
    log.error(`deleteRestaurant Error: ${error.message}`);
    return sendError(res, 500, "Failed to delete restaurant", error.message);
  }
};

export const resetAllTables = async (req, res) => {
  try {
    const { restroId } = req.params;

    const restro = await restroModel.findById(restroId);
    if (!restro) return sendNotFound(res, "Restaurant not found");

    restro.tableGroups.forEach(group => {
      group.tables.forEach(table => {
        table.isBooked = false;
        table.currentBooking = null;
      });
    });

    await restro.save();

    return sendSuccess(res, null, "All tables have been reset to available");
  } catch (error) {
    log.error(`Error resetting tables: ${error.message}`);
    return sendError(res, error, `Error resetting tables: ${error.message}`);
  }
};
