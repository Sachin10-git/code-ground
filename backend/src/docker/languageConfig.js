module.exports = {
    python: {
        image: "python:3.12",
        extension: ".py",
        filename: "main.py",
        command: ["python", "/code/main.py"],
    },

    javascript: {
        image: "node:22",
        extension: ".js",
        filename: "main.js",
        command: ["node", "/code/main.js"],
    },

    cpp: {
        image: "gcc:latest",

        filename: "main.cpp",

        compile: [
            "g++",
            "main.cpp",
            "-o",
            "main"
        ],

        execute: [
            "./main"
        ],
    },
};