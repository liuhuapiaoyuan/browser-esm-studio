import { definePlugin } from "../../define-command";
import { sfxList } from "./commands/list";
import { sfxMap } from "./commands/map";

export const sfxPlugin = definePlugin({
  name: "@agent-cli/plugin-sfx",
  version: "1.0.0",
  commands: [sfxList, sfxMap],
});

export default sfxPlugin;
