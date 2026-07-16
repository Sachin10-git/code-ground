const { spawn } = require("child_process");

const runContainer = (
    image,
    directory,
    command,
    timeout = 5000
) => {

    return new Promise((resolve, reject) => {

        const docker = spawn(
            "docker",
            [
                "run",
                "--rm",

                "--memory=256m",
                "--cpus=0.5",
                "--pids-limit=64",

                "-v",
                `${directory}:/code`,

                "-w",
                "/code",

                image,

                ...command,
            ]
        );

        let stdout = "";
        let stderr = "";

        docker.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        docker.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        const timer = setTimeout(() => {

            docker.kill("SIGKILL");

            resolve({
                stdout,
                stderr: "Execution timed out.",
                exitCode: 124,
            });

        }, timeout);

        docker.on("close", (code) => {

            clearTimeout(timer);

            resolve({
                stdout,
                stderr,
                exitCode: code,
            });

        });

        docker.on("error", (err) => {

            clearTimeout(timer);

            reject(err);

        });

    });

};

module.exports = {
    runContainer,
};