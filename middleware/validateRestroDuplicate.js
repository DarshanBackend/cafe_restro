import restroModel from "../model/restro.model.js";
import { sendBadRequest } from "../utils/responseUtils.js";
import log from "../utils/logger.js";

export const validateRestroDuplicate = async (req, res, next) => {
    try {
        let name = req.body?.name;
        let address = req.body?.address;

        if (typeof name === 'string' && name.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(name);
                name = parsed.name || name;
            } catch (e) {
                // Not JSON, use as is
            }
        }

        if (!name) {
            log.warn("Restaurant name missing in request body:", req.body);
            return sendBadRequest(res, "Restaurant name is required");
        }

        const nameStr = typeof name === 'string' ? name.trim() : String(name).trim();

        if (!nameStr) {
            return sendBadRequest(res, "Restaurant name is required");
        }

        let parsedAddress = address;
        if (typeof address === 'string') {
            try {
                parsedAddress = JSON.parse(address);
            } catch (e) {
                log.warn("Failed to parse address:", address);
            }
        }

        const query = { name: nameStr };
        if (parsedAddress && parsedAddress.street) {
            query["address.street"] = parsedAddress.street.trim();
        }

        const existingRestaurant = await restroModel.findOne(query);
        if (existingRestaurant) {
            return sendBadRequest(res, "A restaurant with this name and address already exists");
        }

        next();
    } catch (error) {
        log.error("Validate Restro Duplicate Error:", error);
        log.error("Request body:", req.body);
        log.error("Error stack:", error.stack);
        return sendBadRequest(res, `Error validating restaurant: ${error.message || 'Unknown error'}`);
    }
};

