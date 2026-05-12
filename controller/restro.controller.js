import mongoose from "mongoose";
import { deleteFromS3, resizeImage, uploadToS3 } from "../middleware/uploadS3.js";
import restroModel from "../model/restro.model.js";
import watchListModel from "../model/watchlist.model.js";
import adminModel from "../model/admin.model.js";
import { sendBadRequest, sendCreated, sendError, sendNotFound, sendSuccess } from "../utils/responseUtils.js";
import log from "../utils/logger.js";
import { sendNotification } from "../utils/notification.utils.js";
import themeCategoryModel from "../model/themeCategory.model.js";
import restaurantBookingModel from "../model/restro.booking.model.js";

const getS3Key = (url) => {
  if (!url || typeof url !== "string") return null;
  const parts = url.split(".amazonaws.com/");
  return parts.length > 1 ? parts[1] : null;
};

export const createNewRestaurant = async (req, res) => {
  try {
    const {
      themeCategoryId,
      name,
      description,
      address,
      city,
      state,
      country,
      lat,
      lng,
      amenities,
      services,
      actualPrice,
      discountPrice,
      popular,
      currency,
      operatingHours,
      contact,
    } = req.body;

    if (!name?.trim() || !address?.trim() || !city?.trim()) {
      return res.status(400).json({ success: false, message: "Name, address, and city are required" });
    }

    if (themeCategoryId && !mongoose.Types.ObjectId.isValid(themeCategoryId)) {
      return res.status(400).json({ success: false, message: "Invalid theme category ID" });
    }

    const existingRestro = await restroModel.findOne({
      name: name.trim(),
      address: address.trim(),
      city: city.trim()
    });
    if (existingRestro) {
      return res.status(400).json({ success: false, message: "A restaurant with this name and address already exists" });
    }

    const parse = (val) => typeof val === "string" ? JSON.parse(val) : val || [];
    const parseObj = (val) => typeof val === "string" ? JSON.parse(val) : val || {};

    const parsedAmenities = parse(amenities);
    const parsedServices = parse(services);
    const parsedOperatingHours = parseObj(operatingHours);
    const parsedContact = parseObj(contact);

    let imageUrls = [];
    if (req.files && req.files.length > 0) {
      const imageFiles = req.files.filter(f => f.fieldname === "images");

      if (imageFiles.length > 10) {
        return res.status(400).json({ success: false, message: "Maximum 10 images allowed" });
      }

      for (const file of imageFiles) {
        const resizedBuffer = await resizeImage(file.buffer, { width: 1024, height: 768, quality: 80 });
        const url = await uploadToS3(
          resizedBuffer,
          `restaurants/${Date.now()}_${file.originalname}`,
          file.mimetype,
          "restaurants"
        );
        imageUrls.push(url);
      }
    }

    const newRestaurant = new restroModel({
      ownerId: req.admin?._id,
      name: name.trim(),
      description,
      address: address.trim(),
      city: city.trim(),
      state,
      country,
      lat: lat ? parseFloat(lat) : undefined,
      lng: lng ? parseFloat(lng) : undefined,
      themeCategoryId,
      amenities: parsedAmenities,
      services: parsedServices,
      actualPrice,
      discountPrice,
      currency: currency || "INR",
      popular: popular === "true" || popular === true,
      operatingHours: parsedOperatingHours,
      contact: parsedContact,
      images: imageUrls
    });

    await newRestaurant.save();

    return sendCreated(res, "Restaurant created successfully", newRestaurant);

  } catch (error) {
    log.error("Create Restaurant Error:", error);
    return sendError(res, "Server Error", error);
  }
};

