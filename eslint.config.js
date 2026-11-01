// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Generated: the router types carry an eslint-disable nobody wrote, the
    // research setup scripts leave their bundles under research/*/exp, and
    // `wrangler dev` its own under server/.wrangler.
    ignores: ["dist/*", ".expo/*", "research/*/exp/*", "server/.wrangler/*"],
  }
]);
