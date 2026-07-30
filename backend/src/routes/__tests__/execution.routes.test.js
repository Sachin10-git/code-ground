const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const executionRoutes = require("../execution.routes");
const notFound = require("../../middleware/notFound");
const errorHandler = require("../../middleware/errorHandler");

// A minimal app that composes the real router + real middleware, without
// pulling in app.js's DB connection - this endpoint has no DB dependency,
// so the test shouldn't need one either.
function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/execution", executionRoutes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

describe("POST /api/execution/run", () => {
  let server;
  let baseUrl;

  before(async () => {
    const app = buildTestApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test("runs code successfully", { timeout: 30000 }, async () => {
    const res = await fetch(`${baseUrl}/api/execution/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "python", code: "print('Hello')" }),
    });

    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.exitCode, 0);
    assert.equal(body.data.stdout, "Hello");
    assert.equal(body.data.stderr, "");
    assert.equal(body.data.timedOut, false);
  });

  test("returns 400 for an unsupported language", async () => {
    const res = await fetch(`${baseUrl}/api/execution/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "cobol", code: "DISPLAY 'hi'." }),
    });

    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.success, false);
    assert.match(body.message, /Unsupported language/);
  });

  test("returns 400 for a missing language", async () => {
    const res = await fetch(`${baseUrl}/api/execution/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "print('hi')" }),
    });

    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.success, false);
    assert.match(body.message, /Language is required/);
  });

  test("returns 400 for missing code", async () => {
    const res = await fetch(`${baseUrl}/api/execution/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "python" }),
    });

    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.success, false);
    assert.match(body.message, /Code is required/);
  });
});
