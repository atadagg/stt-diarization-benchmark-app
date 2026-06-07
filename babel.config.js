module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Inlines process.env.* values at build time from the environment.
      // Copy .env.example -> .env and set your keys before building.
      'transform-inline-environment-variables',
    ],
  };
};
