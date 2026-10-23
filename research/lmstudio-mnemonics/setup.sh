#!/usr/bin/env bash
# Prepares the LM Studio mnemonic benchmark: bundles the app's own prompt and
# parsers into exp/, and downloads the dictionaries used for scoring into dict/.
# Run from the project root:  bash research/lmstudio-mnemonics/setup.sh
set -euo pipefail
HERE="research/lmstudio-mnemonics"
mkdir -p "$HERE/exp" "$HERE/dict"

printf "export { mnemonicPrompt, MNEMONIC_SCHEMA } from './src/lib/ai-prompts';\nexport { parseMnemonicList } from './src/lib/mnemonic';\n" > .bench-entry.ts
npx esbuild .bench-entry.ts --bundle --format=esm --platform=node --outfile="$HERE/exp/lib.mjs" --log-level=error --alias:@=./src
printf "export { mnemonicPrompt, MNEMONIC_SCHEMA, phoneticPrompt, PHONETIC_SHAPE } from './src/lib/ai-prompts';\nexport { parseMnemonicList } from './src/lib/mnemonic';\nexport { parsePhonetic } from './src/lib/ai-phonetic';\n" > .bench-entry.ts
npx esbuild .bench-entry.ts --bundle --format=esm --platform=node --outfile="$HERE/exp/lib3.mjs" --log-level=error --alias:@=./src
printf "export { requestMnemonics } from './src/lib/ai-mnemonic';
export { NO_KEYS } from './src/lib/ai-keys';
" > .bench-entry.ts
npx esbuild .bench-entry.ts --bundle --format=esm --platform=node --outfile="$HERE/exp/app.mjs" --log-level=error --alias:@=./src
rm .bench-entry.ts

if [ ! -f "$HERE/dict/pl.txt" ]; then
  # SJP word list (all inflected forms). Check https://sjp.pl/sl/growy/ for the current file name.
  curl -s -o "$HERE/dict/sjp.zip" https://sjp.pl/sl/growy/sjp-20260901.zip
  unzip -o -q "$HERE/dict/sjp.zip" -d "$HERE/dict/sjp"
  tr -d '\r' < "$HERE/dict/sjp/slowa.txt" > "$HERE/dict/pl.txt"
fi
if [ ! -f "$HERE/dict/en_50k.txt" ]; then
  curl -s -o "$HERE/dict/en_50k.txt" https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt
fi
echo "ready: $HERE/exp, $HERE/dict"
