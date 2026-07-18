const express = require("express");
const router = express.Router();

const { chatWithAI } = require("../controllers/ai.controller");

router.post("/chat", chatWithAI);

module.exports = router;