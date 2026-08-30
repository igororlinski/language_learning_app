module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Drizzle migrations are imported as raw .sql strings.
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
