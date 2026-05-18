import express from 'express';
import { ForgotOtpSend, ResetPassword, VerifyOtp, changeUserPassword, deleteUser, getAllUsers, getUserById, getUserProfile, googleLogin, newUserRegister, updateUser, addUserAddress, getUserAddresses, updateAddress, deleteAddress, userLogin, userLogout, updateFcmToken } from '../controller/user.controller.js';
import { UserAuth } from '../middleware/UserAuth.js';
import { OptionalUserAuth } from '../middleware/OptionalUserAuth.js';
import { adminLogin, adminUpdate, deleteAdmin, getAdminById, getAllAdmins, newAdminRegister } from '../controller/admin.controller.js';
import { getWalletDetails, addMoneyToWallet, verifyWalletPayment } from '../controller/wallet.controller.js';
import { AdminAuth } from '../middleware/AdminAuth.js';
import { createNewHotel, deleteHotels, getAllHotels, getCitySuggestions, getHotelByCityName, getHotelById, mainSearchHotels, searchHotels, updateHotel } from '../controller/hotel.controller.js';
import { handleMulterErrors, processAndUploadImages, uploadFiles } from '../middleware/multer.middleware.js';
import { cancelHotelBooking, createBooking, getMyHotelBookings, hotelAdminBookings, previewHotelBooking, updateHotelBookingStatus, updateHotelPaymentStatus, } from '../controller/hotel.booking.controller.js';
import { deleteFromS3, listAllS3Images, upload } from '../middleware/uploadS3.js';
import log from '../utils/logger.js'
import { addToWatchlist, getMyWatchlist, removeWatchlistItem } from '../controller/watchlist.controller.js';
import { addCafeImages, cafeThemes, createNewCafe, deleteCafe, getAllCafes, getCafeById, getCafesByLocation, getCafesByTheme, getPopularCafes, mainSearchCafes, removeCafeImage, searchCafes, updateCafe } from '../controller/cafe.controller.js';
import { cancelBooking, createCafeBooking, getBookingById, getCafeBookings, getUserBookings, previewCafeBooking, updateBookingStatus, updatePaymentStatus } from '../controller/cafe.booking.controller.js';
import { createNewRestaurant, deleteRestaurant, filterRestaurants, getAllRestos, getSingleRestro, restroChangeStatus, searchRestaurants, updateRestaurant, addRestroImages, removeRestroImage, getRestrosByTheme, getPopularRestros } from '../controller/restro.controller.js';
import { validateRestroDuplicate } from '../middleware/validateRestroDuplicate.js';
import { sendBadRequest, sendError, sendSuccess } from '../utils/responseUtils.js';
import { cancelStayBooking, createStayBooking, getAdminStayBookings, getStayBookingById, getUserStayBookings, previewStayBooking, searchStay, updateStayBookingStatus, updateStayPaymentStatus } from '../controller/stay.booking.controller.js';
import { getAllCountries, getCityByCountry, getHotelByCity } from '../controller/activity.controller.js';
import { addReview, deleteReview, getAllReviews, getBusinessReviews, getUserReviews, likeReview, dislikeReview } from '../controller/review.controller.js';
import { cancelRestaurantBooking, createRestaurantBooking, getRestaurantBookings, getUserRestaurantBookings, updateRestaurantBookingStatus, updateRestaurantPaymentStatus, previewRestroBooking, getRestaurantBookingById } from '../controller/restro.booking.controller.js';
import { createHall, deleteHall, getAllHalls, getHallById, getPopularHalls, getPreviewBillingOfHall, updateHall } from '../controller/hall.controller.js';
import { cancelHallBooking, checkInGuest as hallCheckIn, checkOutGuest as hallCheckOut, createHallBooking, getHallBookingById, getHallBookingStatistics, getHallBookings, getUserHallBookings, updateHallBookingStatus, updateHallPaymentStatus } from '../controller/hall.booking.controller.js';
import { addNewEvent, bulkDeleteEvents, deleteEvent, getAllEvents, getEventById, getEventStats, searchEvents, filterEvents, updateEvent } from '../controller/event.controller.js';
import { addNewFeaturedEvent, getAllFeaturedEvents, getFeaturedEventById, updateFeaturedEvent, deleteFeaturedEvent } from "../controller/featured.event.controller.js";
import { createTour, deleteTour, getAllTours, getBestOfferTours, getTourById, updateTour, updateTourImage, uploadTourImage } from '../controller/tour.controller.js';
import { createCoupan, deleteCoupan, getAllCoupans, getCoupanById, toggleCoupanStatus, updateCoupan, applyCoupon, removeCoupon } from '../controller/coupan.controller.js';
import { createOffer, deleteOffer, getAllOffers, getOfferById, toggleOfferStatus, updateOffer } from '../controller/offer.controller.js';
import { getMyPaymentsAndRefunds } from '../controller/payments.controller.js';
import { downloadBookingInvoice } from '../controller/invoice.controller.js';
import { getTrendingDestinations, WhatsNew, getCoffeeDates, getBrowseByPropertyTypes, getSpecialOffers, getLuxuryStays } from '../controller/home.controller.js';
import { createNotification, deleteMyNotification, deleteNotification, getAllNotifications, getMyNotifications, getNotificationById, getNotificationSettings, markAsRead, updateNotification, updateNotificationSettings } from '../controller/notification.controller.js';
import { createStay, deleteStay, getAllStays, getAdminStays, getStayById, updateStay } from '../controller/stay.controller.js';
import { createThemeCategory, deleteThemeCategory, getAllThemeCategories, getThemeCategory, getThemesByArea, updateThemeCategory } from '../controller/themeCategory.controller.js';
import { getMyBookingsUnified } from '../controller/my.bookings.controller.js';
import { getFilteredResults } from '../controller/filter.controller.js';
import { createFaq, deleteFaq, getAllFaqs, getFaqById, updateFaq } from '../controller/faq.controller.js';

