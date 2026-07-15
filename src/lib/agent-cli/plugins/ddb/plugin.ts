import { definePlugin } from "../../define-command";
import {
  ddbActivateSchema,
  ddbCodegen,
  ddbGetEffectiveSchema,
  ddbGetInventory,
  ddbGetSchema,
  ddbInitializeProject,
  ddbSetupSchema,
} from "./commands/schema";
import {
  ddbCountRecords,
  ddbCreateRecord,
  ddbDeleteRecord,
  ddbGetRecord,
  ddbListRecords,
  ddbRecordsBatch,
  ddbUpdateRecord,
  ddbUpsertRecord,
} from "./commands/records";

export const ddbPlugin = definePlugin({
  name: "@agent-cli/plugin-ddb",
  version: "1.0.0",
  commands: [
    ddbGetSchema,
    ddbGetEffectiveSchema,
    ddbGetInventory,
    ddbSetupSchema,
    ddbActivateSchema,
    ddbInitializeProject,
    ddbCodegen,
    ddbListRecords,
    ddbGetRecord,
    ddbCountRecords,
    ddbCreateRecord,
    ddbUpdateRecord,
    ddbDeleteRecord,
    ddbUpsertRecord,
    ddbRecordsBatch,
  ],
});

export default ddbPlugin;
