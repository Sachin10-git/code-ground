const express = require("express");

const helmet = require("helmet");

const cors = require("cors");

const compression = require("compression");

const cookieParser = require("cookie-parser");

const morgan = require("morgan");

const routes = require("./routes");

const notFound = require("./middleware/notFound");

const errorHandler = require("./middleware/errorHandler");

const app = express();

/**
 * -----------------------------
 * Global Middleware
 * -----------------------------
 */

app.use(helmet());

app.use(cors());

app.use(compression());

app.use(cookieParser());

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use(morgan("dev"));

/**
 * -----------------------------
 * Routes
 * -----------------------------
 */

app.use("/", routes);

/**
 * -----------------------------
 * 404 Handler
 * -----------------------------
 */

app.use(notFound);

/**
 * -----------------------------
 * Global Error Handler
 * -----------------------------
 */

app.use(errorHandler);

module.exports = app;