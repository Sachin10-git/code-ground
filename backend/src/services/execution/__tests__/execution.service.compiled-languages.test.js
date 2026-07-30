const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const executionService = require("../execution.service");

const TEST_TIMEOUT = 60000;
// TypeScript re-downloads the `typescript` package via npx on every run
// (each container is disposable), so it needs more headroom.
const TS_TIMEOUT = 90000;

describe("executionService.execute - typescript", () => {
  test("runs successfully and returns stdout", { timeout: TS_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "typescript",
      code: `const message: string = "Hello from TypeScript!";\nconsole.log(message);`,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "Hello from TypeScript!");
    assert.equal(result.stderr, "");
    assert.equal(result.timedOut, false);
  });

  test("returns a non-zero exit code on compile failure", { timeout: TS_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "typescript",
      code: `const x: number = "not a number";\nconsole.log(x`,
    });

    assert.notEqual(result.exitCode, 0);
    // tsc writes diagnostics to stdout, not stderr.
    assert.match(result.stdout, /error TS/);
    assert.equal(result.timedOut, false);
  });

  test("returns a non-zero exit code on runtime failure", { timeout: TS_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "typescript",
      code: `throw new Error("boom");`,
    });

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /boom/);
    assert.equal(result.timedOut, false);
  });
});

describe("executionService.execute - cpp", () => {
  test("runs successfully and returns stdout", { timeout: TEST_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "cpp",
      code: `#include <iostream>\nint main() { std::cout << "Hello from C++!" << std::endl; return 0; }`,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "Hello from C++!");
    assert.equal(result.stderr, "");
    assert.equal(result.timedOut, false);
  });

  test("returns a non-zero exit code on compile failure", { timeout: TEST_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "cpp",
      code: `#include <iostream>\nint main() { std::cout << "missing semicolon" << std::endl`,
    });

    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /error/);
    assert.equal(result.timedOut, false);
  });

  test("returns a non-zero exit code on runtime failure", { timeout: TEST_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "cpp",
      code: `#include <cstdlib>\nint main() { std::abort(); return 0; }`,
    });

    assert.notEqual(result.exitCode, 0);
    assert.equal(result.timedOut, false);
  });
});

describe("executionService.execute - go", () => {
  test("runs successfully and returns stdout", { timeout: TEST_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "go",
      code: `package main\nimport "fmt"\nfunc main() { fmt.Println("Hello from Go!") }`,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "Hello from Go!");
    assert.equal(result.stderr, "");
    assert.equal(result.timedOut, false);
  });

  test("returns a non-zero exit code on compile failure", { timeout: TEST_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "go",
      code: `package main\nimport "fmt"\nfunc main() { fmt.Println("unterminated"\n}`,
    });

    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /syntax error/);
    assert.equal(result.timedOut, false);
  });

  test("returns a non-zero exit code on runtime failure", { timeout: TEST_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "go",
      code: `package main\nfunc main() { panic("boom") }`,
    });

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /boom/);
    assert.equal(result.timedOut, false);
  });
});
