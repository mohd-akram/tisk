#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const util = require('util');

const ArgumentParser = require('argparse').ArgumentParser;
const colors = require('colors/safe');
const glob = util.promisify(require('glob'));
const mkdirp = util.promisify(require('mkdirp'));
const ts = require('typescript');

const fsReadFile = util.promisify(fs.readFile);
const fsWriteFile = util.promisify(fs.writeFile);

const configFilename = 'tsconfig.json';

const warningToOption = {
  'strict': 'strict',
  'implicit-any': 'noImplicitAny',
  'implicit-returns': 'noImplicitReturns',
  'implicit-this': 'noImplicitThis',
  'implicit-fallthrough': 'noFallthroughCasesInSwitch',
  'unused-locals': 'noUnusedLocals',
  'unused-parameters': 'noUnusedParameters'
};

const strictWarnings = [
  'implicit-any',
  'implicit-this'
];

const optionToWarning = {};
for (const [warning, option] of Object.entries(warningToOption))
  optionToWarning[option] = warning;

function getWarning(diagnostic) {
  const { category, code, messageText: message } = diagnostic;

  if (category != ts.DiagnosticCategory.Error)
    return;

  let warning = '';

  if (/implicitly/.test(message) && /'any'/.test(message))
    warning = /'this'/.test(message) ? 'implicit-this' : 'implicit-any';
  else if (/fallthrough/i.test(message))
    warning = 'implicit-fallthrough';
  else if (/never used|unused/i.test(message))
    warning = /parameter/i.test(message) ?
      'unused-parameters' : 'unused-locals';
  else if (/never read/.test(message))
    warning = /property/i.test(message) ? 'unused-locals' :
      ['unused-locals', 'unused-parameters'];
  else if (code == 7030)
    warning = 'implicit-returns';

  return warning;
}

async function getCompilerOptions(options) {
  let parsed = {
    options: {}, errors: []
  };

  if (options && options.compilerOptions) {
    parsed = ts.convertCompilerOptionsFromJson(options.compilerOptions, '');
  } else {
    let text;
    try {
      text = await fsReadFile(configFilename, 'utf-8');
    } catch (e) {
      if (e.code != 'ENOENT')
        throw [{
          messageText: e.message, category: ts.DiagnosticCategory.Error
        }];
    }
    if (text) {
      const result = ts.parseConfigFileTextToJson(configFilename, text);
      if (result.error)
        throw [result.error];
      parsed = ts.parseJsonConfigFileContent(result.config, ts.sys, '');
    }
  }

  if (parsed.errors.length)
    throw parsed.errors;

  return parsed.options;
}

function processDiagnostics(diagnostics, warnings, werror) {
  const count = { warnings: 0, errors: 0 };

  for (const diagnostic of diagnostics) {
    const diagWarning = getWarning(diagnostic);

    let error = werror || !diagWarning;
    let message = '';

    const warningOptions = [];

    if (warnings && diagWarning) {
      if (!error) {
        if (Array.isArray(diagWarning))
          error = diagWarning.every(w => w in warnings && warnings[w]);
        else
          error = warnings[diagWarning];
      }
      if (error)
        warningOptions.push('-Werror');
      warningOptions.push(
        ...(
          Array.isArray(diagWarning) ? diagWarning : [diagWarning]
        ).filter(w => w in warnings).map(w => `-W${w}`)
      );
    }

    if (diagnostic.file) {
      const { line, character } =
        diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      const messageText = ts.flattenDiagnosticMessageText(
        diagnostic.messageText, '\n'
      );
      const filename = path.relative('.', diagnostic.file.fileName);
      message = colors.bold(
        `${filename}:${line + 1}:${character + 1}: ${
        error ? colors.red('error:') : colors.magenta('warning:')
        } ${messageText}${diagWarning ? ` [${warningOptions.join(',')}]` : ''}`
      );
    } else {
      message = colors.bold(
        `${path.basename(process.argv[1])}: ${colors.red('error:')} ${
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        }`
      );
    }

    if (error) {
      ++count.errors;
      console.error(message);
    } else {
      ++count.warnings;
      console.warn(message);
    }
  }

  return count;
}

function escapeRegex(s) {
  return String(s).replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
}

