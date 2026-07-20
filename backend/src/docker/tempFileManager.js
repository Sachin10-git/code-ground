const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

/**
 * Create a temporary directory
 */
const createTempDirectory = async () => {

    const dir = path.join(
        os.tmpdir(),
        `codeground-${crypto.randomUUID()}`
    );

    await fs.mkdir(dir, {
        recursive: true,
    });

    return dir;
};

/**
 * Write source code to a file
 */
const writeSourceFile = async (
    directory,
    filename,
    code
) => {

    const filePath = path.join(
        directory,
        filename
    );

    await fs.writeFile(filePath, code);

    return filePath;
};

/**
 * Delete temporary directory
 */
const deleteTempDirectory = async (
    directory
) => {

    await fs.rm(directory, {
        recursive: true,
        force: true,
    });

};

module.exports = {
    createTempDirectory,
    writeSourceFile,
    deleteTempDirectory,
};