/**
 * Universal Notification Sender Utility
 * -------------------------------------
 */

import notificationModel from "../model/notification.model.js";
import userModel from "../model/user.model.js";
import log from "../utils/logger.js";

export const sendNotification = async ({
  userId = null,
  isForAllUsers = false,
  title,
  message,
  image = null,
  type = "SYSTEM",
  reference = null,
  expiresAt = null,
  subtitle = null,
  bullets = [],
  price = 0,
  totalPrice = 0,
  emiLabel = null
}) => {
  try {
    if (!title || !message) {
      throw new Error("title and message are required fields.");
    }

    if (!isForAllUsers && userId) {
      const user = await userModel.findById(userId);
      if (user && user.notificationSettings) {
        const settings = user.notificationSettings;
        let isEnabled = true;

        if (type === "OFFER" && !settings.newOffers) isEnabled = false;
        if (type === "RENEWAL_OFFER" && !settings.renewalOffers) isEnabled = false;
        if (["SYSTEM", "ADMIN", "PROMOTION"].includes(type) && !settings.announcements) isEnabled = false;
        if (type === "CHAT" && !settings.newChatAlert) isEnabled = false;

        if (!isEnabled) {
          return { success: true, message: "Notification skipped based on user settings" };
        }
      }
    }

    const notificationData = {
      userId: isForAllUsers ? null : userId,
      isForAllUsers,
      title,
      message,
      image,
      type,
      reference,
      expiresAt,
      subtitle,
      bullets,
      price,
      totalPrice,
      emiLabel
    };

    const notification = await notificationModel.create(notificationData);

    // TODO: Integrate FCM push notification here if tokens are available

    return { success: true, message: "Notification created", notification };
  } catch (error) {
    log.error("Error sending notification: " + error.message);
    return { success: false, message: error.message };
  }
};
