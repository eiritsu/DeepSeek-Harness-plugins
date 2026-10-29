/** Argument checks shared by the official IM CLIs. */

const SECRET_FLAG = /^(?:--app-secret|--client-secret|--token|--access-token|--bot-secret)(?:=|$)/

/**
 * Positional words, skipping flags and everything after `--`.
 * @param args - CLI arguments.
 * @returns the positional words.
 */
export function positionalArgs(args: readonly string[]): string[] {
  const words: string[] = []
  for (const arg of args) {
    if (arg === '--') break
    if (arg.startsWith('-')) continue
    words.push(arg)
  }
  return words
}

/**
 * Reject a model-supplied secret flag.
 * @param args - CLI arguments.
 * @returns the error text, or `undefined` when every argument is allowed.
 */
export function secretFlagReason(args: readonly string[]): string | undefined {
  if (args.some(arg => SECRET_FLAG.test(arg))) {
    return 'Remove secret flags from the command. This integration supplies secrets outside argv.'
  }
  return undefined
}
