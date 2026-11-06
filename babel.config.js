module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      './scripts/analytics/control-plugin.cjs',
      './scripts/analytics/actor-plugin.cjs',
      [
        'module-resolver',
        {
          alias: {
            '@': './src',
          },
        },
      ],
      'react-native-reanimated/plugin',
    ],
  };
};
