const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Let Metro resolve the .sql files emitted by drizzle-kit.
config.resolver.sourceExts.push('sql');

module.exports = config;
