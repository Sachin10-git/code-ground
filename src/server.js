const http = require("http");

const env = require("./config/env");

const logger = require("./utils/logger");

const app = require("./app");

/**
 * Create HTTP Server
 */
const server = http.createServer(app);

/**
 * Start Server
 */
server.listen(env.PORT, () => {

    logger.info(
        `🚀 Code Ground Backend running on http://localhost:${env.PORT}`
    );

});