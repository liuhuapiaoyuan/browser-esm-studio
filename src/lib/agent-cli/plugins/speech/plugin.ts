import { definePlugin } from "../../define-command";
import { speechGenerate } from "./commands/generate";

export const speechPlugin = definePlugin({
  name: "@agent-cli/plugin-speech",
  version: "1.0.0",
  commands: [speechGenerate],
});

export default speechPlugin;
