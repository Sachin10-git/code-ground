const dockerRunner = require("./services/execution/dockerRunner.service");

(async () => {
  try {
    const output = await dockerRunner.runHelloContainer();
    console.log(output);
  } catch (err) {
    console.error(err);
  }
})();