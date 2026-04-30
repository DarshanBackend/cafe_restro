import mongoose from "mongoose";
import { deleteFromS3, resizeImage, uploadToS3 } from "../middleware/uploadS3.js";
import cafeModel from "../model/cafe.model.js";
import adminModel from "../model/admin.model.js";
import { sendNotification } from "../utils/notificatoin.utils.js";
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
      themeCategoryName,
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

    let validCafeThemeNames = ["Cazy", "Modern", "Rustic", "Vintage", "Industrial", "Minimalist"];

    if (!validCafeThemeNames.includes(themeCategoryName)) {
      return sendNotFound(
        res,
        `Valid theme names are: ${validCafeThemeNames.join(", ")}`
      );
    }


    if (!themeCategoryName?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Theme category name is required",
      });
    }

    // Check for duplicate cafe BEFORE uploading images
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

    let themeCategoryImageUrl = null;
    let imageUrls = [];

    if (req.files && req.files.length > 0) {
      // Separate theme category and main cafe images
      const themeImageFiles = req.files.filter(
        (file) => file.fieldname === "themeCategoryImage"
      );
      const cafeImageFiles = req.files.filter(
        (file) => file.fieldname === "images"
      );

      if (themeImageFiles.length > 0) {
        const themeImageFile = themeImageFiles[0];
        const allowedMimeTypes = [
          "image/jpeg",
          "image/jpg",
          "image/png",
          "image/webp",
        ];

        if (!allowedMimeTypes.includes(themeImageFile.mimetype)) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid theme category image type. Only JPEG, PNG, and WebP allowed.",
          });
        }

        try {
          const resizedBuffer = await resizeImage(themeImageFile.buffer, {
            width: 800,
            height: 600,
            quality: 80,
          });

          themeCategoryImageUrl = await uploadToS3(
            resizedBuffer,
            themeImageFile.originalname,
            themeImageFile.mimetype,
            "cafes/themes"
          );
        } catch (err) {
          console.error("Theme category image processing error:", err);
          return res.status(500).json({
            success: false,
            message: "Failed to process theme category image",
          });
        }
      }

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

    const themeCategory = {
      name: themeCategoryName.trim(),
      image: themeCategoryImageUrl,
    };


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
      themeCategory,
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

    // ✅ Append cafe ID to admin model
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


// Get cafe by ID
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
      .populate('createdBy', 'name email');

    if (!cafe) {
      return res.status(404).json({
        success: false,
        message: "Cafe not found"
      });
    }

    // Check if cafe is open now
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
      error: error.message
    });
  }
};

// Update cafe
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

    const updateData = {};

    // ✅ Parse text fields from FormData
    const {
      name,
      description,
      themeCategoryName,
      popular,
      actualPrice,
      discountPrice,
      currency,
      address,
      city,
      state,
      country,
      lat,
      lng,
      status,
      amenities,
      services,
      operatingHours,
      contact,
    } = req.body;

    if (name) updateData.name = name;
    if (description) updateData.description = description;
    if (status) updateData.status = status;
    if (popular !== undefined) updateData.popular = popular === "true";

    // ✅ Location
    updateData.location = {
      address: address || existingCafe.location?.address || "",
      city: city || existingCafe.location?.city || "",
      state: state || existingCafe.location?.state || "",
      country: country || existingCafe.location?.country || "",
      coordinates: {
        lat: parseFloat(lat) || existingCafe.location?.coordinates?.lat || 0,
        lng: parseFloat(lng) || existingCafe.location?.coordinates?.lng || 0,
      },
    };

    // ✅ Pricing
    updateData.pricing = {
      actualPrice: Number(actualPrice) || existingCafe.pricing?.actualPrice || 0,
      discountPrice: Number(discountPrice) || existingCafe.pricing?.discountPrice || 0,
      currency: currency || existingCafe.pricing?.currency || "INR",
    };

    // ✅ Handle JSON fields
    if (amenities) updateData.amenities = JSON.parse(amenities);
    if (services) updateData.services = JSON.parse(services);
    if (operatingHours) updateData.operatingHours = JSON.parse(operatingHours);
    if (contact) updateData.contact = JSON.parse(contact);

    // ✅ Handle themeCategory image upload
    if (req.files?.themeCategoryImage?.[0]) {
      const themeFile = req.files.themeCategoryImage[0];
      const resized = await resizeImage(themeFile.buffer, { width: 800, height: 600, quality: 80 });
      const themeUrl = await uploadToS3(
        resized,
        `cafes/themes/${Date.now()}_${themeFile.originalname}`,
        themeFile.mimetype,
        "cafes"
      );
      updateData.themeCategory = {
        name: themeCategoryName || existingCafe.themeCategory?.name || "",
        image: themeUrl,
      };
    } else if (themeCategoryName) {
      updateData.themeCategory = {
        name: themeCategoryName,
        image: existingCafe.themeCategory?.image || "",
      };
    }

    // ✅ Handle new cafe images
    if (req.files?.images?.length > 0) {
      const newImages = [];
      for (const file of req.files.images) {
        const resized = await resizeImage(file.buffer, { width: 1024, height: 768, quality: 80 });
        const url = await uploadToS3(
          resized,
          `cafes/${Date.now()}_${file.originalname}`,
          file.mimetype,
          "cafes"
        );
        newImages.push(url);
      }
      updateData.images = [...(existingCafe.images || []), ...newImages];
    }

    // ✅ Update the document
    const updatedCafe = await cafeModel
      .findByIdAndUpdate(id, { $set: updateData }, { new: true, runValidators: true })
      .select("-__v");

    return res.status(200).json({
      success: true,
      message: "Cafe updated successfully",
      data: updatedCafe,
    });
  } catch (error) {
    console.error("Update Cafe Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to update cafe",
      error: error.message,
    });
  }
};



