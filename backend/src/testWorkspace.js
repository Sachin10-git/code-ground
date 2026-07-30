const workspaceService = require("./services/execution/tempWorkspace.service");

(async () => {
  const workspace = await workspaceService.createWorkspace();

  console.log(workspace);

  await workspaceService.writeFile(
    workspace.workspacePath,
    "Main.java",
    `public class Main {
    public static void main(String[] args){
        System.out.println("Hello");
    }
}`
  );

  console.log("File written.");

  await workspaceService.cleanup(workspace.workspacePath);

  console.log("Workspace deleted.");
})();