/**
 * @filename: commitlint.config.js
 * @type {import('@commitlint/types').UserConfig}
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Custom rule: prohibit @ mentions
    "no-github-mentions": [2, "always"],
  },
  plugins: [
    {
      rules: {
        "no-github-mentions": ({ raw }) => {
          // Check for @ mentions (excluding email addresses)
          const mentionPattern = /@[a-zA-Z0-9_-]+(?![a-zA-Z0-9_.-]*@)/g;
          const matches = raw.match(mentionPattern);

          if (matches) {
            return [
              false,
              `Commit message contains GitHub mentions: ${matches.join(", ")}. ` +
                "Please remove or escape @ symbols to avoid unintended notifications.",
            ];
          }

          return [true];
        },
      },
    },
  ],
};