// Delete cafe
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

    if (cafe.themeCategory?.image) {
      const key = cafe.themeCategory.image.split(".amazonaws.com/")[1];
      if (key) imagesToDelete.push(key);
    }

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


// Get cafes by location
export const getCafesByLocation = async (req, res) => {
  try {
    const { city, state, country, theme, status, minPrice, maxPrice, popular } = req.query;

    // Build dynamic filter
    const filter = {};

    if (city) filter["location.city"] = { $regex: new RegExp(city, "i") };
    if (state) filter["location.state"] = { $regex: new RegExp(state, "i") };
    if (country) filter["location.country"] = { $regex: new RegExp(country, "i") };

    if (theme) filter["themeCategory.name"] = { $regex: new RegExp(theme, "i") };
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


// Get popular cafes
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

// Search cafes
export const searchCafes = async (req, res) => {
  try {
    const { q, page = 1, limit = 10 } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: "Search query (q) is required"
      });
    }

    // Convert page & limit to numbers
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // 🔍 Smart flexible search filter
    const searchRegex = new RegExp(q, "i"); // Case-insensitive

    const filter = {
      status: "active",
      $or: [
        { name: searchRegex },
        { description: searchRegex },
        { "location.address": searchRegex },
        { "location.city": searchRegex },
        { "location.state": searchRegex },
        { "location.country": searchRegex },
        { "themeCategory.name": searchRegex },
        { amenities: { $in: [searchRegex] } },
        { services: { $in: [searchRegex] } }
      ]
    };

    // 🔹 Fetch results with pagination
    const cafes = await cafeModel
      .find(filter)
      .select("-__v")
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    // 🔹 Count total matching documents
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
      data: cafes,
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
      propertyType,
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
    if (propertyType)
      query["themeCategory.name"] = { $regex: new RegExp(propertyType, "i") };

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
        "name description images averageRating pricing themeCategory location amenities popular"
      )
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
          _id: "$themeCategory.name",
          image: { $first: "$themeCategory.image" },
        },
      },
      { $project: { _id: 0, name: "$_id", image: 1 } },
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

    if (!theme) {
      return res.status(400).json({
        success: false,
        message: "Theme name is required",
      });
    }

    const cafes = await cafeModel.find({
      "themeCategory.name": theme,
      status: "active",
    })
      .select("-__v")
      .populate("createdBy", "name email");

    return res.status(200).json({
      success: true,
      data: cafes,
      total: cafes.length,
    });
  } catch (error) {
    console.error("Get Cafes By Theme Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};




// Add cafe images
export const addCafeImages = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No images provided"
      });
    }

    const cafe = await cafeModel.findById(id);
    if (!cafe) {
      return res.status(404).json({
        success: false,
        message: "Cafe not found"
      });
    }

    // Check total images limit
    if (cafe.images.length + req.files.length > 10) {
      return res.status(400).json({
        success: false,
        message: "Maximum 10 images allowed per cafe"
      });
    }

    const newImageUrls = [];
    for (const file of req.files) {
      const resizedBuffer = await resizeImage(file.buffer, {
        width: 1024,
        height: 768,
        quality: 80
      });
      const url = await uploadToS3(
        resizedBuffer,
        `cafes/${Date.now()}-${file.originalname}`,
        file.mimetype,
        "cafes"
      );
      newImageUrls.push(url);
    }

    // Add new images to cafe
    cafe.images.push(...newImageUrls);
    await cafe.save();

    return res.status(200).json({
      success: true,
      message: "Images added successfully",
      data: {
        newImages: newImageUrls,
        totalImages: cafe.images.length
      }
    });

  } catch (error) {
    console.error("Add Cafe Images Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};

// Remove cafe image
export const removeCafeImage = async (req, res) => {
  try {
    const { id, imageUrl } = req.params;

    const cafe = await cafeModel.findById(id);
    if (!cafe) {
      return res.status(404).json({
        success: false,
        message: "Cafe not found"
      });
    }

    // Remove image from array
    cafe.images = cafe.images.filter(img => img !== imageUrl);
    await cafe.save();
    // Optionally, delete image from S3
    const key = imageUrl.split(".amazonaws.com/")[1];
    await deleteFromS3(key);

    return res.status(200).json({
      success: true,
      message: "Image removed successfully",
      data: {
        remainingImages: cafe.images.length
      }
    });

  } catch (error) {
    console.error("Remove Cafe Image Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message
    });
  }
};