import notificationModel from "../model/notification.model.js";
import userModel from "../model/user.model.js";
import mongoose from "mongoose";
import { uploadToS3, deleteFromS3 } from '../middleware/uploadS3.js';
import log from "../utils/logger.js";
import { sendSuccess, sendError, sendNotFound } from "../utils/responseUtils.js";

const timeAgo = (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " year ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " month ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " day ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " min ago";
    return Math.floor(seconds) + " sec ago";
};

export const getMyNotifications = async (req, res) => {
    try {
        const userId = req.user?._id;
        const { page = 1, limit = 50, type, isRead } = req.query;

        const userObjectId = new mongoose.Types.ObjectId(userId);

        const user = await userModel.findById(userId).select("notificationSettings");
        const settings = user?.notificationSettings || {
            newOffers: true,
            renewalOffers: true,
            announcements: true,
            newChatAlert: true
        };

        const disabledTypes = [];
        if (!settings.newOffers) disabledTypes.push("OFFER");
        if (!settings.renewalOffers) disabledTypes.push("RENEWAL_OFFER");
        if (!settings.announcements) {
            disabledTypes.push("SYSTEM");
            disabledTypes.push("ADMIN");
            disabledTypes.push("PROMOTION");
        }
        if (!settings.newChatAlert) disabledTypes.push("CHAT");

        const filter = {
            $and: [
                {
                    $or: [
                        { userId: userObjectId },
                        { isForAllUsers: true }
                    ]
                },
                {
                    $or: [
                        { expiresAt: null },
                        { expiresAt: { $gt: new Date() } }
                    ]
                }
            ],
            deletedBy: { $ne: userObjectId },
            isActive: true,
        };

        if (type) {
            if (disabledTypes.includes(type)) {
                filter.type = "__DISABLED_TYPE__"; // This will ensure no results are found
            } else {
                filter.type = type;
            }
        } else if (disabledTypes.length > 0) {
            filter.type = { $nin: disabledTypes };
        }

        const notifications = await notificationModel
            .find(filter)
            .sort({ createdAt: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit))
            .lean();


        const processedNotifications = notifications.map(notification => {
            const read = notification.isForAllUsers
                ? notification.readBy.some(id => id.toString() === userId.toString())
                : notification.isRead;

            return {
                ...notification,
                isRead: read,
                timeAgo: timeAgo(notification.createdAt)
            };
        });


        let filtered = processedNotifications;
        if (isRead !== undefined) {
            const isReadBool = isRead === 'true';
            filtered = processedNotifications.filter(n => n.isRead === isReadBool);
        }


        const now = new Date();
        const todayStart = new Date(now.setHours(0, 0, 0, 0));
        const yesterdayStart = new Date(new Date(todayStart).setDate(todayStart.getDate() - 1));

        const result = {
            today: [],
            yesterday: [],
            older: []
        };

        filtered.forEach(notification => {
            const createdDate = new Date(notification.createdAt);
            if (createdDate >= todayStart) {
                result.today.push(notification);
            } else if (createdDate >= yesterdayStart) {
                result.yesterday.push(notification);
            } else {
                result.older.push(notification);
            }
        });

        const totalCount = await notificationModel.countDocuments(filter);
        const unreadCount = processedNotifications.filter(n => !n.isRead).length;

        return res.status(200).json({
            success: true,
            message: filtered.length ? "Notifications fetched successfully" : "No notifications found",
            unreadCount,
            totalCount,
            summary: {
                today: result.today.length,
                yesterday: result.yesterday.length,
                older: result.older.length
            },
            result
        });

    } catch (error) {
        log.error("getMyNotifications Error: " + error.message);
        return sendError(res, "Internal server error", error);
    }

};

export const markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?._id;

        const notification = await notificationModel.findById(id);
        if (!notification) return sendNotFound(res, "Notification not found");

        if (notification.isForAllUsers) {
            if (!notification.readBy.includes(userId)) {
                notification.readBy.push(userId);
                await notification.save();
            }
        } else {
            if (notification.userId && notification.userId.toString() === userId.toString()) {
                notification.isRead = true;
                await notification.save();
            }
        }

        return sendSuccess(res, "Notification marked as read", notification);
    } catch (error) {
        log.error("markAsRead Error: " + error.message);
        return sendError(res, "Internal server error", error);
    }

};

