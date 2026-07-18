const { chat } = require("../ai/services/aiChatService");
const { explain } = require("../ai/services/aiExplainService");
const { review } = require("../ai/services/aiReviewService");
const { refactor } = require("../ai/services/aiRefactorService");
const { generate } = require("../ai/services/aiGenerateService");

const chatWithAI = async (req, res, next) => {

    try {

        const response = await chat({
            ...req.body,
            userId: req.user.id,
        });

        res.status(200).json({
            success: true,
            response,
        });

    } catch (error) {
        next(error);
    }

};

const explainCode = async (req, res, next) => {

    try {

        const response = await explain({
            ...req.body,
            userId: req.user.id,
        });

        res.status(200).json({
            success: true,
            response,
        });

    } catch (error) {
        next(error);
    }

};

const reviewCode = async (req, res, next) => {

    try {

        const response = await review({
            ...req.body,
            userId: req.user.id,
        });

        res.status(200).json({
            success: true,
            response,
        });

    } catch (error) {
        next(error);
    }

};

const refactorCode = async (req, res, next) => {

    try {

        const response = await refactor({
            ...req.body,
            userId: req.user.id,
        });

        res.status(200).json({
            success: true,
            response,
        });

    } catch (error) {
        next(error);
    }

};

const generateCode = async (req, res, next) => {

    try {

        const response = await generate({
            ...req.body,
            userId: req.user.id,
        });

        res.status(200).json({
            success: true,
            response,
        });

    } catch (error) {
        next(error);
    }

};

module.exports = {
    chatWithAI,
    explainCode,
    reviewCode,
    refactorCode,
    generateCode,
};