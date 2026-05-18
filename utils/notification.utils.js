/**
 * Universal Notification Sender Utility
 * -------------------------------------
 */

import notificationModel from "../model/notification.model.js";
import userModel from "../model/user.model.js";
import log from "../utils/logger.js";
import { sendPushNotification, sendMulticastNotification } from "./notification.sender.js";

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

    let pushStatus = 'NOT_SENT';
    
    if (isForAllUsers) {
      try {
          const usersWithToken = await userModel.find({
              fcmToken: { $ne: null, $exists: true }
          }).select('fcmToken');
          const tokens = usersWithToken.map(u => u.fcmToken);
          if (tokens.length > 0) {
              await sendMulticastNotification(tokens, title, message, {
                  type: type || "SYSTEM",
                  image: image || "",
                  notificationId: notification._id.toString()
              });
              pushStatus = 'SENT_BULK';
          }
      } catch (pushError) {
          log.error("Failed to send bulk push notifications: " + pushError.message);
      }
    } else if (userId) {
      const user = await userModel.findById(userId).select("+fcmToken");
      if (user && user.fcmToken) {
          const sent = await sendPushNotification(user.fcmToken, title, message, {
              type: type || "SYSTEM",
              image: image || "",
              notificationId: notification._id.toString()
          });
          pushStatus = sent === true ? 'SENT' : sent === 'INVALID_TOKEN' ? 'INVALID_TOKEN' : 'FAILED';
      } else {
          pushStatus = 'NO_FCM_TOKEN';
      }
    }

    return { success: true, message: "Notification created", notification, pushStatus };
  } catch (error) {
    log.error("Error sending notification: " + error.message);
    return { success: false, message: error.message };
  }
};
