const workspaceService = require("./services/execution/tempWorkspace.service");
const languageRunner = require("./services/execution/languageRunner.service");
const dockerRunner = require("./services/execution/dockerRunner.service");

(async () => {
  let workspace;

  try {
    // Create temp workspace
    workspace = await workspaceService.createWorkspace();

    // Write Java file
    await workspaceService.writeFile(
      workspace.workspacePath,
      "Main.java",
      `
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello from Code Ground!");
    }
}
`
    );

    // Get Java config
    const config = languageRunner.getJavaConfig(workspace.workspacePath);

    // Execute
    const result = await dockerRunner.runJava(config);

    console.log(result);
  } catch (err) {
    console.error(err);
  } finally {
    if (workspace) {
      await workspaceService.cleanup(workspace.workspacePath);
    }
  }
})();