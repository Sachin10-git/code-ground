const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

class TempWorkspaceService {
  constructor() {
    this.baseDir = path.join(process.cwd(), "temp");
  }

  async createWorkspace() {
    const id = crypto.randomUUID();
    const workspacePath = path.join(this.baseDir, id);

    await fs.mkdir(workspacePath, { recursive: true });

    return {
      id,
      workspacePath,
    };
  }

  async writeFile(workspacePath, fileName, content) {
    const filePath = path.join(workspacePath, fileName);

    await fs.writeFile(filePath, content, "utf8");

    return filePath;
  }

  async cleanup(workspacePath) {
    await fs.rm(workspacePath, {
      recursive: true,
      force: true,
    });
  }
}

module.exports = new TempWorkspaceService();