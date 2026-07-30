const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const executionSession = require("../executionSession.service");
const { TERMINAL_EVENTS } = executionSession;

const {
  createFakeSocket,
  getEvents,
  waitForEvent,
  waitForCondition,
  collectOutput,
} = require("./sessionTestHelpers");

/* The EXIT event is emitted BEFORE a session is removed from the
   internal registry (the client is notified as soon as possible,
   rather than waiting on workspace cleanup first) - so right after
   awaiting EXIT, isOwnedBy() may briefly still read true. Poll for it
   to settle instead of asserting it's already false. */
function assertEventuallyNotOwned(sessionId, socketId) {
  return waitForCondition(() => !executionSession.isOwnedBy(sessionId, socketId), { timeoutMs: 5000 });
}

const TEST_TIMEOUT = 30000;

describe("executionSession - session creation & output streaming", () => {
  test("creates a session, streams output live, and exits cleanly", { timeout: TEST_TIMEOUT }, async () => {
    const socket = createFakeSocket();

    const sessionId = executionSession.createSession({
      socket,
      language: "python",
      code: "print('Hello from session')",
    });

    assert.equal(typeof sessionId, "string");
    assert.ok(sessionId.length > 0);

    const readyPayload = await waitForEvent(socket, TERMINAL_EVENTS.READY);
    assert.equal(readyPayload.sessionId, sessionId);
    assert.equal(readyPayload.language, "python");

    const exitPayload = await waitForEvent(socket, TERMINAL_EVENTS.EXIT);
    assert.equal(exitPayload.sessionId, sessionId);
    assert.equal(exitPayload.exitCode, 0);
    assert.equal(exitPayload.reason, "completed");

    const output = collectOutput(socket, sessionId);
    assert.match(output, /Hello from session/);

    // Session must be fully removed from the active registry once exited.
    await assertEventuallyNotOwned(sessionId, socket.id);
  });

  test("output arrives incrementally, not buffered until exit", { timeout: TEST_TIMEOUT }, async () => {
    const socket = createFakeSocket();

    const sessionId = executionSession.createSession({
      socket,
      language: "python",
      code: "import sys, time\nfor i in range(3):\n    print(i)\n    sys.stdout.flush()\n    time.sleep(1)",
    });

    await waitForEvent(socket, TERMINAL_EVENTS.READY);

    // At least one OUTPUT event should already have arrived well before
    // the process has had time to finish all 3 iterations (~3s) - proof
    // this isn't waiting for the whole run to buffer before emitting.
    await waitForCondition(
      () => getEvents(socket, TERMINAL_EVENTS.OUTPUT).some((e) => e.payload.sessionId === sessionId),
      { timeoutMs: 2500 }
    );

    await waitForEvent(socket, TERMINAL_EVENTS.EXIT);
    const output = collectOutput(socket, sessionId);
    assert.match(output, /0/);
    assert.match(output, /1/);
    assert.match(output, /2/);
  });

  test("rejects an unsupported language without creating a container", async () => {
    const socket = createFakeSocket();

    const sessionId = executionSession.createSession({
      socket,
      language: "cobol",
      code: "DISPLAY 'hi'.",
    });

    const errorPayload = await waitForEvent(socket, TERMINAL_EVENTS.ERROR, { timeoutMs: 2000 });
    assert.match(errorPayload.message, /Unsupported language/);
    assert.equal(executionSession.isOwnedBy(sessionId, socket.id), false);
  });
});

describe("executionSession - stdin forwarding", () => {
  test("forwards input into a running session (python input())", { timeout: TEST_TIMEOUT }, async () => {
    const socket = createFakeSocket();

    const sessionId = executionSession.createSession({
      socket,
      language: "python",
      code: "name = input()\nprint('Hello, ' + name)",
    });

    await waitForEvent(socket, TERMINAL_EVENTS.READY);

    // Brief window for the interpreter to actually reach input() -
    // writing stdin before that would just sit in the container's
    // stdin buffer regardless, but this keeps the test deterministic.
    await new Promise((resolve) => setTimeout(resolve, 500));
    executionSession.writeInput(sessionId, "World\n");

    await waitForEvent(socket, TERMINAL_EVENTS.EXIT);

    const output = collectOutput(socket, sessionId);
    assert.match(output, /Hello, World/);
  });

  test("input written by a non-owning socket is ignored (multi-user isolation)", { timeout: TEST_TIMEOUT }, async () => {
    const owner = createFakeSocket();
    const intruder = createFakeSocket();

    const sessionId = executionSession.createSession({
      socket: owner,
      language: "python",
      code: "name = input()\nprint('Hello, ' + name)",
    });

    await waitForEvent(owner, TERMINAL_EVENTS.READY);

    assert.equal(executionSession.isOwnedBy(sessionId, owner.id), true);
    assert.equal(executionSession.isOwnedBy(sessionId, intruder.id), false);

    // Simulates terminalSocket.js's ownership guard rejecting the
    // write before it ever reaches executionSession.writeInput.
    if (executionSession.isOwnedBy(sessionId, intruder.id)) {
      executionSession.writeInput(sessionId, "Intruder\n");
    }

    executionSession.writeInput(sessionId, "Owner\n");

    await waitForEvent(owner, TERMINAL_EVENTS.EXIT);
    const output = collectOutput(owner, sessionId);
    assert.match(output, /Hello, Owner/);
    assert.doesNotMatch(output, /Intruder/);
  });
});

