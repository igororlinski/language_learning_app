// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Generated: the router types carry an eslint-disable nobody wrote.
    ignores: ["dist/*", ".expo/*"],
  }
]);