async function compile(paths, options, warnings, werror) {
  options = Object.assign({}, options);

  paths = paths.map(p => path.resolve(p));
  options.outDir = path.resolve(options.outDir);

  // Map to maintain descending order
  const pathMap = new Map();

  if (options.pathMap) {
    const temp = {};
    for (const [from, to] of Object.entries(options.pathMap))
      temp[path.resolve(from)] = path.resolve(to);
    options.pathMap = temp;
    for (const from of Object.keys(options.pathMap).sort().reverse())
      pathMap.set(from, options.pathMap[from]);
  }

  // Map of input files to their output directories
  const files = {};
  // Map of input directories to their output directories
  const directories = {};

  // Map of output directories to their files
  const basenames = {};

  for (const p of paths) {
    let rootDir;
    let pathFiles;
    let isDirectory;
    if (['.ts', 'tsx'].includes(path.extname(p))) {
      rootDir = path.dirname(p);
      pathFiles = [p];
      isDirectory = false;
    } else {
      rootDir = p;
      pathFiles = (await glob(`${p}/**/*.{ts,tsx}`))
        .map(f => path.normalize(f));
      isDirectory = true;
    }
    for (const f of pathFiles) {
      if (f in files)
        throw new Error(`Duplicate file "${f}"`);
      const dir = path.dirname(f);
      const basename = path.basename(f);
      const outDir = path.join(
        options.outDir, path.relative(rootDir, dir)
      );
      if (!basenames[outDir])
        basenames[outDir] = new Set();
      if (basenames[outDir].has(basename))
        throw new Error(`File "${f}" will overwrite another file`);
      files[f] = outDir;
      basenames[outDir].add(basename);
      if (isDirectory)
        directories[dir] = outDir;
    }
  }

  const program = ts.createProgram(Object.keys(files), options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const count = processDiagnostics(diagnostics, warnings, werror);

  if (count.errors)
    return count;

  const sortedDirs = Object.values(files).map(d => d + path.sep).sort();
  for (const [i, dir] of sortedDirs.entries()) {
    if (i < sortedDirs.length - 1 && sortedDirs[i + 1].startsWith(dir))
      continue;
    await mkdirp(dir);
  }

  const sep = new RegExp(escapeRegex(path.sep), 'g');

  const transformer = context => file => {
    const filename = path.normalize(file.fileName);
    function visit(node) {
      if (
        ts.isImportDeclaration(node) ||
        ts.isImportEqualsDeclaration(node) ||
        (
          ts.isCallExpression(node) &&
          node.expression.kind == ts.SyntaxKind.ImportKeyword
        )
      )
        return ts.visitNode(node, updateImport);
      return ts.visitEachChild(node, visit, context);
    }
    function updateImport(token) {
      if (!ts.isStringLiteral(token))
        return ts.visitEachChild(token, updateImport, context);
      if (token.text[0] != '.')
        return token;
      const dir = path.dirname(filename);
      const importerOutDir = files[filename];
      const importee = path.join(dir, token.text);
      const importeeOutDir =
        directories[importee] ||
        files[importee + '.ts'] || files[importee + '.tsx'];
      let p;
      if (importeeOutDir) {
        p = path.relative(
          importerOutDir, importee in directories ? importeeOutDir :
            path.join(importeeOutDir, path.basename(importee))
        );
      } else {
        for (const [from, to] of pathMap) {
          if ((importee + path.sep).startsWith(from + path.sep)) {
            const r = path.relative(from, importee);
            p = path.relative(importerOutDir, path.join(to, r));
            break;
          }
        }
      }
      if (!p)
        return token;
      if (p[0] != '.')
        p = `.${path.sep}${p}`;
      return ts.createStringLiteral(p.replace(sep, '/'));
    }
    return ts.visitNode(file, visit);
  };

  for (const file in files) {
    if (file.endsWith('.d.ts'))
      continue;

    const outDir = files[file];
    const baseOutFile = path.join(
      outDir, path.basename(file, path.extname(file))
    );
    const jsFile = baseOutFile + '.js';
    const jsMapFile = jsFile + '.map';
    const declarationFile = baseOutFile + '.d.ts';
    const declarationMapFile = declarationFile + '.map';

    const outputs = {}

    program.emit(program.getSourceFile(file), (filename, data) => {
      for (const extension of ['.js', '.js.map', '.d.ts', '.d.ts.map']) {
        if (filename.endsWith(extension)) {
          outputs[extension] = data;
          break;
        }
      }
    }, undefined, undefined, { before: [transformer] });

    await fsWriteFile(jsFile, outputs['.js']);
    if (outputs['.js.map']) {
      const map = JSON.parse(outputs['.js.map']);
      map.sources = [path.relative(outDir, file)];
      await fsWriteFile(jsMapFile, JSON.stringify(map));
    }

    if (outputs['.d.ts'])
      await fsWriteFile(declarationFile, outputs['.d.ts']);
    if (outputs['.d.ts.map']) {
      const map = JSON.parse(outputs['.d.ts.map']);
      map.sources = [path.relative(outDir, file)];
      await fsWriteFile(declarationMapFile, JSON.stringify(map));
    }
  }

  return count;
}

async function main() {
  const parser = new ArgumentParser({
    version: require('./package.json').version,
    addHelp: true,
    description: 'TypeScript compiler'
  });

  parser.addArgument('-o', {
    dest: 'output',
    help: 'Output directory'
  });

  parser.addArgument('-d', {
    dest: 'declaration',
    help: 'Generate declarations',
    action: 'storeTrue'
  });

  parser.addArgument('-m', {
    dest: 'map',
    help: 'Generate source maps',
    action: 'storeTrue'
  });

  parser.addArgument('-p', {
    dest: 'path',
    help: 'Import path map',
    action: 'append'
  });

  parser.addArgument('-W', {
    action: 'append',
    dest: 'warning',
    help: 'Warning'
  });

  parser.addArgument('file', {
    action: 'append',
    nargs: '*'
  });

  const args = parser.parseArgs();

  let compilerOptions;

  try {
    compilerOptions = await getCompilerOptions();
  } catch (diagnostics) {
    processDiagnostics(diagnostics, null, true);
    throw new Error();
  }

  const werror = (args.warning && args.warning.includes('error'));
  const warnings = {};

  for (const option in compilerOptions) {
    const warning = optionToWarning[option];
    if (warning)
      warnings[warning] = false;
  }

  if (args.warning) {
    for (const warning of args.warning.filter(w => w != 'error')) {
      const parts = warning.split('=');
      if (parts.length > 2 || (parts.length == 2 && parts[0] != 'error'))
        throw new Error(`Invalid warning option "${warning}"`)

      const name = parts.pop();
      const option = warningToOption[name];

      if (!option)
        throw new Error(`Unknown warning option "${warning}"`);

      compilerOptions[option] = true;
      warnings[name] = parts.length == 2;
    }
  }

  if ('strict' in warnings) {
    const error = warnings['strict'];
    for (const warning of strictWarnings)
      if (!(warning in warnings))
        warnings[warning] = error;
  }

  const files = args.file[0];

  if (files.length && !args.output)
    throw new Error('Output directory is required for files');

  if (args.output)
    compilerOptions.outDir = args.output;

  if (args.declaration) {
    compilerOptions.declaration = true;
    if (args.map)
      compilerOptions.declarationMap = true;
  }

  if (args.map) {
    if (files.length)
      compilerOptions.sourceMap = true;
    else {
      compilerOptions.inlineSourceMap = true;
      compilerOptions.inlineSources = true;
    }
  }

  if (args.path) {
    const pathMap = {};
    for (const path of args.path) {
      const parts = path.split(':');
      if (parts.length > 2)
        throw new Error(`Invalid path map option "${path}"`);
      const from = parts[0];
      const to = parts[1] || from;
      pathMap[from] = to;
    }
    compilerOptions.pathMap = pathMap;
  }

  if (files.length) {
    const count = await compile(files, compilerOptions, warnings, werror);
    if (count.errors || count.warnings) {
      const messageParts = [];
      if (count.warnings)
        messageParts.push(
          `${count.warnings} ${count.warnings == 1 ? 'warning' : 'warnings'}`
        );
      if (count.errors)
        messageParts.push(
          `${count.errors} ${count.errors == 1 ? 'error' : 'errors'}`
        );
      const message = `${messageParts.join(' and ')} generated.`;
      if (count.errors) {
        console.error(message);
        throw new Error();
      } else
        console.warn(message);
    }
  } else {
    const text = await fsReadFile(process.stdin.fd, 'utf-8');
    const output = ts.transpileModule(text, { compilerOptions });
    process.stdout.write(output.outputText);
  }
}

process.once('unhandledRejection', err => { throw err; });

(async () => {
  try {
    await main();
  } catch (e) {
    if (e.message)
      console.error(`${path.basename(process.argv[1])}: ${e.message}`);
    process.exitCode = 1;
  }
})();