export const createNotification = async (req, res) => {
    try {
        const { title, message, type, reference, expiresAt, sendToAll, userId } = req.body;
        let image = req.body.image || null;

        if (req.file) {
            image = await uploadToS3(req.file.buffer, req.file.originalname, req.file.mimetype, "notifications");
        }

        if (!title?.trim() || !message?.trim()) {
            return sendError(res, 400, "Title and message are required");
        }

        const isSendToAll = String(sendToAll) === 'true';

        if (!isSendToAll && !userId) {
            return sendError(res, 400, "userId is required when sendToAll is false");
        }

        let notification;
        if (isSendToAll) {
            notification = await notificationModel.createBulkNotification({
                type: type || "SYSTEM",
                title: title.trim(),
                message: message.trim(),
                image,
                subtitle: req.body.subtitle || null,
                bullets: req.body.bullets || [],
                price: req.body.price || 0,
                totalPrice: req.body.totalPrice || 0,
                emiLabel: req.body.emiLabel || null,
                reference: reference || null,
                expiresAt: expiresAt || null,
            });
        } else {
            const user = await userModel.findById(userId);
            if (!user) return sendNotFound(res, "User not found");

            const settings = user.notificationSettings;
            let isEnabled = true;
            if (type === "OFFER" && !settings?.newOffers) isEnabled = false;
            if (type === "RENEWAL_OFFER" && !settings?.renewalOffers) isEnabled = false;
            if (["SYSTEM", "ADMIN", "PROMOTION"].includes(type) && !settings?.announcements) isEnabled = false;
            if (type === "CHAT" && !settings?.newChatAlert) isEnabled = false;

            if (!isEnabled) {
                return res.status(200).json({
                    success: true,
                    message: "Notification skipped based on user settings"
                });
            }

            notification = await notificationModel.create({
                userId,
                isForAllUsers: false,
                type: type || "SYSTEM",
                title: title.trim(),
                message: message.trim(),
                image,
                subtitle: req.body.subtitle || null,
                bullets: req.body.bullets || [],
                price: req.body.price || 0,
                totalPrice: req.body.totalPrice || 0,
                emiLabel: req.body.emiLabel || null,
                reference: reference || null,
                expiresAt: expiresAt || null,
            });
        }

        return res.status(201).json({
            success: true,
            message: isSendToAll ? "Notification created for all users" : "Notification created successfully",
            notification
        });

    } catch (error) {
        log.error("createNotification Error: " + error.message);
        if (error.name === "ValidationError") {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({
                success: false,
                message: "Validation Error",
                errors: messages
            });
        }
        return sendError(res, "Internal server error", error);
    }

};

export const getAllNotifications = async (req, res) => {
    try {
        const notifications = await notificationModel
            .find()
            .populate("userId", "name email")
            .sort({ createdAt: -1 })
            .lean();

        return sendSuccess(res, "All notifications fetched successfully", notifications);
    } catch (error) {
        return sendError(res, "Internal server error", error);
    }

};

export const getNotificationById = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await notificationModel.findById(id).populate("userId", "name email");
        if (!notification) return sendNotFound(res, "Notification not found");

        return sendSuccess(res, "Notification fetched", notification);
    } catch (error) {
        return sendError(res, "Internal server error", error);
    }

};

export const updateNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = { ...req.body };

        const notification = await notificationModel.findById(id);
        if (!notification) return sendNotFound(res, "Notification not found");

        if (req.file) {
            if (notification.image) {
                const key = notification.image.split(".amazonaws.com/")[1];
                if (key) await deleteFromS3(key);
            }
            updates.image = await uploadToS3(req.file.buffer, req.file.originalname, req.file.mimetype, "notifications");
        }

        const updated = await notificationModel.findByIdAndUpdate(id, updates, { new: true });
        return sendSuccess(res, "Notification updated successfully", updated);
    } catch (error) {
        return sendError(res, "Internal server error", error);
    }

};

export const deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await notificationModel.findById(id);
        if (!notification) return sendNotFound(res, "Notification not found");

        if (notification.image) {
            const key = notification.image.split(".amazonaws.com/")[1];
            if (key) await deleteFromS3(key);
        }

        await notificationModel.findByIdAndDelete(id);
        return sendSuccess(res, "Notification deleted");
    } catch (error) {
        return sendError(res, "Internal server error", error);
    }

};

export const deleteMyNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?._id;

        const notification = await notificationModel.findById(id);
        if (!notification) return sendNotFound(res, "Notification not found");

        if (notification.isForAllUsers) {
            await notificationModel.findByIdAndUpdate(id, { $addToSet: { deletedBy: userId } });
            return sendSuccess(res, "Notification removed from your list");
        } else {
            if (notification.userId?.toString() !== userId.toString()) {
                return sendError(res, 403, "You are not authorized to delete this notification");
            }
            if (notification.image) {
                const key = notification.image.split(".amazonaws.com/")[1];
                if (key) await deleteFromS3(key);
            }
            await notificationModel.findByIdAndDelete(id);
            return sendSuccess(res, "Notification deleted successfully");
        }
    } catch (error) {
        return sendError(res, "Internal server error", error);
    }

};

export const getNotificationSettings = async (req, res) => {
    try {
        const userId = req.user?._id;
        const user = await userModel.findById(userId).select("notificationSettings");
        if (!user) return sendNotFound(res, "User not found");

        return sendSuccess(res, "Notification settings fetched", user.notificationSettings);
    } catch (error) {
        return sendError(res, "Internal server error", error);
    }
};

export const updateNotificationSettings = async (req, res) => {
    try {
        const userId = req.user?._id;
        const { newOffers, renewalOffers, announcements, newChatAlert } = req.body;

        const updates = {};
        if (newOffers !== undefined && newOffers !== "") updates["notificationSettings.newOffers"] = String(newOffers) === 'true';
        if (renewalOffers !== undefined && renewalOffers !== "") updates["notificationSettings.renewalOffers"] = String(renewalOffers) === 'true';
        if (announcements !== undefined && announcements !== "") updates["notificationSettings.announcements"] = String(announcements) === 'true';
        if (newChatAlert !== undefined && newChatAlert !== "") updates["notificationSettings.newChatAlert"] = String(newChatAlert) === 'true';

        const user = await userModel.findByIdAndUpdate(
            userId,
            { $set: updates },
            { new: true }
        ).select("notificationSettings");

        if (!user) return sendNotFound(res, "User not found");

        return sendSuccess(res, "Notification settings updated", user.notificationSettings);
    } catch (error) {
        return sendError(res, "Internal server error", error);
    }
};
