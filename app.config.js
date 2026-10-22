/**
 * Bổ sung cấu hình động cho app.json.
 * Google Sign-In trên iOS cần URL scheme = iOS client ID viết ngược
 * ("123-abc.apps.googleusercontent.com" → "com.googleusercontent.apps.123-abc"),
 * sinh từ EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID trong .env để chỉ phải điền 1 giá trị.
 */
module.exports = ({ config }) => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const iosUrlScheme = iosClientId
    ? iosClientId.split('.').reverse().join('.')
    : undefined;
  const plugins = (config.plugins ?? []).map((p) =>
    p === '@react-native-google-signin/google-signin' && iosUrlScheme
      ? ['@react-native-google-signin/google-signin', { iosUrlScheme }]
      : p,
  );
  return { ...config, plugins };
};
