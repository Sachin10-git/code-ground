const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

/* SESSION_TIMEOUT_MS is read from process.env ONCE at module load, so
   this override must happen before the first require() of
   executionSession.service - this is why the timeout scenario gets its
   own file rather than living in executionSession.service.test.js.
   node --test runs each test file in its own process, so this doesn't
   affect the default 5-minute timeout the other test file relies on. */
process.env.EXECUTION_SESSION_TIMEOUT_MS = "2000";

const executionSession = require("../executionSession.service");
const { TERMINAL_EVENTS } = executionSession;

const { createFakeSocket, waitForEvent, waitForCondition } = require("./sessionTestHelpers");

describe("executionSession - timeout cleanup", () => {
  test("module picked up the overridden session timeout", () => {
    assert.equal(executionSession.SESSION_TIMEOUT_MS, 2000);
  });

  test("a session that never exits on its own is killed once SESSION_TIMEOUT_MS elapses", { timeout: 30000 }, async () => {
    const socket = createFakeSocket();

    const sessionId = executionSession.createSession({
      socket,
      language: "python",
      code: "import time\nwhile True:\n    time.sleep(1)",
    });

    await waitForEvent(socket, TERMINAL_EVENTS.READY);

    // Should be killed shortly after the 2s override, well before the
    // real 5-minute default would ever fire.
    const exitPayload = await waitForEvent(socket, TERMINAL_EVENTS.EXIT, { timeoutMs: 15000 });
    assert.equal(exitPayload.reason, "timeout");
    assert.equal(exitPayload.exitCode, 124);

    /* The EXIT event (just awaited above) is emitted BEFORE the
       session is removed from the internal registry - deliberately,
       so the client is notified as soon as possible rather than
       waiting on workspace cleanup first. That means immediately after
       observing EXIT, isOwnedBy() may briefly still read true; poll
       for it to settle instead of asserting it's already false. */
    await waitForCondition(() => !executionSession.isOwnedBy(sessionId, socket.id), { timeoutMs: 5000 });
  });
});
