import hotelModel from "../model/hotel.model.js";
import cafeModel from "../model/cafe.model.js";
import restroModel from "../model/restro.model.js";
import stayModel from "../model/stay.model.js";
import { sendBadRequest, sendSuccess, sendError } from "../utils/responseUtils.js";
import mongoose from "mongoose";
import watchListModel from "../model/watchlist.model.js";

export const getFilteredResults = async (req, res) => {
    try {
        const {
            businessType,
            city,
            minPrice,
            maxPrice,
            rating,
            amenities,
            sortBy,
            sortOrder = 'desc',
            page = 1,
            limit = 10
        } = req.query;

        if (!businessType) {
            return sendBadRequest(res, "businessType is required (Hotel, Cafe, Restro, Stay)");
        }

        let model;
        let query = {};
        let priceField = "actualPrice";
        let ratingField = "averageRating";
        let cityField = "city";

        switch (businessType.toLowerCase()) {
            case 'hotel':
                model = hotelModel;
                cityField = "address.city";
                break;
            case 'cafe':
                model = cafeModel;
                priceField = "pricing.actualPrice";
                cityField = "location.city";
                break;
            case 'restro':
                model = restroModel;
                break;
            case 'stay':
                model = stayModel;
                break;
            default:
                return sendBadRequest(res, "Invalid businessType. Must be Hotel, Cafe, Restro, or Stay");
        }

        if (city) {
            query[cityField] = { $regex: city, $options: 'i' };
        }

        if (minPrice || maxPrice) {
            query[priceField] = {};
            if (minPrice) query[priceField].$gte = Number(minPrice);
            if (maxPrice) query[priceField].$lte = Number(maxPrice);
        }

        if (rating) {
            query[ratingField] = { $gte: Number(rating) };
        }

        if (amenities) {
            const amenitiesArray = Array.isArray(amenities) ? amenities : amenities.split(',');
            query.amenities = { $all: amenitiesArray.map(a => a.trim()) };
        }

        if (businessType.toLowerCase() === 'hotel') {
        } else if (businessType.toLowerCase() === 'stay') {
            query.isActive = true;
        } else {
            query.status = 'active';
        }

        let sortOptions = {};
        if (sortBy === 'price') {
            sortOptions[priceField] = sortOrder === 'desc' ? -1 : 1;
        } else if (sortBy === 'rating') {
            sortOptions[ratingField] = sortOrder === 'desc' ? -1 : 1;
        } else if (sortBy === 'newest') {
            sortOptions.createdAt = -1;
        } else {
            sortOptions.createdAt = -1;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const results = await model.find(query)
            .sort(sortOptions)
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const total = await model.countDocuments(query);

        if (req.user?._id) {
            const watchlist = await watchListModel.findOne({ userId: req.user._id });
            if (watchlist) {
                const bType = businessType.toLowerCase();
                const watchlistArray = bType === 'hotel' ? watchlist.hotels :
                                       bType === 'restro' ? watchlist.restro :
                                       bType === 'cafe' ? watchlist.cafe :
                                       bType === 'hall' ? watchlist.hall : [];
                
                const favoriteIds = watchlistArray.map(id => id.toString());
                results.forEach(item => {
                    item.isFavorite = favoriteIds.includes(item._id.toString());
                });
            } else {
                results.forEach(item => item.isFavorite = false);
            }
        } else {
            results.forEach(item => item.isFavorite = false);
        }

        return sendSuccess(res, `${businessType} filtered successfully`, {
            results,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error("Filter Error:", error);
        return sendError(res, "Internal server error while filtering", error);
    }
};
