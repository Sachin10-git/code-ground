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

        await writeSourceFile(
            directory,
            config.filename,
            code
        );

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

        await deleteTempDirectory(directory);

    }

};

module.exports = {
    runCode,
};