module.exports = {
  "env": {
    "es2020": true
  },
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "parserOptions": {
    "ecmaVersion": 2020,
    "sourceType": "module"
  },
  "parser": "@typescript-eslint/parser",
  "plugins": [
    "@typescript-eslint"
  ],
  "ignorePatterns": ["build/**", ".eslintrc.js", "dist/**"],
  "rules": {
    "max-len": ["error", {
      "code": 160,
      "tabWidth": 2
    }],
    "object-curly-newline": ["error", {
      "ObjectExpression": { "multiline": true, "minProperties": 4 },
      "ObjectPattern": { "multiline": true, "minProperties": 4 },
      "ImportDeclaration": { "multiline": true, "minProperties": 8 },
      "ExportDeclaration": { "multiline": true, "minProperties": 4 }
  }],
  "@typescript-eslint/no-explicit-any": "off",
  "@typescript-eslint/no-empty-function": "off",
  "no-inner-declarations": "off",
  "no-unreachable": "off"
  }
}