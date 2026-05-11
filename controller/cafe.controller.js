import mongoose from "mongoose";
import { deleteFromS3, resizeImage, uploadToS3 } from "../middleware/uploadS3.js";
import cafeModel from "../model/cafe.model.js";
import adminModel from "../model/admin.model.js";
import { sendNotification } from "../utils/notification.utils.js";
import log from "../utils/logger.js";
import { sendNotFound } from '../utils/responseUtils.js'
import cafeBookingModel from "../model/cafe.booking.model.js";

export const createNewCafe = async (req, res) => {
  try {
    const {
      name,
      description,
      address,
      city,
      state,
      country,
      lat,
      lng,
      themeCategoryId,
      amenities,
      services,
      actualPrice,
      discountPrice,
      currency,
      popular,
      operatingHours,
      contact,
    } = req.body;

    if (!name?.trim() || !address?.trim() || !city?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Name, address, and city are required",
      });
    }

    if (!themeCategoryId) {
      return res.status(400).json({
        success: false,
        message: "Theme category ID is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(themeCategoryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid theme category ID",
      });
    }

    const existingCafe = await cafeModel.findOne({
      name: name.trim(),
      "location.address": address.trim()
    });
    if (existingCafe) {
      return res.status(400).json({
        success: false,
        message: "A cafe with this name and address already exists",
      });
    }

    const parsedAmenities =
      typeof amenities === "string" ? JSON.parse(amenities) : amenities || [];

    const parsedServices =
      typeof services === "string" ? JSON.parse(services) : services || [];

    const parsedOperatingHours =
      typeof operatingHours === "string"
        ? JSON.parse(operatingHours)
        : operatingHours || {};

    const parsedContact =
      typeof contact === "string" ? JSON.parse(contact) : contact || {};

    let latNum, lngNum;
    if (lat && lng) {
      latNum = parseFloat(lat);
      lngNum = parseFloat(lng);
      if (
        isNaN(latNum) ||
        isNaN(lngNum) ||
        latNum < -90 ||
        latNum > 90 ||
        lngNum < -180 ||
        lngNum > 180
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid coordinates provided",
        });
      }
    }

    let imageUrls = [];

    if (req.files && req.files.length > 0) {
      const cafeImageFiles = req.files.filter(
        (file) => file.fieldname === "images"
      );

      if (cafeImageFiles.length > 0) {
        if (cafeImageFiles.length > 10) {
          return res.status(400).json({
            success: false,
            message: "Maximum 10 images allowed for a cafe",
          });
        }

        for (const file of cafeImageFiles) {
          const allowedMimeTypes = [
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp",
          ];

          if (!allowedMimeTypes.includes(file.mimetype)) {
            return res.status(400).json({
              success: false,
              message: `Invalid file type for ${file.originalname}.`,
            });
          }

          try {
            const resizedBuffer = await resizeImage(file.buffer, {
              width: 1024,
              height: 768,
              quality: 80,
            });

            const imageUrl = await uploadToS3(
              resizedBuffer,
              file.originalname,
              file.mimetype,
              "cafes"
            );
            imageUrls.push(imageUrl);
          } catch (err) {
            console.error("Cafe image processing error:", err);
            return res.status(500).json({
              success: false,
              message: `Failed to process image: ${file.originalname}`,
            });
          }
        }
      }
    }

    const newCafe = new cafeModel({
      name: name.trim(),
      description: description?.trim() || "",
      location: {
        address: address.trim(),
        city: city.trim(),
        state: state?.trim() || "",
        country: country?.trim() || "India",
        coordinates: {
          lat: latNum || undefined,
          lng: lngNum || undefined,
        },
      },
      themeCategoryId,
      images: imageUrls,
      amenities: parsedAmenities,
      services: parsedServices,
      operatingHours: parsedOperatingHours,
      contact: {
        phone: parsedContact?.phone || "",
        email: parsedContact?.email || "",
        website: parsedContact?.website || "",
        instagram: parsedContact?.instagram || "",
        facebook: parsedContact?.facebook || "",
        whatsapp: parsedContact?.whatsapp || "",
        mapLink: parsedContact?.mapLink || "",
      },
      pricing: {
        actualPrice: actualPrice ? parseFloat(actualPrice) : 0,
        discountPrice: discountPrice ? parseFloat(discountPrice) : 0,
        currency: currency || "INR",
      },
      popular: popular === "true" || popular === true,
      createdBy: req.admin?._id,
    });

    await newCafe.save();

    if (newCafe.createdBy && newCafe._id) {
      await adminModel.findByIdAndUpdate(
        newCafe.createdBy,
        { $addToSet: { cafes: newCafe._id } },
        { new: true }
      ).catch(err => log.warn("Failed to update admin cafes:", err.message));
    }

    await sendNotification({ adminId: newCafe.createdBy, title: `new Cafe Create ${name}`, description: `this new cafe created `, image: newCafe.images[0] || null, type: "broadcast" });

    return res.status(201).json({
      success: true,
      message: "Cafe created successfully",
      data: newCafe,
    });
  } catch (error) {
    console.error("Create Cafe Error:", error);

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors,
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "A cafe with this name or address already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

export const getAllCafes = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      city,
      country,
      popular,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNumber = parseInt(page, 10);
    const pageSize = parseInt(limit, 10);

    const filter = { status: "active" };

    if (city) filter["location.city"] = new RegExp(city, "i");
    if (country) filter["location.country"] = new RegExp(country, "i");
    if (popular === "true") filter.popular = true;
    if (search) filter.$text = { $search: search };

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

    const cafes = await cafeModel
      .find(filter)
      .sort(sortOptions)
      .skip((pageNumber - 1) * pageSize)
      .limit(pageSize)
      .select("-__v")
      .populate("themeCategoryId", "name image")
      .populate("createdBy", "name email");

    const total = await cafeModel.countDocuments(filter);

    return res.status(200).json({
      success: true,
      data: cafes,
      pagination: {
        current: pageNumber,
        totalPages: Math.ceil(total / pageSize),
        totalCafes: total,
        hasNext: pageNumber * pageSize < total,
        hasPrev: pageNumber > 1,
      },
    });
  } catch (error) {
    console.error("Get Cafes Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

export const getCafeById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid cafe ID"
      });
    }

    const cafe = await cafeModel
      .findById(id)
      .select('-__v')
      .populate("themeCategoryId", "name image")
      .populate('createdBy', 'name email');

    if (!cafe) {
      return res.status(404).json({
        success: false,
        message: "Cafe not found"
      });
    }

    const isOpen = cafe.isOpenNow();

    return res.status(200).json({
      success: true,
      data: {
        ...cafe.toObject(),
        isOpen
      }
    });

  } catch (error) {
    console.error("Get Cafe Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

export const updateCafe = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid cafe ID",
      });
    }

    const existingCafe = await cafeModel.findById(id);
    if (!existingCafe) {
      return res.status(404).json({
        success: false,
        message: "Cafe not found",
      });
    }

    const body = req.body || {};

    const updateData = {};

    if (body.name) updateData.name = body.name.trim();
    if (body.description) updateData.description = body.description.trim();
    if (body.status) updateData.status = body.status;
    if (body.popular !== undefined) updateData.popular = body.popular === "true" || body.popular === true;

    updateData.location = {
      address: body.address || existingCafe.location?.address,
      city: body.city || existingCafe.location?.city,
      state: body.state || existingCafe.location?.state,
      country: body.country || existingCafe.location?.country,
      coordinates: {
        lat: body.lat ? parseFloat(body.lat) : existingCafe.location?.coordinates?.lat,
        lng: body.lng ? parseFloat(body.lng) : existingCafe.location?.coordinates?.lng,
      },
    };

    updateData.pricing = {
      actualPrice: body.actualPrice ? Number(body.actualPrice) : existingCafe.pricing?.actualPrice,
      discountPrice: body.discountPrice ? Number(body.discountPrice) : existingCafe.pricing?.discountPrice,
      currency: body.currency || existingCafe.pricing?.currency || "INR",
    };

    const safeParse = (data, fallback) => {
      try {
        return typeof data === "string" ? JSON.parse(data) : data;
      } catch (e) {
        return fallback;
      }
    };

    if (body.amenities) updateData.amenities = safeParse(body.amenities, existingCafe.amenities);
    if (body.services) updateData.services = safeParse(body.services, existingCafe.services);
    if (body.operatingHours) updateData.operatingHours = safeParse(body.operatingHours, existingCafe.operatingHours);
    if (body.contact) updateData.contact = safeParse(body.contact, existingCafe.contact);

    if (body.themeCategoryId) {
      if (mongoose.Types.ObjectId.isValid(body.themeCategoryId)) {
        updateData.themeCategoryId = body.themeCategoryId;
      }
    }

    if (req.files && req.files.length > 0) {
      const imageFiles = req.files.filter(f => f.fieldname === "images");
      const newImages = [];

      for (const file of imageFiles) {
        try {
          const resized = await resizeImage(file.buffer, { width: 1024, height: 768, quality: 80 });
          const url = await uploadToS3(
            resized,
            `cafes/${Date.now()}_${file.originalname}`,
            file.mimetype,
            "cafes"
          );
          newImages.push(url);
        } catch (err) {
          log.error("Image Processing Error:", err.message);
        }
      }

      if (newImages.length > 0) {
        updateData.images = [...(existingCafe.images || []), ...newImages];
      }
    }

    const updatedCafe = await cafeModel.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate("themeCategoryId", "name image");

    return res.status(200).json({
      success: true,
      message: "Cafe updated successfully",
      data: updatedCafe,
    });

  } catch (error) {
    console.error("Update Cafe Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update cafe",
      error: error.message,
    });
  }
};

