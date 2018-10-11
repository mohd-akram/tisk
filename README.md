tisk
====

`tisk` is a simpler alternative to `tsc`, the standard TypeScript compiler CLI.

Synposis
--------

```
usage: bin.js [-h] [-v] [-o OUTPUT] [-d] [-m] [-p PATH] [-W WARNING]
              [file [file ...]]
```

Examples
--------

```shell
# Output to stdout
echo "console.log('Hello, world')" | tisk | node

# All warnings as errors
tisk -Werror -o lib src

# Specific warnings as errors
tisk -Werror=implicit-any -Wimplicit-this -o lib src

# Source maps
tisk -m -o lib src

# Declarations
tisk -d -o lib src

# Map external import paths based on output directory
# Input: src/main.ts: import * as vendor from '../vendor'
# Output: dist/lib/main.js: import * as vendor from '../../vendor'
tisk -p vendor -o dist/lib src
# or
# Input: src/main.ts: import * as vendor from '../vendor'
# Output: dist/lib/main.js: import * as vendor from '../../libs'
tisk -p vendor:libs -o dist/lib src
```

Warnings
--------

```javascript
{
  'strict': 'strict',
  'implicit-any': 'noImplicitAny',
  'implicit-returns': 'noImplicitReturns',
  'implicit-this': 'noImplicitThis',
  'implicit-fallthrough': 'noFallthroughCasesInSwitch',
  'unused-locals': 'noUnusedLocals',
  'unused-parameters': 'noUnusedParameters'
}
```
