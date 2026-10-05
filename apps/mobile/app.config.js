// Only an explicit web deployment changes Expo's resource base. Native/dev defaults remain intact.
module.exports = ({ config }) => {
  const configured = process.env.EXPO_PUBLIC_WEB_BASE_PATH;
  if (configured === undefined) return config;
  const baseUrl = configured.replace(/\/$/, "");
  if (!/^(?:\/[A-Za-z0-9_-]+)*$/.test(baseUrl))
    throw new Error("EXPO_PUBLIC_WEB_BASE_PATH must be empty or an absolute path such as /muse");
  return { ...config, experiments: { ...config.experiments, baseUrl } };
};
