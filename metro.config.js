// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDefaultConfig } = require('expo/metro-config');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const JavaScriptObfuscator = require('javascript-obfuscator');

const config = getDefaultConfig(__dirname);

const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  stringArray: true,
  stringArrayThreshold: 0.6,
  rotateStringArray: true,
  selfDefending: false,
  identifierNamesGenerator: 'hexadecimal',
  numbersToExpressions: false,
  simplify: true,
  splitStrings: false,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
};

/**
 * Làm rối bundle JS cuối cùng (chỉ bản release — NODE_ENV=production).
 * Bọc quanh customSerializer có sẵn của Expo: nó trả về `{code, map}` (bundle cũ)
 * hoặc `{artifacts, assets}` (export:embed mới — code JS nằm ở artifacts[].source,
 * type: 'js'). Chỉ obfuscate phần source JS, giữ format gốc để Gradle đóng gói đúng.
 */
if (process.env.NODE_ENV === 'production') {
  const expoSerializer = config.serializer.customSerializer;
  const obfuscate = (code) => JavaScriptObfuscator.obfuscate(code, OBFUSCATOR_OPTIONS).getObfuscatedCode();

  config.serializer.customSerializer = async (entryPoint, preModules, graph, options) => {
    const bundle = await expoSerializer(entryPoint, preModules, graph, options);
    if (bundle && Array.isArray(bundle.artifacts)) {
      return {
        ...bundle,
        artifacts: bundle.artifacts.map((a) => (a.type === 'js' ? { ...a, source: obfuscate(a.source) } : a)),
      };
    }
    if (bundle && typeof bundle === 'object' && typeof bundle.code === 'string') {
      return { ...bundle, code: obfuscate(bundle.code) };
    }
    if (typeof bundle === 'string') return obfuscate(bundle);
    return bundle;
  };
}

module.exports = config;
