# gold-parser-tools README

Full VSCode integration for the GOLD Parsing System (http://goldparser.org/), including full language and testing support.

## Features

* Syntax Highlight
* Context sensetive (smart) autocomplete
* Dynamic error checking
* GOLD build integration for building grammars directly from VSCode
* GOLD testing capabilities for executing grammars on input files

## Requirements

For the building of grammars the GOLD command line binaries must be available.
After downloading them from http://goldparser.org/builder/index.htm add their path to the `gold-parser-tools.path` setting.

On Linux and other Unix systems, `wine` is required for executing the windows binaries. Make sure `wine` is installed and in the search path of your vscode instance (e.g. in `/usr/local/bin/wine`)
