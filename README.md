tisk
====

`tisk` is a simpler alternative to `tsc`, the standard TypeScript compiler CLI.

Synposis
--------

```
usage: bin.js [-h] [-v] [-o OUTPUT] [-d] [-m] [-W WARNING] [file [file ...]]
```

Examples
--------

```shell
# Output to stdout
echo "console.log('Hello, world')" | tisk | node

# All warnings as errors
tisk -Werror -o lib src/*

# Specific warnings as errors
tisk -Werror=implicit-any -Wimplicit-this -o lib src/*

# Source maps
tisk -m -o lib src/*

# Declarations
tisk -d -o lib src/*
```

Features
--------

### Relative Import Path Mapping

`tisk` will automatically map relative import paths based on the output
directory if `module` is set to `commonjs` in `tsconfig.json`.

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