const indexRouter = express.Router();

indexRouter.post("/userRegister", newUserRegister);
indexRouter.post("/userLogin", userLogin);
indexRouter.post("/googleLogin", googleLogin);
indexRouter.post("/forgotOtp", ForgotOtpSend);
indexRouter.post("/verifyOtp", VerifyOtp);
indexRouter.post("/resetPassword", ResetPassword);
indexRouter.get("/getAllUsers", getAllUsers);
indexRouter.get("/getUserById/:id", getUserById);
indexRouter.put("/updateUser/:id", upload.single("avatar"), updateUser);

indexRouter.get("/filter", OptionalUserAuth, getFilteredResults);

indexRouter.post("/addAddress", UserAuth, addUserAddress);
indexRouter.get("/getAddresses", UserAuth, getUserAddresses);
indexRouter.put("/updateAddress/:addressId", UserAuth, updateAddress);
indexRouter.delete("/deleteAddress/:addressId", UserAuth, deleteAddress);
indexRouter.delete("/deleteUser/:id", deleteUser);

indexRouter.post("/changeUserPassword", UserAuth, changeUserPassword)
indexRouter.post("/logout", UserAuth, userLogout)
indexRouter.get("/userProfile", UserAuth, getUserProfile)
indexRouter.patch("/updateFcmToken", UserAuth, updateFcmToken);

indexRouter.get("/wallet", UserAuth, getWalletDetails);
indexRouter.post("/wallet/addMoney", UserAuth, addMoneyToWallet);
indexRouter.post("/wallet/verifyPayment", UserAuth, verifyWalletPayment);

indexRouter.post("/newAdminRegister", newAdminRegister);
indexRouter.post("/adminLogin", adminLogin);
indexRouter.get("/allAdmin", AdminAuth, getAllAdmins);
indexRouter.get("/getAdminById/:adminId", getAdminById);
indexRouter.patch("/adminUpdate/:adminId", adminUpdate);
indexRouter.delete("/deleteAdmin/:adminId", deleteAdmin);

indexRouter.get("/WhatsNew", OptionalUserAuth, WhatsNew)
indexRouter.get('/trending-destinations', getTrendingDestinations);
indexRouter.get('/coffee-dates', OptionalUserAuth, getCoffeeDates);
indexRouter.get('/browse-by-property-type', getBrowseByPropertyTypes);
indexRouter.get('/special-offers', getSpecialOffers);
indexRouter.get('/luxury-stays', OptionalUserAuth, getLuxuryStays);

