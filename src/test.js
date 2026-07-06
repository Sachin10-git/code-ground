const ApiResponse = require("./utils/ApiResponse");

const response = new ApiResponse(
    200,
    "Backend is working!",
    {
        name: "Code Ground"
    }
);

console.log(response);