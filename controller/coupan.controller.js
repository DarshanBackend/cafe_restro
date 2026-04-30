import coupanModel from "../model/coupan.model.js";
import { sendNotification } from "../utils/notificatoin.utils.js";
import { sendBadRequest } from "../utils/responseUtils.js";

export const applyCoupon = async (req, res) => {
  try {
    const { couponCode, totalAmount } = req.body;

    if (!couponCode || totalAmount === undefined) {
      return res.status(400).json({ success: false, message: "couponCode and totalAmount are required" });
    }

    const coupon = await coupanModel.findOne({ couponCode: couponCode.toUpperCase() });

    if (!coupon) {
      return res.status(404).json({ success: false, message: "Invalid Coupon Code" });
    }

    if (!coupon.isActive) {
      return res.status(400).json({ success: false, message: "Coupon is not active" });
    }

    if (coupon.couponExpire && new Date(coupon.couponExpire) < new Date()) {
      return res.status(400).json({ success: false, message: "Coupon has expired" });
    }

    const discountPercentage = coupon.couponPerc || 0;
    const discountAmount = (Number(totalAmount) * discountPercentage) / 100;
    const finalAmount = Number(totalAmount) - discountAmount;

    return res.status(200).json({
      success: true,
      message: "Coupon applied successfully",
      data: {
        couponCode: coupon.couponCode,
        discountPercentage,
        discountAmount,
        finalAmount
      }
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createCoupan = async (req, res) => {
  try {
    const { coupanCode, coupanPerc, coupanExpire } = req.body;
    const adminId = req?.admin?._id;

    if (!req.body) {
      return sendBadRequest(res, "req.body Not found");
    }

    const existing = await coupanModel.findOne({
      couponCode: coupanCode.toUpperCase(),
    });
    if (existing) {
      return res
        .status(400)
        .json({ success: false, message: "Coupon code already exists" });
    }

    const newCoupan = await coupanModel.create({
      couponCode: coupanCode.toUpperCase(),
      couponPerc: coupanPerc,
      couponExpire: coupanExpire,
    });

    await sendNotification({
      adminId,
      title: `New Coupon Created: ${coupanCode}`,
      description: "Coupon code description",
      image: null,
      type: "broadcast",
    });

    res
      .status(201)
      .json({
        success: true,
        message: "Coupon created successfully",
        data: newCoupan,
      });
  } catch (error) {
    console.log("Error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};


export const getAllCoupans = async (req, res) => {
  try {
    const coupans = await coupanModel.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: coupans });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCoupanById = async (req, res) => {
  try {
    const coupan = await coupanModel.findById(req.params.id);
    if (!coupan) return res.status(404).json({ success: false, message: "Coupan not found" });

    res.status(200).json({ success: true, data: coupan });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCoupan = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await coupanModel.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!updated) return res.status(404).json({ success: false, message: "Coupan not found" });
    res.status(200).json({ success: true, message: "Coupan updated", data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCoupan = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await coupanModel.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: "Coupan not found" });

    res.status(200).json({ success: true, message: "Coupan deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


export const toggleCoupanStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const coupan = await coupanModel.findById(id);
    if (!coupan) return res.status(404).json({ success: false, message: "Coupan not found" });

    coupan.isActive = !coupan.isActive;
    await coupan.save();

    res.status(200).json({
      success: true,
      message: `Coupan is now ${coupan.isActive ? "Active" : "Inactive"}`,
      data: coupan,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
