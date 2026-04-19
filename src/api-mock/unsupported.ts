export function warnUnsupported(apiName: string): void {
  process.stderr.write(
    `[pi-mcp-export] ExtensionAPI.${apiName} is not supported by pi-mcp-export and was ignored\n`,
  );
}
