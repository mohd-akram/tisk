#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const util = require('util');

const ArgumentParser = require('argparse').ArgumentParser;
const colors = require('colors');
const ts = require('typescript');

const fsReadFile = util.promisify(fs.readFile);

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

function compile(fileNames, options, warnings, werror) {
  const program = ts.createProgram(fileNames, options);
  const emitResult = program.emit();

  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emitResult.diagnostics);

  return processDiagnostics(diagnostics, warnings, werror);
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

  if (args.declaration)
    compilerOptions.declaration = true;

  if (args.map) {
    if (files.length)
      compilerOptions.sourceMap = true;
    else {
      compilerOptions.inlineSourceMap = true;
      compilerOptions.inlineSources = true;
    }
  }

  if (files.length) {
    const count = compile(files, compilerOptions, warnings, werror);
    if (count.errors || count.warnings) {
      let messageParts = [];
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
    const text = await fsReadFile(process.stdin.fd, { encoding: 'utf-8' });
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
