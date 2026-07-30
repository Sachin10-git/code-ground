const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const executionService = require("../execution.service");

// Docker containers can take a few seconds to start, especially the JVM.
const TEST_TIMEOUT = 60000;

describe("executionService.execute - java", () => {
  test("runs successfully and returns stdout", { timeout: TEST_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "java",
      code: `
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello from Java!");
    }
}
`,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "Hello from Java!");
    assert.equal(result.stderr, "");
    assert.equal(result.timedOut, false);
  });

  test("returns a non-zero exit code on compilation failure", { timeout: TEST_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "java",
      code: `
public class Main {
    public static void main(String[] args) {
        System.out.println("Missing semicolon")
    }
}
`,
    });

    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /error/i);
    assert.equal(result.timedOut, false);
  });

  test("returns a non-zero exit code on runtime failure", { timeout: TEST_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "java",
      code: `
public class Main {
    public static void main(String[] args) {
        throw new RuntimeException("boom");
    }
}
`,
    });

    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /boom/);
    assert.equal(result.timedOut, false);
  });
});

describe("executionService.execute - javascript", () => {
  test("runs successfully and returns stdout", { timeout: TEST_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "javascript",
      code: `console.log("Hello from JavaScript!");`,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "Hello from JavaScript!");
    assert.equal(result.stderr, "");
    assert.equal(result.timedOut, false);
  });

  test("returns a non-zero exit code on syntax error", { timeout: TEST_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "javascript",
      code: `console.log("unterminated"`,
    });

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /SyntaxError/);
    assert.equal(result.timedOut, false);
  });

  test("returns a non-zero exit code on runtime error", { timeout: TEST_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "javascript",
      code: `throw new Error("boom");`,
    });

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /boom/);
    assert.equal(result.timedOut, false);
  });
});

describe("executionService.execute - python", () => {
  test("runs successfully and returns stdout", { timeout: TEST_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "python",
      code: `print("Hello from Python!")`,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "Hello from Python!");
    assert.equal(result.stderr, "");
    assert.equal(result.timedOut, false);
  });

  test("returns a non-zero exit code on syntax error", { timeout: TEST_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "python",
      code: `print("unterminated"`,
    });

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /SyntaxError/);
    assert.equal(result.timedOut, false);
  });

  test("returns a non-zero exit code on runtime error", { timeout: TEST_TIMEOUT }, async () => {
    const result = await executionService.execute({
      language: "python",
      code: `raise Exception("boom")`,
    });

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /boom/);
    assert.equal(result.timedOut, false);
  });
});

describe("executionService.execute - validation", () => {
  test("rejects an unsupported language", async () => {
    await assert.rejects(
      () => executionService.execute({ language: "cobol", code: "x" }),
      (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Unsupported language/);
        return true;
      }
    );
  });

  test("rejects a missing language", async () => {
    await assert.rejects(
      () => executionService.execute({ code: "x" }),
      (err) => {
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  test("rejects missing code", async () => {
    await assert.rejects(
      () => executionService.execute({ language: "python" }),
      (err) => {
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });
});
