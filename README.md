# gold-parser-tools README

Full VSCode integration for the GOLD Parsing System (http://goldparser.org/), including full language and testing support.

## Features

* Syntax Highlight
* Context sensetive (smart) autocomplete
* Dynamic error checking
* GOLD build integration for building grammars directly from VSCode
* Advanced Debugging capabilities
  * Allows stepping through each parser step
  * Breakpoint support
  * Advanced information about the parse steps and parsing stack
* Code Generator to embed grammars into sources
  * Typescript compatible with [Node JS Engine](https://github.com/Warfley/GoldEngines/tree/master/node)

## Usage
Simply create a `.grm` file and start working on your grammar.

The error checks are performed seperately by a custom algorithm, and might not be fully overlapping with the errors the GOLD builder will encounter.
There might be cases where the GOLD builder will accept something which is considered an error by this extension.
In those cases please file a bug report at [GitHub](https://github.com/Warfley/gold-parser-tools/issues).

To compile your grammar with the GOLD builder, just execute the Compile Gramamr command (`ctrl`+`shift`+`p` -> `GOLD: Compile Grammar`), also available via the hotkey `ctrl`+`alt`+`c`.

### Debugging: Configuration
To start the debugging functionality and parse a file simply open the file you want to parse and use the `GOLD: Parse current file` command, also accesible via the hotkey `ctrl`+`alt`+`p`.
You will be asked to select the grammar to parse the current file with.
If you choose a `.grm` source file, it will first be compiled into an `.egt`.
You can skip this step (which might take a while) by directly selecting a `.egt` or `.cgt`.

To avoid having to select the gramamr each time, or to always open the file you want to parse first, you can create a debug configuration in your `launch.json`, using the `Add Configuration...` button.
The configuration consists of a few options:
```json
{
  // Name of the configuration in the dialogue
  "name": "Parse with Grammar",
  // don't change these
  "request": "launch",
  "type": "grm",
  // the file to be parsed
  "program": "${file}",
  // the grammar to use (either grm, egt or cgt)
  "grammar": "grammar.grm",
  // Start paused to enable stepping from the first action
  "start_paused": false,
  // Output reductions in the Debug Console
  "output_reductions": true,
  // Output shifts in the Debug Console
  "output_shifts": false,
  // Output Tokens lexed in the Debug Console
  "output_tokens": false
}
```
Any of the parameters from "grammar" downwards can be ommited.
If no grammar is selected, you will be asked to choose one, the same way when using the command.
The other values default to the values shown above.
This default configuration is also what is used by the command.

### Debugging: Steps
When the debugger has paused, you have different options for stepping through the grammar.

A normal step will go to the next action of the same level.
There are two operation levels, the `Parser` level, which is triggered whenever a shift or reduction was performed, and the `Lexer` level, which is triggered when a token is lexed.
This allows to debug different parts of the grammar, with the lexer the regular expressions can be debugged, while with the parser the grammar rules can be inspected.

A step-in gets you from the `Parser` down to the `Lexer` level. If you are already on the `Lexer` level, you stay there.

Conversely a step-out on the `Lexer` level, gets you on the `Parser` level.
If you are on the parser level, a step out will get you to the next reduction, which consumes the current rule you are in.

### Debugging: Breakpoints
You can set breakpoints in the GRM file.
If the breakpoint is on the definition of a non-terminal (regex), the debugger will stop in the `Lexer` level, as soon as this regex matched a token.

If the breakpoint is on a rule, the debugger will stop on the `Parser` level when either this rule is applied for reduction, or a shift was performed, which (unambigously) belongs to this rule.

### Code Generation
To allow you to use your grammars in your own programms, without having to carry the CGT around, this extension also has a code generation option, to translate the grammar into a in-language datastructure, which can directly be used with an engine.

To start the generator you can use the command `GOLD: Generate Parser from Grammar` also available with shortcut `ctrl`+`alt`+`g`.
The command will ask you which grammar to generate the parser from.
Similar to the debugging command, you can choose a `.grm`, `.egt` or `.cgt`, and the grammar will be compiled if necessary.

After this you will be asked what you want to generate.
There are generally three options:
* `imports`: Generate the import string importing all the required packages for the generated code
* `declaration`: Generate the Declaration of the parser datastructure. For most languages this will include all the parser information
* `definition`: Some languages like C split `declaration` (Types and Structures) and `definitions` (Implementation and Values), in this case the definition option will be available to generate the implementation/value half of the parser.

Currently only a typescript (Node JS) generator is available, which provides import and declaration generation, as no definition is necessary for typescript.

## Requirements

For the building of grammars the GOLD command line binaries must be available.
After downloading them from http://goldparser.org/builder/index.htm add their path to the `gold-parser-tools.path` setting.

On Linux and other Unix systems, `wine` is required for executing the windows binaries. Make sure `wine` is installed and in the search path of your vscode instance (e.g. in `/usr/local/bin/wine`)

## References
* For more information about the GOLD parsing system, checkout their website at http://goldparser.org/builder/index.htm
* A collection of my own GOLD engines, amongst others the typescript one used by this extension can be found at: https://github.com/Warfley/GoldEngines
