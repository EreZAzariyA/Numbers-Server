import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import process from "node:process";


export default [
  { files: ["**/*.{js,mjs,cjs,ts}"] },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    "rules": {
      "import/prefer-default-export": 0,
      "no-nested-ternary": 0,
      "class-methods-use-this": 0,
      "arrow-body-style": 0,
      "no-shadow": 0,
      "no-await-in-loop": 0,
      "keyword-spacing": ["error", {
        before: true,
        after: true,
      }],
      "semi-spacing": ["error", { "before": false, "after": false }],
      "object-curly-spacing": ["error", "always"],
      "no-trailing-spaces": "error",
      "space-infix-ops": "error",
      "no-restricted-syntax": [
        "error",
        "ForInStatement",
        "LabeledStatement",
        "WithStatement"
      ],
      "operator-linebreak": ["error", "after"],
      "max-len": ["error", 120, 2, {
        "ignoreUrls": true,
        "ignoreComments": true,
        "ignoreRegExpLiterals": true,
        "ignoreStrings": true,
        "ignoreTemplateLiterals": true,
        "ignorePattern": "^(async )?function "
      }],
      "linebreak-style": process.platform === "win32" ? 0 : 2,
      "@typescript-eslint/no-explicit-any": "off",
    },
  }
];