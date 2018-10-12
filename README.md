tisk
====

`tisk` is a simpler alternative to `tsc`, the standard TypeScript compiler CLI.

Synposis
--------

```
usage: tisk [-h] [-v] [-o OUTPUT] [-d] [-m] [-p PATH] [-W WARNING]
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

Differences from `tsc`
----------------------

`tisk` follows references to imports but does not compile them. To illustrate
this:

```terminal
$ mkdir example && cd example
$ mkdir src && echo "export {}" > src/index.ts
$ echo "import * as m from './src';" > main.ts
$ tsc --outDir lib main.ts
$ ls lib
main.js	src
$ rm -r lib
$ tisk -o lib main.ts
$ ls lib
main.js
```

As you can see, `tsc` brings in the `src` directory, compiles it, and outputs
the result to `lib` while `tisk` only compiles the input files provided.

Because `tisk` behaves this way, its output is completely predictable and you
can, for example, run it in parallel, splitting the input set any way you want.

### Automatic relative import path mapping

`tisk` will automatically fix relative import paths among the set of input
files and directories. This can allow you to, for example, combine two
directories:

```terminal
$ tisk -o lib src1 src2
```

If a file in `src2` imports from `src1` like so:

```typescript
import * as foo from '../src1/foo';
```

On output, it will be transformed to:

```javascript
import * as foo from './foo';
```

To map import paths that aren't in the set of inputs (eg. they might be
compiled in a separate invocation), use the `-p` option as shown in the
examples above.

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