indexRouter.post("/createNewHotel", AdminAuth, uploadFiles, handleMulterErrors, processAndUploadImages, createNewHotel);
indexRouter.get("/getAllHotels", OptionalUserAuth, getAllHotels);
indexRouter.get("/getHotelById/:hotelId", OptionalUserAuth, getHotelById);
indexRouter.patch("/updateHotel/:hotelId", AdminAuth, uploadFiles, handleMulterErrors, processAndUploadImages, updateHotel);
indexRouter.delete("/deleteHotel/:hotelId", AdminAuth, deleteHotels);
indexRouter.get("/getHotelByCityName/:name", OptionalUserAuth, getHotelByCityName);
indexRouter.get("/city-suggestions", getCitySuggestions);

indexRouter.post("/hotel/createBooking/:hotelId", UserAuth, createBooking);
indexRouter.post("/hotel/previewBooking/:hotelId", UserAuth, previewHotelBooking);
indexRouter.get("/hotel/MyBookings", UserAuth, getMyHotelBookings);
indexRouter.get("/HotelAdminBookings", AdminAuth, hotelAdminBookings);
indexRouter.patch("/hotel/updatePaymentStatus/:bookingId", AdminAuth, updateHotelPaymentStatus);
indexRouter.patch("/hotel/updateBookingStatus/:id", AdminAuth, updateHotelBookingStatus);
indexRouter.put("/hotel/cancel/:bookingId", UserAuth, cancelHotelBooking);

indexRouter.post("/addToWatchlist", UserAuth, addToWatchlist);
indexRouter.get("/getWatchlist", UserAuth, getMyWatchlist);
indexRouter.delete("/removeFromWatchlist", UserAuth, removeWatchlistItem);

indexRouter.get("/cafeThemes", cafeThemes);
indexRouter.get("/getCafesByTheme", OptionalUserAuth, getCafesByTheme);

indexRouter.post("/createThemeCategory", AdminAuth, upload.single("image"), createThemeCategory);
indexRouter.get("/getAllThemeCategories", getAllThemeCategories);
indexRouter.get("/getThemeCategory/:id", getThemeCategory);
indexRouter.get("/getThemesByArea", getThemesByArea);
indexRouter.put("/updateThemeCategory/:id", AdminAuth, upload.single("image"), updateThemeCategory);
indexRouter.delete("/deleteThemeCategory/:id", AdminAuth, deleteThemeCategory);

indexRouter.get("/getAllCafes", OptionalUserAuth, getAllCafes);
indexRouter.get("/search", OptionalUserAuth, searchCafes);
indexRouter.get("/mainSearchCafes", OptionalUserAuth, mainSearchCafes);
indexRouter.get("/location", OptionalUserAuth, getCafesByLocation);
indexRouter.get("/popular", OptionalUserAuth, getPopularCafes);
indexRouter.get("/getCafeById/:id", OptionalUserAuth, getCafeById);

indexRouter.post("/createCafe", AdminAuth, upload.any(), createNewCafe);
indexRouter.put("/updateCafe/:id", AdminAuth, upload.any(), updateCafe);
indexRouter.delete("/deleteCafe/:id", AdminAuth, deleteCafe);
indexRouter.post("/addCafeImage/:id/images", AdminAuth, upload.array('images', 10), addCafeImages);
indexRouter.delete("/removeCafeImage/:id/images/:imageUrl", AdminAuth, removeCafeImage);

indexRouter.post("/createCafeBooking/:cafeId", UserAuth, createCafeBooking);
indexRouter.get("/my-cafe-bookings", UserAuth, getUserBookings);
indexRouter.get("/getBookingById/:id", UserAuth, getBookingById);
indexRouter.put("/cancelBooking/:bookingId", UserAuth, cancelBooking);
indexRouter.post("/preview-booking/:cafeId", previewCafeBooking);
indexRouter.get("/cafe/:cafeId", AdminAuth, getCafeBookings);
indexRouter.put("/cafe/updateBookingStatus/:id", AdminAuth, updateBookingStatus);
indexRouter.put("/cafe/updatePaymentStatus/:id", AdminAuth, updatePaymentStatus);

indexRouter.post("/createNewRestro", AdminAuth, upload.array("images", 10), validateRestroDuplicate, createNewRestaurant);
indexRouter.get("/getAllRestros", OptionalUserAuth, getAllRestos);
indexRouter.get("/getRestroById/:id", OptionalUserAuth, getSingleRestro);

