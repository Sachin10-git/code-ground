const path = require("path");

// Default resource limits applied to any language that doesn't override them.
// These match the limits the original Java runner hardcoded, so existing
// behavior is preserved for Java while becoming configurable per language.
const DEFAULT_RESOURCE_LIMITS = {
  memory: 512 * 1024 * 1024, // 512 MB
  nanoCpus: 1_000_000_000, // 1 CPU
  networkMode: "none",
  pidsLimit: 128,
};

// Language-specific configuration lives here, and only here. Adding a new
// language means adding an entry to this map - no Docker logic changes.
const LANGUAGE_CONFIGS = {
  java: {
    image: "eclipse-temurin:21-jdk",
    fileName: "Main.java",
    compileCommand: ["javac", "Main.java"],
    runCommand: ["java", "Main"],
  },
  javascript: {
    image: "node:22",
    fileName: "index.js",
    compileCommand: null,
    runCommand: ["node", "index.js"],
  },
  python: {
    image: "python:3.12",
    fileName: "main.py",
    compileCommand: null,
    runCommand: ["python", "main.py"],
  },
  typescript: {
    image: "node:22",
    fileName: "index.ts",
    // `npx tsc index.ts` alone resolves to an unrelated, deprecated npm
    // package literally named "tsc" (not the TypeScript compiler) since
    // node:22 has no local tsc binary to prefer. `--package typescript`
    // pins npx to the real compiler. Each container is disposable
    // (AutoRemove), so npx re-downloads typescript on every run; the
    // `npm config set` prefix only silences npm's update-notifier so it
    // doesn't leak "npm notice" lines onto stderr.
    compileCommand: [
      "npm", "config", "set", "update-notifier", "false", "&&",
      "npx", "--yes", "--package", "typescript", "tsc", "index.ts",
    ],
    runCommand: ["node", "index.js"],
    // Requires network access to fetch the typescript package - overrides
    // the network-disabled default other languages use.
    resourceLimits: { networkMode: "bridge" },
  },
  cpp: {
    image: "gcc:latest",
    fileName: "main.cpp",
    compileCommand: ["g++", "main.cpp", "-o", "main"],
    runCommand: ["./main"],
  },
  go: {
    image: "golang:1.23",
    fileName: "main.go",
    compileCommand: ["go", "build", "-o", "main", "main.go"],
    runCommand: ["./main"],
  },
};

class LanguageRunnerService {
  getConfig(language, workspacePath) {
    const languageConfig = LANGUAGE_CONFIGS[language];

    if (!languageConfig) {
      throw new Error(`Unsupported language: ${language}`);
    }

    return {
      language,
      image: languageConfig.image,
      workingDir: "/workspace",
      binds: [`${workspacePath}:/workspace`],
      fileName: languageConfig.fileName,
      compileCommand: languageConfig.compileCommand || null,
      runCommand: languageConfig.runCommand,
      resourceLimits: {
        ...DEFAULT_RESOURCE_LIMITS,
        ...(languageConfig.resourceLimits || {}),
      },
    };
  }

  getJavaConfig(workspacePath) {
    return this.getConfig("java", workspacePath);
  }

  isSupported(language) {
    return Boolean(LANGUAGE_CONFIGS[language]);
  }

  getSupportedLanguages() {
    return Object.keys(LANGUAGE_CONFIGS);
  }

  /**
   * Phase 6 — the distinct set of Docker images every supported language
   * needs. Used by startup validation (server.js) and the deep health
   * endpoint (routes/health.routes.js) so neither has to duplicate
   * LANGUAGE_CONFIGS - this is the single place language -> image
   * mapping lives.
   */
  getRequiredImages() {
    const images = new Set(
      Object.values(LANGUAGE_CONFIGS).map((cfg) => cfg.image)
    );
    return [...images];
  }
}

module.exports = new LanguageRunnerService();