export const deleteCafe = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid cafe ID",
      });
    }

    const cafe = await cafeModel.findById(id);
    if (!cafe) {
      return res.status(404).json({
        success: false,
        message: "Cafe not found",
      });
    }

    if (cafe.createdBy) {
      await adminModel.findByIdAndUpdate(
        cafe.createdBy,
        { $pull: { cafes: id } },
        { new: true }
      ).catch(err => log.warn("Failed to remove cafe from admin:", err.message));
    }

    const imagesToDelete = [];

    if (Array.isArray(cafe.images) && cafe.images.length > 0) {
      cafe.images.forEach((imgUrl) => {
        const key = imgUrl.split(".amazonaws.com/")[1];
        if (key) imagesToDelete.push(key);
      });
    }

    if (imagesToDelete.length > 0) {
      await Promise.allSettled(imagesToDelete.map((key) => deleteFromS3(key)));
    }

    await cafeModel.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Cafe deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

export const getCafesByLocation = async (req, res) => {
  try {
    const { city, state, country, themeId, status, minPrice, maxPrice, popular } = req.query;

    const filter = {};

    if (city) filter["location.city"] = { $regex: new RegExp(city, "i") };
    if (state) filter["location.state"] = { $regex: new RegExp(state, "i") };
    if (country) filter["location.country"] = { $regex: new RegExp(country, "i") };

    if (themeId) filter.themeCategoryId = themeId;
    if (status) filter.status = status;
    if (popular !== undefined) filter.popular = popular === "true";

    if (minPrice || maxPrice) {
      filter["pricing.discountPrice"] = {};
      if (minPrice) filter["pricing.discountPrice"].$gte = Number(minPrice);
      if (maxPrice) filter["pricing.discountPrice"].$lte = Number(maxPrice);
    }

    if (Object.keys(filter).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide at least one search filter (city, state, country, theme, etc.)"
      });
    }

    const cafes = await cafeModel.find(filter).select("-__v");

    return res.status(200).json({
      success: true,
      count: cafes.length,
      filters: filter,
      data: cafes,
    });

  } catch (error) {
    console.error("Get Cafes by Location Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

export const getPopularCafes = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const cafes = await cafeModel.findPopular(parseInt(limit));

    return res.status(200).json({
      success: true,
      data: cafes,
      count: cafes.length
    });

  } catch (error) {
    console.error("Get Popular Cafes Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};

export const searchCafes = async (req, res) => {
  try {
    const { q, page = 1, limit = 10 } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: "Search query (q) is required"
      });
    }

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    const searchRegex = new RegExp(q, "i");

    const filter = {
      status: "active",
      $or: [
        { name: searchRegex },
        { description: searchRegex },
        { "location.address": searchRegex },
        { "location.city": searchRegex },
        { "location.state": searchRegex },
        { "location.country": searchRegex },
        { amenities: { $in: [searchRegex] } },
        { services: { $in: [searchRegex] } }
      ]
    };

    const cafes = await cafeModel
      .find(filter)
      .select("-__v")
      .populate("themeCategoryId", "name image")
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    const total = await cafeModel.countDocuments(filter);

    return res.status(200).json({
      success: true,
      message: "Search results fetched successfully",
      query: q,
      count: cafes.length,
      pagination: {
        current: pageNum,
        totalPages: Math.ceil(total / limitNum),
        totalResults: total,
      },
      result: cafes,
    });

  } catch (error) {
    console.error("Search Cafes Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};

const parseDate = (dateStr) => {
  const [day, month, year] = dateStr.split("-");
  return new Date(`${year}-${month}-${day}`);
};

export const mainSearchCafes = async (req, res) => {
  try {
    const {
      city,
      date,
      time,
      people,
      sortBy,
      priceMin,
      priceMax,
      rating,
      themeId,
      offer,
    } = req.query;

    if (!city || !date || !time) {
      return res.status(400).json({
        success: false,
        message: "City, date, and time are required fields.",
      });
    }

    const bookingDate = parseDate(date);

    const bookedCafes = await cafeBookingModel.find({
      bookingDate,
      timeSlot: time,
    }).distinct("cafeId");

    const query = {
      "location.city": { $regex: new RegExp(city, "i") },
      _id: { $nin: bookedCafes },
      status: "active",
    };

    if (people) query["pricing.discountPrice"] = { $exists: true };
    if (rating) query["averageRating"] = { $gte: Number(rating) };
    if (themeId) query.themeCategoryId = themeId;

    if (priceMin || priceMax) {
      query["pricing.discountPrice"] = {};
      if (priceMin) query["pricing.discountPrice"].$gte = Number(priceMin);
      if (priceMax) query["pricing.discountPrice"].$lte = Number(priceMax);
    }

    const sortOptions = {};
    switch (sortBy) {
      case "rating":
        sortOptions.averageRating = -1;
        break;
      case "price":
        sortOptions["pricing.discountPrice"] = 1;
        break;
      case "popular":
        sortOptions.popular = -1;
        break;
      default:
        sortOptions.createdAt = -1;
    }

    const cafes = await cafeModel
      .find(query)
      .sort(sortOptions)
      .limit(20)
      .select(
        "name description images averageRating pricing themeCategoryId location amenities popular"
      )
      .populate("themeCategoryId", "name image")
      .lean();

    return res.status(200).json({
      success: true,
      message: cafes.length
        ? "Cafés fetched successfully."
        : "No cafés available for selected time and filters.",
      result: cafes,
    });
  } catch (error) {
    console.error("Error searching cafés:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal Server Error",
    });
  }
};

export const cafeThemes = async (req, res) => {
  try {
    const themes = await cafeModel.aggregate([
      { $match: { status: "active" } },
      {
        $group: {
          _id: "$themeCategoryId",
        },
      },
      {
        $lookup: {
          from: "themecategories",
          localField: "_id",
          foreignField: "_id",
          as: "themeDetails"
        }
      },
      { $unwind: "$themeDetails" },
      {
        $project: {
          _id: 0,
          id: "$themeDetails._id",
          name: "$themeDetails.name",
          image: "$themeDetails.image"
        }
      },
      { $sort: { name: 1 } },
    ]);

    return res.status(200).json({
      success: true,
      data: themes,
    });
  } catch (error) {
    console.error("Cafe Themes Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

export const getCafesByTheme = async (req, res) => {
  try {
    const { theme } = req.query;

    if (!theme || !mongoose.Types.ObjectId.isValid(theme)) {
      return res.status(400).json({ success: false, message: "Valid Theme ID is required" });
    }

    const cafes = await cafeModel.find({
      themeCategoryId: theme,
      status: "active"
    }).select("-__v").populate("themeCategoryId", "name image");

    return res.status(200).json({
      success: true,
      count: cafes.length,
      data: cafes
    });
  } catch (error) {
    console.error("Get Cafes by Theme Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};

export const addCafeImages = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid cafe ID" });
    }

    const cafe = await cafeModel.findById(id);
    if (!cafe) {
      return res.status(404).json({ success: false, message: "Cafe not found" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: "No images provided" });
    }

    if ((cafe.images.length + req.files.length) > 10) {
      return res.status(400).json({ success: false, message: "Maximum 10 images allowed per cafe" });
    }

    const newImageUrls = [];
    for (const file of req.files) {
      const resized = await resizeImage(file.buffer, { width: 1024, height: 768, quality: 80 });
      const url = await uploadToS3(resized, `cafes/${Date.now()}_${file.originalname}`, file.mimetype, "cafes");
      newImageUrls.push(url);
    }

    cafe.images = [...cafe.images, ...newImageUrls];
    await cafe.save();

    return res.status(200).json({
      success: true,
      message: "Images added successfully",
      data: cafe.images
    });
  } catch (error) {
    console.error("Add Cafe Images Error:", error);
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

export const removeCafeImage = async (req, res) => {
  try {
    const { id, imageUrl } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid cafe ID" });
    }

    const cafe = await cafeModel.findById(id);
    if (!cafe) {
      return res.status(404).json({ success: false, message: "Cafe not found" });
    }

    if (!cafe.images.includes(imageUrl)) {
      return res.status(404).json({ success: false, message: "Image not found in cafe gallery" });
    }

    const key = imageUrl.split(".amazonaws.com/")[1];
    if (key) {
      await deleteFromS3(key).catch(err => log.warn("Failed to delete from S3:", err.message));
    }

    cafe.images = cafe.images.filter(img => img !== imageUrl);
    await cafe.save();

    return res.status(200).json({
      success: true,
      message: "Image removed successfully",
      data: cafe.images
    });
  } catch (error) {
    console.error("Remove Cafe Image Error:", error);
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};