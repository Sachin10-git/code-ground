const { spawn } = require("child_process");

const runContainer = (
    image,
    directory,
    command,
    timeout = 5000
) => {

    console.log("Image:", image);
    console.log("Directory:", directory);
    console.log("Command:", command);

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
    console.log("STDOUT:", data.toString());
    stdout += data.toString();
});

docker.stderr.on("data", (data) => {
    console.log("STDERR:", data.toString());
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

    console.log("Container exited:", code);

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