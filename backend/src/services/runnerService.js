const languageConfig = require("../docker/languageConfig");

const {
    runContainer,
} = require("../docker/dockerRunner");

const {
    createTempDirectory,
    writeSourceFile,
    deleteTempDirectory,
} = require("../docker/tempFileManager");

const runCode = async ({ language, code }) => {

    const config = languageConfig[language];

    if (!config) {
        throw new Error("Unsupported language");
    }

    const directory = await createTempDirectory();

    try {

        // Write the user's source code to the temp directory
        await writeSourceFile(
            directory,
            config.filename,
            code
        );

        const fs = require("fs/promises");

console.log("Directory:", directory);
console.log("Files:", await fs.readdir(directory));

        // Execute inside Docker
        const result = await runContainer(
            config.image,
            directory,
            config.command
        );

        return {
            language,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
        };

    } finally {

        // Always clean up temporary files
        await deleteTempDirectory(directory);

    }

};

module.exports = {
    runCode,
};