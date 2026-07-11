const http = require("http");

const env = require("./db/config/env");
const logger = require("./utils/logger");
const app = require("./app");

const { initializeSocket } = require("./socket/socketServer");

const server = http.createServer(app);

// Initialize Socket.IO
initializeSocket(server);

server.listen(env.PORT, () => {
  logger.info(
    `🚀 Code Ground Backend running on http://localhost:${env.PORT}`
  );
});