/**
 * @type {import('nano-staged').Configuration}
 */
export default {
  // All files: format and security check
  "*": [
    // https://github.com/secretlint/secretlint
    "secretlint",
    // https://oxc.rs/docs/guide/usage/formatter/integration.html#pre-commit-hook
    "oxfmt --no-error-on-unmatched-pattern",
  ],

  // TypeScript files: additional checks
  "*.{ts,tsx}": [
    "pnpm exec oxlint --fix",
    "bash -c 'pnpm run typecheck'",
    "pnpm exec vitest related --run",
  ],
};
