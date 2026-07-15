import { definePlugin } from "../../define-command";
import { imageGenerate } from "./commands/generate";

export const imagePlugin = definePlugin({
  name: "@agent-cli/plugin-image",
  version: "1.0.0",
  commands: [imageGenerate],
});

export default imagePlugin;