indexRouter.put("/updateRestro/:id", AdminAuth, upload.array("images", 10), updateRestaurant);
indexRouter.post("/addRestroImage/:id/images", AdminAuth, upload.array('images', 10), addRestroImages);
indexRouter.delete("/removeRestroImage/:id/images/:imageUrl", AdminAuth, removeRestroImage);
indexRouter.delete("/deleteRestro/:id", AdminAuth, deleteRestaurant);
indexRouter.get("/resto/filter/advanced", OptionalUserAuth, filterRestaurants);
indexRouter.get("/restro/search", OptionalUserAuth, searchRestaurants);
indexRouter.get("/restro/changeStatus/:id", AdminAuth, restroChangeStatus);
indexRouter.get("/restro/popular", OptionalUserAuth, getPopularRestros);
indexRouter.get("/getRestrosByTheme", OptionalUserAuth, getRestrosByTheme);

indexRouter.post("/restro/preview-booking/:restaurantId", previewRestroBooking);
indexRouter.post("/createRestroBooking/:restaurantId", UserAuth, createRestaurantBooking);
indexRouter.get("/my-restro-bookings", UserAuth, getUserRestaurantBookings);
indexRouter.get("/getRestaurantBookingById/:bookingId", getRestaurantBookingById);
indexRouter.put("/cancelRestroBooking/:bookingId", UserAuth, cancelRestaurantBooking);

indexRouter.get("/restro/:restroId", AdminAuth, getRestaurantBookings);
indexRouter.put("/updateRestroBookingStatus/:bookingId", AdminAuth, updateRestaurantBookingStatus);
indexRouter.put("/updateRestroPaymentStatus/:bookingId", AdminAuth, updateRestaurantPaymentStatus);

indexRouter.get('/getAllHalls', OptionalUserAuth, getAllHalls);
indexRouter.get('/getPopularHalls', OptionalUserAuth, getPopularHalls);
indexRouter.get('/getHallById/:id', OptionalUserAuth, getHallById);
indexRouter.post("/preview/billing/:hallId", UserAuth, getPreviewBillingOfHall)

indexRouter.post("/createHall", AdminAuth, upload.fields([
  { name: "image", maxCount: 1 },
  { name: "featured", maxCount: 1 },
  { name: "images", maxCount: 1 }
]), createHall);

indexRouter.put('/updateHall/:id', AdminAuth, upload.any(), updateHall);
indexRouter.delete('/deleteHall/:id', AdminAuth, deleteHall);
indexRouter.post('/createHallBooking/:hallId', UserAuth, createHallBooking);
indexRouter.get('/myHallbookings', UserAuth, getUserHallBookings);
indexRouter.get('/getHallBookingById/:id', UserAuth, getHallBookingById);
indexRouter.put('/cancelHallBooking/:id', UserAuth, cancelHallBooking);

indexRouter.get("/admin/hallBookingStatistics", AdminAuth, getHallBookingStatistics);
indexRouter.get("/admin/hallBookings", AdminAuth, getHallBookings);
indexRouter.patch("/updateHallBookingStatus/:id", AdminAuth, updateHallBookingStatus);
indexRouter.patch("/updateHallPaymentStatus/:id", AdminAuth, updateHallPaymentStatus);
indexRouter.patch("/admin/hall/check-in/:id", AdminAuth, hallCheckIn);

indexRouter.patch("/admin/hall/check-out/:id", AdminAuth, hallCheckOut);
indexRouter.get('/admin/getHallBookingById/:id', AdminAuth, getHallBookingById);

indexRouter.get("/allCountries", getAllCountries)
indexRouter.get("/getCityByCountry/:country", getCityByCountry);
indexRouter.get("/getHotelByCity/:city", OptionalUserAuth, getHotelByCity);
indexRouter.get("/searchHotels", OptionalUserAuth, searchHotels)
indexRouter.get("/mainSearchHotels", OptionalUserAuth, mainSearchHotels)

