// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

// Rules 7 and 10 of the Power of 10 come from this file: the type-aware strict set of
// typescript-eslint plus the correctness rules of core ESLint. Only lints that decide
// style and nothing about behaviour are off, and each says why. Left off: no-await-in-loop,
// because the jobs and the replay run one model call after another on purpose, and sort-keys,
// id-length, one-var, no-magic-numbers, no-ternary, camelcase, func-style, sort-imports and
// capitalized-comments, which decide how code looks and never what it does. Also off:
// @typescript-eslint/no-unnecessary-type-parameters, because the typed query helpers all/get and ask
// return the row type the caller names, which is a type parameter used once on purpose.
const correctness = {
  'array-callback-return': 'error', 'consistent-return': 'error', 'curly': 'error', 'default-case-last': 'error',
  'eqeqeq': 'error', 'max-depth': ['error', 4], 'no-caller': 'error',
  'no-constructor-return': 'error', 'no-eval': 'error', 'no-extend-native': 'error', 'no-implicit-coercion': 'error',
  'no-implied-eval': 'error', 'no-iterator': 'error', 'no-labels': 'error', 'no-lone-blocks': 'error',
  'no-loop-func': 'error', 'no-new-func': 'error', 'no-new-wrappers': 'error', 'no-param-reassign': 'error',
  'no-promise-executor-return': 'error', 'no-proto': 'error', 'no-return-assign': 'error', 'no-script-url': 'error',
  'no-self-compare': 'error', 'no-sequences': 'error', 'no-shadow': 'error', 'no-template-curly-in-string': 'error',
  'no-throw-literal': 'error', 'no-unmodified-loop-condition': 'error', 'no-use-before-define': 'error',
  'no-useless-concat': 'error', 'no-var': 'error', 'prefer-const': 'error', 'require-atomic-updates': 'error',
  'no-empty': ['error', { allowEmptyCatch: false }], 'no-void': ['error', { allowAsStatement: true }],
  'no-else-return': 'error', 'no-plusplus': 'off', 'radix': 'error', 'yoda': 'error',
};

export default tseslint.config(
  { ignores: ['node_modules/**', 'docs/**', 'fonts/**', 'eslint.config.js'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: ['./tsconfig.json', './tsconfig.client.json'], tsconfigRootDir: import.meta.dirname },
    },
    rules: { ...correctness, '@typescript-eslint/no-unnecessary-type-parameters': 'off' },
  },
);
