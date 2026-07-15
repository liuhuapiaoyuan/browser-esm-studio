import { definePlugin } from "../../define-command";
import {
  sandboxAddFile,
  sandboxApplyOperations,
  sandboxGrep,
  sandboxListFiles,
  sandboxReadFile,
  sandboxRemoveFile,
  sandboxReplaceInFile,
  sandboxWriteFile,
} from "./commands/files";
import { sandboxGetPreviewErrors, sandboxTypecheck } from "./commands/checks";

export const sandboxPlugin = definePlugin({
  name: "@agent-cli/plugin-sandbox",
  version: "1.0.0",
  commands: [
    sandboxListFiles,
    sandboxReadFile,
    sandboxGrep,
    sandboxWriteFile,
    sandboxAddFile,
    sandboxRemoveFile,
    sandboxReplaceInFile,
    sandboxApplyOperations,
    sandboxTypecheck,
    sandboxGetPreviewErrors,
  ],
});

export default sandboxPlugin;