indexRouter.get("/getAllFeaturedEvents", OptionalUserAuth, getAllFeaturedEvents);
indexRouter.get("/getFeaturedEventById/:id", OptionalUserAuth, getFeaturedEventById);
indexRouter.post("/addNewFeaturedEvent", AdminAuth, upload.fields([{ name: 'image', maxCount: 1 }]), addNewFeaturedEvent);
indexRouter.put("/updateFeaturedEvent/:id", AdminAuth, upload.fields([{ name: 'image', maxCount: 1 }]), updateFeaturedEvent);
indexRouter.delete("/deleteFeaturedEvent/:id", AdminAuth, deleteFeaturedEvent);

indexRouter.get("/getAllEvents", OptionalUserAuth, getAllEvents);
indexRouter.get("/searchEvents", OptionalUserAuth, searchEvents);
indexRouter.get("/filterEvents", OptionalUserAuth, filterEvents);
indexRouter.get("/getEventStats", getEventStats);
indexRouter.get("/getEventById/:id", OptionalUserAuth, getEventById);
indexRouter.post("/addNewEvent", AdminAuth, upload.fields([{ name: 'eventImage', maxCount: 1 }]), addNewEvent);
indexRouter.put("/updateEvent/:id", AdminAuth, upload.fields([{ name: 'eventImage', maxCount: 1 }]), updateEvent);
indexRouter.delete("/deleteEvent/:id", AdminAuth, deleteEvent);
indexRouter.post("/bulk-delete", UserAuth, bulkDeleteEvents);

indexRouter.post("/createNewTour", uploadTourImage, AdminAuth, createTour);
indexRouter.get("/getAllTours", AdminAuth, getAllTours);
indexRouter.get("/tour/best-offers", getBestOfferTours);
indexRouter.get("/getTourById/:id", getTourById);
indexRouter.put("/updateTour/:id", uploadTourImage, AdminAuth, updateTour);
indexRouter.patch("/updateTourImage/:id", uploadTourImage, updateTourImage);
indexRouter.delete("/deleteTour/:id", deleteTour);

indexRouter.get("/payments-and-refunds", UserAuth, getMyPaymentsAndRefunds);
indexRouter.get("/myBookings/unified", UserAuth, getMyBookingsUnified);
indexRouter.get("/download-invoice/:id", UserAuth, downloadBookingInvoice);

indexRouter.get("/business/:businessId", getBusinessReviews);

indexRouter.post("/addReview/:businessId", UserAuth, upload.fields([{ name: 'media', maxCount: 10 }]), addReview);
indexRouter.get("/myReview", UserAuth, getUserReviews);
indexRouter.delete("/review/delete/:reviewId", AdminAuth, deleteReview);
indexRouter.get("/review/business/:businessId", getBusinessReviews);
indexRouter.post("/review/like/:reviewId", UserAuth, likeReview);
indexRouter.post("/review/dislike/:reviewId", UserAuth, dislikeReview);
indexRouter.get("/getAllReviews", getAllReviews);

indexRouter.post("/createCoupan", AdminAuth, createCoupan);
indexRouter.get("/getAllCoupans", getAllCoupans);
indexRouter.get("/getCoupanById/:id", getCoupanById);
indexRouter.put("/updateCoupan/:id", AdminAuth, updateCoupan);
indexRouter.delete("/deleteCoupan/:id", AdminAuth, deleteCoupan);
indexRouter.patch("/toggleCoupanStatus/:id", AdminAuth, toggleCoupanStatus);
indexRouter.post("/applyCoupon", UserAuth, applyCoupon);
indexRouter.post("/removeCoupon", UserAuth, removeCoupon);

indexRouter.post("/createOffer", AdminAuth, upload.single("backgroundImage"), createOffer);
indexRouter.get("/getAllOffers", getAllOffers);
indexRouter.get("/getOfferById/:id", getOfferById);
indexRouter.put("/updateOffer/:id", AdminAuth, upload.single("backgroundImage"), updateOffer);
indexRouter.delete("/deleteOffer/:id", AdminAuth, deleteOffer);
indexRouter.patch("/toggleOfferStatus/:id", AdminAuth, toggleOfferStatus);

indexRouter.post("/createStay", AdminAuth, upload.fields([{ name: "stayImage", maxCount: 5 }, { name: "images", maxCount: 5 }]), createStay);
indexRouter.put("/updateStay/:id", AdminAuth, upload.fields([{ name: "stayImage", maxCount: 5 }, { name: "images", maxCount: 5 }]), updateStay);
indexRouter.delete("/deleteStay/:id", AdminAuth, deleteStay);
indexRouter.get("/getAdminStays", AdminAuth, getAdminStays);