export const updateRestaurant = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid restaurant ID" });
    }

    const existingRestro = await restroModel.findById(id);
    if (!existingRestro) {
      return res.status(404).json({ success: false, message: "Restaurant not found" });
    }

    const body = req.body || {};
    const updateData = {};

    if (body.name) updateData.name = body.name.trim();
    if (body.description) updateData.description = body.description.trim();
    if (body.status) updateData.status = body.status;
    if (body.popular !== undefined) updateData.popular = body.popular === "true" || body.popular === true;

    if (body.address) updateData.address = body.address.trim();
    if (body.city) updateData.city = body.city.trim();
    if (body.state) updateData.state = body.state;
    if (body.country) updateData.country = body.country;
    if (body.lat) updateData.lat = parseFloat(body.lat);
    if (body.lng) updateData.lng = parseFloat(body.lng);
    if (body.actualPrice) updateData.actualPrice = Number(body.actualPrice);
    if (body.discountPrice) updateData.discountPrice = Number(body.discountPrice);
    if (body.currency) updateData.currency = body.currency;

    const safeParse = (data, fallback) => {
      try {
        return typeof data === "string" ? JSON.parse(data) : data;
      } catch (e) {
        return fallback;
      }
    };

    if (body.amenities) updateData.amenities = safeParse(body.amenities, existingRestro.amenities);
    if (body.services) updateData.services = safeParse(body.services, existingRestro.services);
    if (body.operatingHours) updateData.operatingHours = safeParse(body.operatingHours, existingRestro.operatingHours);
    if (body.contact) updateData.contact = safeParse(body.contact, existingRestro.contact);

    if (body.themeCategoryId && mongoose.Types.ObjectId.isValid(body.themeCategoryId)) {
      updateData.themeCategoryId = body.themeCategoryId;
    }

    if (req.files && req.files.length > 0) {
      const imageFiles = req.files.filter(f => f.fieldname === "images");
      const newImages = [];

      for (const file of imageFiles) {
        try {
          const resized = await resizeImage(file.buffer, { width: 1024, height: 768, quality: 80 });
          const url = await uploadToS3(
            resized,
            `restaurants/${Date.now()}_${file.originalname}`,
            file.mimetype,
            "restaurants"
          );
          newImages.push(url);
        } catch (err) {
          log.error("Image Processing Error:", err.message);
        }
      }

      if (newImages.length > 0) {
        updateData.images = newImages;
      }
    } else if (body.images) {
      updateData.images = safeParse(body.images, existingRestro.images);
    }

    const updatedRestro = await restroModel.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate("themeCategoryId");

    return sendSuccess(res, "Restaurant updated successfully", updatedRestro);

  } catch (error) {
    log.error("Update Restaurant Error:", error);
    return sendError(res, "Server Error", error);
  }
};

export const getAllRestos = async (req, res) => {
  try {
    const adminId = req.admin?._id;
    const filter = adminId ? { ownerId: adminId } : {};
    const restros = await restroModel.find(filter).sort({ createdAt: -1 }).lean();

    let favoriteRestroIds = [];
    if (req.user?._id) {
      const watchlist = await watchListModel.findOne({ userId: req.user._id });
      favoriteRestroIds = watchlist ? watchlist.restro.map(id => id.toString()) : [];
    }

    const restrosWithFavorite = restros.map(restro => ({
      ...restro,
      isFavorite: favoriteRestroIds.includes(restro._id.toString())
    }));

    return sendSuccess(res, "Restaurants fetched successfully", restrosWithFavorite);
  } catch (error) {
    return sendError(res, "Server Error", error);
  }
};

export const getSingleRestro = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ success: false, message: "Invalid restaurant ID" });
    const restro = await restroModel.findById(id).populate("ownerId", "name email").populate("themeCategoryId").lean();
    if (!restro) return res.status(404).json({ success: false, message: "Restaurant not found" });

    let isFavorite = false;
    if (req.user?._id) {
      const watchlist = await watchListModel.findOne({ userId: req.user._id });
      isFavorite = watchlist ? watchlist.restro.some(rid => rid.toString() === restro._id.toString()) : false;
    }

    return res.status(200).json({ success: true, message: "Restaurant fetched successfully", restro: { ...restro, isFavorite } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

export const deleteRestaurant = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid restaurant ID" });
    }

    const restro = await restroModel.findById(id);
    if (!restro) return res.status(404).json({ success: false, message: "Restaurant not found" });

    if (restro.images && restro.images.length > 0) {
      for (const url of restro.images) {
        const key = getS3Key(url);
        if (key) await deleteFromS3(key);
      }
    }

    await restroModel.findByIdAndDelete(id);
    return sendSuccess(res, "Restaurant deleted successfully");
  } catch (error) {
    log.error("Delete Restaurant Error:", error);
    return sendError(res, "Server Error", error);
  }
};

export const searchRestaurants = async (req, res) => {
  try {
    const { q, city } = req.query;
    const query = { status: "active" };
    if (q) {
      query.$or = [
        { name: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
      ];
    }
    if (city) query.city = { $regex: city, $options: "i" };
    const results = await restroModel.find(query).lean();

    let favoriteRestroIds = [];
    if (req.user?._id) {
      const watchlist = await watchListModel.findOne({ userId: req.user._id });
      favoriteRestroIds = watchlist ? watchlist.restro.map(id => id.toString()) : [];
    }

    const resultsWithFavorite = results.map(restro => ({
      ...restro,
      isFavorite: favoriteRestroIds.includes(restro._id.toString())
    }));

    return sendSuccess(res, "Restaurants fetched successfully", resultsWithFavorite);
  } catch (error) {
    return sendError(res, "Server Error", error);
  }
};

export const restroChangeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.query;
    const restro = await restroModel.findByIdAndUpdate(id, { status }, { new: true });
    if (!restro) return sendNotFound(res, "Restaurant not found");
    return sendSuccess(res, `Status updated to ${status}`, restro);
  } catch (error) {
    return sendError(res, "Server Error", error);
  }
};

