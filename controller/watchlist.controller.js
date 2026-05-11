import watchListModel from "../model/watchlist.model.js";
import log from "../utils/logger.js"
import { sendError, sendSuccess } from "../utils/responseUtils.js";

export const addToWatchlist = async (req, res) => {
  try {
    const { hotel, cafe, restro, hall, event } = req.query;
    const userId = req.user?._id;

    if (!hotel && !cafe && !restro && !hall && !event) {
      return res.status(400).json({
        success: false,
        message: "At least one item (hotel, cafe, restro, hall, event) is required",
      });
    }

    const addToSet = {};
    if (hotel) addToSet.hotels = hotel;
    if (cafe) addToSet.cafe = cafe;
    if (restro) addToSet.restro = restro;
    if (hall) addToSet.hall = hall;
    if (event) addToSet.event = event;

    const watchlist = await watchListModel.findOneAndUpdate(
      { userId },
      { $addToSet: addToSet },
      { new: true, upsert: true }
    ).populate("hotels cafe restro hall event");

    return sendSuccess(res, "Watchlist updated successfully", watchlist);
  } catch (error) {
    log.error(error.message);
    return sendError(res, 500, "Failed to add to watchlist", error);
  }
};

export const getMyWatchlist = async (req, res) => {
  try {
    const userId = req.user?._id;
    const watchlist = await watchListModel.findOne({ userId })
      .populate("hotels")
      .populate("cafe")
      .populate("restro")
      .populate("hall")
      .populate("event");

    if (!watchlist) {
      return sendSuccess(res, "No watchlist found", {
        hotel: [],
        cafe: [],
        restaurant: [],
        hall: [],
        event: []
      });
    }

    const formatItem = (item, type) => {
      if (!item) return null;
      
      let formatted = {
        _id: item._id,
        name: item.name || item.eventName || item.title || "",
        image: item.images?.[0] || item.image || item.eventImage || "",
        rating: item.averageRating || item.rating || 0,
        price: 0,
        currency: "INR",
        location: ""
      };

      
      if (type === "hotel") {
        formatted.location = item.address?.city || "";
        formatted.price = item.discountPrice || item.actualPrice || 0;
        formatted.priceLabel = "/night";
      } else if (type === "cafe") {
        formatted.location = item.location?.city || "";
        formatted.price = item.pricing?.discountPrice || item.pricing?.actualPrice || 0;
        formatted.priceLabel = "/hr";
      } else if (type === "restro") {
        formatted.location = item.city || "";
        formatted.price = item.discountPrice || item.actualPrice || 0;
        formatted.priceLabel = "/hr";
      } else if (type === "hall") {
        formatted.location = item.location || item.address || "";
        formatted.price = item.discountPrice || item.actualPrice || 0;
        formatted.priceLabel = "/event";
      } else if (type === "event") {
        formatted.location = item.addresss || item.location || "";
        formatted.price = item.price || 0;
        formatted.priceLabel = "/ticket";
      }

      return formatted;
    };

    const result = {
      hotel: (watchlist.hotels || []).map(h => formatItem(h, "hotel")).filter(Boolean),
      cafe: (watchlist.cafe || []).map(c => formatItem(c, "cafe")).filter(Boolean),
      restaurant: (watchlist.restro || []).map(r => formatItem(r, "restro")).filter(Boolean),
      hall: (watchlist.hall || []).map(h => formatItem(h, "hall")).filter(Boolean),
      event: (watchlist.event || []).map(e => formatItem(e, "event")).filter(Boolean)
    };

    
    const summary = {
      hotel: result.hotel.length,
      cafe: result.cafe.length,
      restaurant: result.restaurant.length,
      hall: result.hall.length,
      event: result.event.length,
      total: result.hotel.length + result.cafe.length + result.restaurant.length + result.hall.length + result.event.length
    };

    return res.status(200).json({
      success: true,
      message: "Watchlist fetched successfully",
      summary,
      result
    });

  } catch (error) {
    log.error(error.message);
    return sendError(res, 500, "Failed to fetch watchlist", error.message);
  }
};

export const removeWatchlistItem = async (req, res) => {
  try {
    const { hotel, cafe, restro, hall, event } = req.query;
    const userId = req.user?._id;

    if (!hotel && !cafe && !restro && !hall && !event) {
      return res.status(400).json({ 
        success: false, 
        message: "At least one item (hotel, cafe, restro, hall, event) is required to remove" 
      });
    }

    
    const update = { $pull: {} };
    
    if (hotel) update.$pull.hotels = hotel;
    if (cafe) update.$pull.cafe = cafe;
    if (restro) update.$pull.restro = restro;
    if (hall) update.$pull.hall = hall;
    if (event) update.$pull.event = event;

    
    const watchlist = await watchListModel.findOneAndUpdate(
      { userId },
      update,
      { new: true }
    ).populate("hotels cafe restro hall event");

    if (!watchlist) {
      return res.status(404).json({ 
        success: false, 
        message: "Watchlist not found for this user" 
      });
    }

    return sendSuccess(res, "Item(s) removed from watchlist successfully", watchlist);
  } catch (error) {
    log.error(error.message);
    return sendError(res, 500, "Failed to remove item from watchlist", error);
  }
};

export const getWatchlistByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const userId = req.user?._id;

    const validCategories = ['hotels', 'cafe', 'restro', 'hall', 'event'];
    
    if (!validCategories.includes(category)) {
      return res.status(400).json({
        success: false,
        message: "Invalid category. Must be one of: hotels, cafe, restro, hall, event"
      });
    }

    const watchlist = await watchListModel.findOne({ userId })
      .select(`${category} userId`)
      .populate(category);

    if (!watchlist) {
      return sendSuccess(res, `No ${category} found in watchlist`, []);
    }

    return sendSuccess(res, `${category} fetched successfully`, watchlist[category]);
  } catch (error) {
    log.error(error.message);
    return sendError(res, 500, `Failed to fetch ${category} from watchlist`, error);
  }
};

export const clearWatchlist = async (req, res) => {
  try {
    const userId = req.user?._id;

    const watchlist = await watchListModel.findOneAndUpdate(
      { userId },
      {
        $set: {
          hotels: [],
          cafe: [],
          restro: [],
          hall: [],
          event: []
        }
      },
      { new: true }
    );

    if (!watchlist) {
      return res.status(404).json({
        success: false,
        message: "Watchlist not found for this user"
      });
    }

    return sendSuccess(res, "Watchlist cleared successfully", watchlist);
  } catch (error) {
    log.error(error.message);
    return sendError(res, 500, "Failed to clear watchlist", error);
  }
};