indexRouter.get("/admin/stayBookings", AdminAuth, getAdminStayBookings);
indexRouter.get("/admin/getStayBookingById/:id", AdminAuth, getStayBookingById);
indexRouter.patch("/updateStayBookingStatus/:id", AdminAuth, updateStayBookingStatus);
indexRouter.patch("/updateStayPaymentStatus/:id", AdminAuth, updateStayPaymentStatus);

indexRouter.get("/getAllStays", OptionalUserAuth, getAllStays);
indexRouter.get("/getStayById/:id", OptionalUserAuth, getStayById);
indexRouter.get("/searchStay", OptionalUserAuth, searchStay);
indexRouter.post("/stay/preview-booking/:stayId", UserAuth, previewStayBooking);
indexRouter.post("/createStayBooking/:stayId", UserAuth, createStayBooking);
indexRouter.get("/my-stay-bookings", UserAuth, getUserStayBookings);
indexRouter.get("/getStayBookingById/:id", UserAuth, getStayBookingById);
indexRouter.patch("/cancelStayBooking/:id", UserAuth, cancelStayBooking);

indexRouter.post("/createNotification", AdminAuth, createNotification);
indexRouter.get("/getAllNotifications", AdminAuth, getAllNotifications);
indexRouter.get("/getNotificationById/:id", getNotificationById);
indexRouter.put("/updateNotification/:id", AdminAuth, updateNotification);
indexRouter.delete("/deleteNotification/:id", AdminAuth, deleteNotification);

indexRouter.get("/my/notifications", UserAuth, getMyNotifications);
indexRouter.patch("/markNotificationAsRead/:id", UserAuth, markAsRead);
indexRouter.delete("/deleteMyNotification/:id", UserAuth, deleteMyNotification);
indexRouter.get("/myNotificationSettings", UserAuth, getNotificationSettings);
indexRouter.put("/updateMyNotificationSettings", UserAuth, updateNotificationSettings);

indexRouter.post("/createFaq", AdminAuth, createFaq);
indexRouter.get("/getAllFaqs", getAllFaqs);
indexRouter.get("/getFaqById/:id", getFaqById);
indexRouter.put("/updateFaq/:id", AdminAuth, updateFaq);
indexRouter.delete("/deleteFaq/:id", AdminAuth, deleteFaq);

indexRouter.get("/s3/list", async (req, res) => {
  try {
    const allUrls = await listAllS3Images();
    return res.status(200).json({ message: "S3 images listed successfully", total: allUrls.length, images: allUrls });
  } catch (error) {
    log.error("List S3 Images Error:" + error.message);
    return res.status(500).json({ message: "Failed to list S3 images", error: error.message });
  }
});

indexRouter.delete("/s3/delete", async (req, res) => {
  const { imageUrl } = req.body;
  if (!imageUrl) {
    return res.status(400).json({ message: "Image URL is required" });
  }
  try {
    const key = imageUrl.split(".amazonaws.com/")[1];
    await deleteFromS3(key);
    return res.status(200).json({ message: "Image deleted successfully from S3", imageUrl });
  }
  catch (error) {
    log.error("Delete S3 Image Error:" + error.message);
    return res.status(500).json({ message: "Failed to delete image from S3", error });
  }
});

indexRouter.delete("/s3/delete-multiple", async (req, res) => {
  try {
    const { images } = req.body;

    if (!Array.isArray(images) || images.length === 0) {
      return sendBadRequest(res, "Images array is required");
    }

    const keys = images
      .map(url => {
        const key = url.split(".amazonaws.com/")[1];
        return key || null;
      })
      .filter(Boolean);

    if (keys.length === 0) {
      return sendBadRequest(res, "No valid S3 keys found in images array");
    }

    const results = await Promise.allSettled(keys.map((key) => deleteFromS3(key)));

    const success = [];
    const failed = [];

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        success.push(keys[index]);
      } else {
        failed.push({ key: keys[index], reason: result.reason.message });
      }
    });

    return sendSuccess(res, "S3 images deletion completed", { success, failed });
  } catch (error) {
    log.error("deleteMultipleImages Error:", error);
    return sendError(res, 500, "Failed to delete images", error.message);
  }
});

export default indexRouter;