export const filterRestaurants = async (req, res) => {
  try {
    const { city, minPrice, maxPrice, rating } = req.query;
    const query = { status: "active" };
    if (city) query.city = city;
    if (minPrice || maxPrice) {
      query.discountPrice = {};
      if (minPrice) query.discountPrice.$gte = parseFloat(minPrice);
      if (maxPrice) query.discountPrice.$lte = parseFloat(maxPrice);
    }
    if (rating) query.averageRating = { $gte: parseFloat(rating) };
    const restros = await restroModel.find(query).lean();

    let favoriteRestroIds = [];
    if (req.user?._id) {
      const watchlist = await watchListModel.findOne({ userId: req.user._id });
      favoriteRestroIds = watchlist ? watchlist.restro.map(id => id.toString()) : [];
    }

    const restrosWithFavorite = restros.map(restro => ({
      ...restro,
      isFavorite: favoriteRestroIds.includes(restro._id.toString())
    }));

    return sendSuccess(res, "Restaurants fetched successfully", restrosWithFavorite);
  } catch (error) {
    return sendError(res, "Server Error", error);
  }
};

export const addRestroImages = async (req, res) => {
  try {
    const { id } = req.params;
    const restro = await restroModel.findById(id);
    if (!restro) return res.status(404).json({ success: false, message: "Restaurant not found" });

    if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, message: "No images provided" });

    const newUrls = [];
    for (const file of req.files) {
      const resizedBuffer = await resizeImage(file.buffer, { width: 1024, height: 768, quality: 80 });
      const url = await uploadToS3(resizedBuffer, file.originalname, file.mimetype, "restaurants");
      newUrls.push(url);
    }

    restro.images = [...(restro.images || []), ...newUrls];
    await restro.save();

    return sendSuccess(res, "Images added successfully", restro.images);
  } catch (error) {
    return sendError(res, "Server Error", error);
  }
};

export const removeRestroImage = async (req, res) => {
  try {
    const { id, imageUrl } = req.params;
    const restro = await restroModel.findById(id);
    if (!restro) return res.status(404).json({ success: false, message: "Restaurant not found" });

    restro.images = restro.images.filter(img => img !== imageUrl);
    const key = getS3Key(imageUrl);
    if (key) await deleteFromS3(key);

    await restro.save();
    return sendSuccess(res, "Image removed successfully", restro.images);
  } catch (error) {
    return sendError(res, "Server Error", error);
  }
};

export const getRestrosByTheme = async (req, res) => {
  try {
    const { themeId } = req.query;

    if (!themeId || !mongoose.Types.ObjectId.isValid(themeId)) {
      return sendBadRequest(res, "Valid Theme Category ID is required");
    }

    const restros = await restroModel.find({
      themeCategoryId: themeId,
      status: "active",
    })
      .select("-__v")
      .populate("themeCategoryId", "name image")
      .populate("ownerId", "name email")
      .lean();

    let favoriteRestroIds = [];
    if (req.user?._id) {
      const watchlist = await watchListModel.findOne({ userId: req.user._id });
      favoriteRestroIds = watchlist ? watchlist.restro.map(id => id.toString()) : [];
    }

    const restrosWithFavorite = restros.map(restro => ({
      ...restro,
      isFavorite: favoriteRestroIds.includes(restro._id.toString())
    }));

    return sendSuccess(res, "Restaurants fetched by theme successfully", {
      restros: restrosWithFavorite,
      total: restros.length
    });
  } catch (error) {
    log.error("Get Restros By Theme Error: " + error.message);
    return sendError(res, "Server Error", error);
  }
};

export const getPopularRestros = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const popularData = await restaurantBookingModel.aggregate([
      {
        $group: {
          _id: "$restaurantId",
          bookingCount: { $sum: 1 }
        }
      },
      { $sort: { bookingCount: -1 } },
      { $limit: parseInt(limit) },
      {
        $lookup: {
          from: "restros",
          localField: "_id",
          foreignField: "_id",
          as: "restaurant"
        }
      },
      { $unwind: "$restaurant" },
      {
        $project: {
          _id: 0,
          restaurant: "$restaurant",
          bookingCount: 1
        }
      }
    ]);

    let results = popularData.map(item => ({
      ...item.restaurant,
      bookingCount: item.bookingCount
    }));

    if (results.length === 0) {
      results = await restroModel.find({ popular: true, status: "active" })
        .limit(parseInt(limit))
        .lean();
    }

    let favoriteRestroIds = [];
    if (req.user?._id) {
      const watchlist = await watchListModel.findOne({ userId: req.user._id });
      favoriteRestroIds = watchlist ? watchlist.restro.map(id => id.toString()) : [];
    }

    const resultsWithFavorite = results.map(restro => ({
      ...restro,
      isFavorite: favoriteRestroIds.includes(restro._id?.toString() || restro._id?.toString())
    }));

    return sendSuccess(res, "Popular restaurants fetched successfully", resultsWithFavorite);
  } catch (error) {
    log.error("Get Popular Restros Error: " + error.message);
    return sendError(res, "Internal Server Error", error);
  }
};
