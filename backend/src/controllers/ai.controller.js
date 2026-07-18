const { chat } = require("../ai/services/aiChatService");

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

module.exports = {
    chatWithAI,
};