describe("executionSession - stop execution", () => {
  test("stopSession terminates a long-running session and cleans up", { timeout: TEST_TIMEOUT }, async () => {
    const socket = createFakeSocket();

    const sessionId = executionSession.createSession({
      socket,
      language: "python",
      code: "import time\nwhile True:\n    time.sleep(1)",
    });

    await waitForEvent(socket, TERMINAL_EVENTS.READY);

    await executionSession.stopSession(sessionId, "stopped");

    const exitPayload = await waitForEvent(socket, TERMINAL_EVENTS.EXIT);
    assert.equal(exitPayload.reason, "stopped");
    await assertEventuallyNotOwned(sessionId, socket.id);
  });

  test("stopSession is idempotent - stopping twice does not throw", { timeout: TEST_TIMEOUT }, async () => {
    const socket = createFakeSocket();

    const sessionId = executionSession.createSession({
      socket,
      language: "python",
      code: "import time\nwhile True:\n    time.sleep(1)",
    });

    await waitForEvent(socket, TERMINAL_EVENTS.READY);

    await Promise.all([
      executionSession.stopSession(sessionId, "stopped"),
      executionSession.stopSession(sessionId, "stopped"),
    ]);

    await waitForEvent(socket, TERMINAL_EVENTS.EXIT);
  });

  test("stopping a session while it is still queued never starts a container", async () => {
    const socket = createFakeSocket();

    const sessionId = executionSession.createSession({
      socket,
      language: "python",
      code: "print('should never run')",
    });

    // Race a stop in immediately, before the queue callback has had a
    // chance to run at all.
    await executionSession.stopSession(sessionId, "stopped");

    const exitPayload = await waitForEvent(socket, TERMINAL_EVENTS.EXIT, { timeoutMs: 5000 });
    assert.equal(exitPayload.reason, "stopped");
    assert.equal(exitPayload.exitCode, null);

    const output = collectOutput(socket, sessionId);
    assert.equal(output, "");
  });
});

describe("executionSession - disconnect cleanup", () => {
  test("cleanupSocketSessions stops every session owned by that socket", { timeout: TEST_TIMEOUT }, async () => {
    const socket = createFakeSocket();

    const sessionA = executionSession.createSession({
      socket,
      language: "python",
      code: "import time\nwhile True:\n    time.sleep(1)",
    });
    const sessionB = executionSession.createSession({
      socket,
      language: "javascript",
      code: "setInterval(() => {}, 1000);",
    });

    await waitForCondition(
      () => getEvents(socket, TERMINAL_EVENTS.READY).length >= 2,
      { timeoutMs: 15000 }
    );

    await executionSession.cleanupSocketSessions(socket.id);

    await assertEventuallyNotOwned(sessionA, socket.id);
    await assertEventuallyNotOwned(sessionB, socket.id);

    const exits = getEvents(socket, TERMINAL_EVENTS.EXIT);
    assert.equal(exits.length, 2);
    for (const { payload } of exits) {
      assert.equal(payload.reason, "disconnect");
    }
  });

  test("cleanupSocketSessions on a socket with no sessions is a no-op", async () => {
    await assert.doesNotReject(() => executionSession.cleanupSocketSessions("no-such-socket"));
  });
});

describe("executionSession - concurrent sessions across multiple users", () => {
  test("independent sessions on different sockets do not cross-talk", { timeout: TEST_TIMEOUT }, async () => {
    const socketA = createFakeSocket();
    const socketB = createFakeSocket();

    const sessionA = executionSession.createSession({
      socket: socketA,
      language: "python",
      code: "print('OUTPUT_FROM_A')",
    });
    const sessionB = executionSession.createSession({
      socket: socketB,
      language: "python",
      code: "print('OUTPUT_FROM_B')",
    });

    await Promise.all([
      waitForEvent(socketA, TERMINAL_EVENTS.EXIT),
      waitForEvent(socketB, TERMINAL_EVENTS.EXIT),
    ]);

    const outputA = collectOutput(socketA, sessionA);
    const outputB = collectOutput(socketB, sessionB);

    assert.match(outputA, /OUTPUT_FROM_A/);
    assert.doesNotMatch(outputA, /OUTPUT_FROM_B/);
    assert.match(outputB, /OUTPUT_FROM_B/);
    assert.doesNotMatch(outputB, /OUTPUT_FROM_A/);

    // Socket A can never be mistaken for owning session B, or vice versa.
    assert.equal(executionSession.isOwnedBy(sessionA, socketB.id), false);
    assert.equal(executionSession.isOwnedBy(sessionB, socketA.id), false);
  });
});
