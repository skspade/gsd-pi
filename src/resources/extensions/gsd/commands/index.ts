import { importExtensionModule, type ExtensionAPI, type ExtensionCommandContext } from "@gsd/pi-coding-agent";

import { GSD_COMMAND_DESCRIPTION, getGsdArgumentCompletions } from "./catalog.js";

export function registerGSDCommand(pi: ExtensionAPI): void {
  pi.registerCommand("gsd", {
    description: GSD_COMMAND_DESCRIPTION,
    getArgumentCompletions: getGsdArgumentCompletions,
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const { handleGSDCommand } = await importExtensionModule<typeof import("./dispatcher.js")>(
        import.meta.url,
        "./dispatcher.js",
      );
      const { setStderrLoggingEnabled } = await importExtensionModule<typeof import("../workflow-logger.js")>(
        import.meta.url,
        "../workflow-logger.js",
      );
      const previousStderrSetting = setStderrLoggingEnabled(false);
      try {
        await handleGSDCommand(args, ctx, pi);
      } finally {
        setStderrLoggingEnabled(previousStderrSetting);
      }
    },
  });
}
