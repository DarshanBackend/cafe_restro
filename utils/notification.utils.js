/**
 * Universal Notification Sender Utility
 * -------------------------------------
 */

import notificationModel from "../model/notification.model.js";
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
