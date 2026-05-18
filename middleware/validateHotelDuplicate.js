import hotelModel from "../model/hotel.model.js";
import { sendBadRequest } from "../utils/responseUtils.js";
import log from "../utils/logger.js";

export const validateHotelDuplicate = async (req, res, next) => {
    try {
        let name = req.body?.name;

        if (typeof name === 'string' && name.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(name);
                name = parsed.name || name;
            } catch (e) {
                // Not JSON, use as is
            }
        }

        if (!name) {
            log.warn("Hotel name missing in request body:", req.body);
            return sendBadRequest(res, "Hotel name is required");
        }

        const nameStr = typeof name === 'string' ? name.trim() : String(name).trim();

        if (!nameStr) {
            return sendBadRequest(res, "Hotel name is required");
        }

        const existingHotel = await hotelModel.findOne({ name: nameStr });
        if (existingHotel) {
            return sendBadRequest(res, "Hotel already exists");
        }

        next();
    } catch (error) {
        log.error("Validate Hotel Duplicate Error:", error);
        log.error("Request body:", req.body);
        log.error("Error stack:", error.stack);
        return sendBadRequest(res, `Error validating hotel: ${error.message || 'Unknown error'}`);
    }
};

