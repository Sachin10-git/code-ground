const crypto = require("crypto");

/**
 * Shared helpers for executionSession.service.js tests. Not itself a
 * `*.test.js` file, so `node --test`'s glob (see package.json's
 * test:execution script) never tries to run it directly.
 */

function createFakeSocket(id = crypto.randomUUID()) {
  const events = [];
  return {
    id,
    events,
    emit(event, payload) {
      events.push({ event, payload });
    },
  };
}

function getEvents(socket, eventName) {
  return socket.events.filter((e) => e.event === eventName);
}

function waitForEvent(socket, eventName, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const found = socket.events.find((e) => e.event === eventName);
      if (found) return resolve(found.payload);
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timed out waiting for socket event "${eventName}"`));
      }
      setTimeout(check, 20);
    };
    check();
  });
}

function waitForCondition(fn, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      let value;
      try {
        value = fn();
      } catch (err) {
        return reject(err);
      }
      if (value) return resolve(value);
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("Timed out waiting for condition"));
      }
      setTimeout(check, 20);
    };
    check();
  });
}

function collectOutput(socket, sessionId) {
  return getEvents(socket, "terminal:output")
    .filter((e) => e.payload.sessionId === sessionId)
    .map((e) => e.payload.data)
    .join("");
}

module.exports = {
  createFakeSocket,
  getEvents,
  waitForEvent,
  waitForCondition,
  collectOutput,
};
