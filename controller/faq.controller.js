import mongoose from "mongoose";
import faqModel from "../model/faq.model.js";
import { sendBadRequest, sendError, sendNotFound, sendSuccess } from "../utils/responseUtils.js";

export const createFaq = async (req, res) => {
    try {
        const { question, answer } = req.body;
        const { _id: adminId } = req.admin;

        if (!question || !answer) {
            return sendBadRequest(res, "Question and answer are required");
        }

        const existingFaq = await faqModel.findOne({
            question: question.trim(),
            answer: answer.trim(),
            adminId
        });
        if (existingFaq) {
            return sendBadRequest(res, "A faq with this question and answer already exists");
        }

        const newFaq = await faqModel.create({
            question: question.trim(),
            answer: answer.trim(),
            adminId
        });

        return sendSuccess(res, "Faq created successfully", [newFaq]);
    } catch (err) {
        console.error("createFaq error:", err);
        return sendError(res, "Failed to create faq", err);
    }
}


export const getAllFaqs = async (req, res) => {
    try {
        const faqs = await faqModel.find();

        if (faqs.length === 0) {
            return sendNotFound(res, "Faqs not found");
        }

        return sendSuccess(res, "All faqs fetched successfully", faqs);
    } catch (error) {
        console.error("getAllFaqs error:", error);
        return sendError(res, "Failed to fetch faqs", error);
    }
}

export const getFaqById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequest(res, "Invalid faq ID");
        }

        const faq = await faqModel.findById(id);
        if (!faq) {
            return sendNotFound(res, "Faq not found");
        }

        return sendSuccess(res, "Faq fetched successfully", [faq]);
    } catch (error) {
        console.error("getFaqById error:", error);
        return sendError(res, "Failed to fetch faq", error);
    }
}

export const updateFaq = async (req, res) => {
    try {
        const { id } = req.params;
        const { question, answer } = req.body;
        const { _id: adminId } = req.admin;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequest(res, "Invalid faq ID");
        }

        const faq = await faqModel.findById(id);
        if (!faq) {
            return sendNotFound(res, "Faq not found");
        }

        const updatedFaq = await faqModel.findByIdAndUpdate(
            id,
            {
                question: question || faq.question,
                answer: answer || faq.answer,
                adminId
            },
            { new: true }
        );

        return sendSuccess(res, "Faq updated successfully", [updatedFaq]);
    } catch (error) {
        console.error("updateFaq error:", error);
        return sendError(res, "Failed to update faq", error);
    }
}

export const deleteFaq = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return sendBadRequest(res, "Invalid faq ID");
        }

        const faq = await faqModel.findById(id);
        if (!faq) {
            return sendNotFound(res, "Faq not found");
        }

        await faqModel.findByIdAndDelete(id);
        return sendSuccess(res, "Faq deleted successfully");
    } catch (error) {
        console.error("deleteFaq error:", error);
        return sendError(res, "Failed to delete faq", error);
    }
}