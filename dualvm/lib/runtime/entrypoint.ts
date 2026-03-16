export function isDirectExecution(scriptPath: string): boolean {
  const argvEntry = process.argv[1];
  return Boolean(argvEntry && argvEntry.endsWith(scriptPath));
}

export function runEntrypoint(scriptPath: string, main: () => Promise<void>) {
  if (!isDirectExecution(scriptPath)) {
    return;
  }

  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
