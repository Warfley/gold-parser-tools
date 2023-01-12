/* eslint-disable @typescript-eslint/naming-convention */
import { Diagnostic, DiagnosticSeverity, Position, Range, TextDocument } from "vscode";

export enum TokenType {UNKNOWN=0, TERMINAL, NON_TERMINAL, SET, PARAMETER, CONST_TERMINAL, CONST_SET, OPERATOR};
const MAX_TOKEN: number = TokenType.OPERATOR;

export interface GRMToken {
  value: string;
  type: TokenType;
  location: Position;
}

interface GRMDefinedSymbols {
  sets: Map<string, GRMToken>;
  non_terminals: Map<string, GRMToken>;
  terminals: Map<string, GRMToken>;
}

interface GRMSymbols {
  sets: Array<GRMToken>;
  non_terminals: Array<GRMToken>;
  terminals: Array<GRMToken>;
}

interface GRMError {
  error_range: Range;
  error_message: string;
}

export enum ParserContext {NONE, ERROR, PARAM, SET, TERMINAL, NON_TERMINAL};

interface GRMContextRange {
  range: Range,
  context: ParserContext
}

const DEFAULT_SETS: Array<GRMToken> = [
  {
    value: "{Space}",
    type: TokenType.SET,
    location: new Position(0, 0)
  },
  {
    value: "{Digit}",
    type: TokenType.SET,
    location: new Position(0, 0)
  },
  {
    value: "{Letter}",
    type: TokenType.SET,
    location: new Position(0, 0)
  },
  {
    value: "{Printable}",
    type: TokenType.SET,
    location: new Position(0, 0)
  },
  {
    value: "{CR}",
    type: TokenType.SET,
    location: new Position(0, 0)
  },
  {
    value: "{LF}",
    type: TokenType.SET,
    location: new Position(0, 0)
  },
  {
    value: "{Alphanumeric}",
    type: TokenType.SET,
    location: new Position(0, 0)
  },
  {
    value: "{Whitespace}",
    type: TokenType.SET,
    location: new Position(0, 0)
  }
];

const advance_expr = new RegExp("!\\*|[^\\s]");
// See language definition
// Terminal Token: [A-Za-z0-9_.-]+
// Non Terminal Token: <[A-Za-z0-9\s_.-]+>
// Set Token: {.+}
// Parameter token: ".+"
// Const Terminal token: '.+'
// const set token: [.+]
// Operators: =|::=|\||\?|\+|\-|\*|\(|\)|@
const token_expr = new RegExp("([A-Za-z0-9_.-]+)|<([A-Za-z0-9\\s_.-]+)>|{(.+?)}|\"(.+?)\"|'(.+?)'|(\\[.+?\\])|(=|::=|\\||\\?|\\+|\\-|\\*|\\(|\\)|@)");

export class DocumentParser {
  defined_symbols: GRMDefinedSymbols = {
      sets: new Map<string, GRMToken>(),
      non_terminals: new Map<string, GRMToken>(),
      terminals: new Map<string, GRMToken>()
    };
  used_symbols: GRMSymbols = {
      sets: [],
      non_terminals: [],
      terminals: []
  };
  errors: Array<GRMError> = [];
  context_ranges: Array<GRMContextRange> = [];


  private document!: TextDocument;
  private current_line: number = 0;
  private current_index: number = 0;
  private current_context: ParserContext = ParserContext.NONE;
  private expect_equal: boolean = false;
  private last_token?: GRMToken = undefined;

  constructor(document: TextDocument) {
    this.document = document;
  }

  private remaining_line(): string {
    return this.document.lineAt(this.current_line).text.substring(this.current_index);
  }

  private next_line(): boolean {
    this.current_index = 0;
    ++this.current_line;
    return this.current_line < this.document.lineCount;
  }

  // Advances to the next token
  private advance(): number {
    let start_line = this.current_line;
    let start_index = this.current_index;

    while (this.current_line < this.document.lineCount) {
      let rest_of_line = this.remaining_line();
      // find next token in rest of line
      let next_match = advance_expr.exec(rest_of_line);
      if (next_match === null) {
        // No token in this line, advance to next line
        this.next_line();
        continue;
      }
      // Token found, check if comment
      if (next_match[0] === "!") {
        // Single line comment
        this.next_line();
        continue;
      }
      if (next_match[0] === "!*") {
        let end_of_comment = rest_of_line.search("*!");
        while (end_of_comment < 0) {
          if (!this.next_line()) {
            this.errors.push({
              error_range: new Range(start_line, start_index + next_match.index, this.current_line, 0),
              error_message: "Unterminated multiline comment"
            });
            return -1;
          }
          end_of_comment = this.remaining_line().search("*!");
        }
        this.current_index = end_of_comment + 2;
        continue;
      }
      // not a comment, advance to next token
      this.current_index += next_match.index;
      // return the number of lines advanced
      return this.current_line - start_line;
    }
    return -1; // EOF
  }

  private read_token(): GRMToken {
    let rest_of_line = this.remaining_line();
    let match = token_expr.exec(rest_of_line);
    let current_location = new Position(this.current_line, this.current_index);

    let result!: GRMToken;
    if (match === null) {
      result = {
        value: rest_of_line,
        type: TokenType.UNKNOWN,
        location: current_location
      };
    } else if (match.index > 0) {
      result = {
        value: rest_of_line.substring(0, match.index),
        type: TokenType.UNKNOWN,
        location: current_location
      };
    } else {
      let found = false;
      for (let i=1; i<=MAX_TOKEN; ++i) {
        if (match[i] !== undefined) {
          found = true;
          result = {
            value: match[0],
            type: i,
            location: current_location
          };
          break;
        }
      }
      if (!found) {
        result = {
          value: match[0],
          type: TokenType.UNKNOWN,
          location: current_location
        };
      }
    }

    if (result.type === TokenType.UNKNOWN) {
      this.errors.push({
        error_range: new Range(current_location, new Position(this.current_line, this.current_index + result.value.length)),
        error_message: "Unknown token found: " + result.value
      });
    }
    // Advance to after this token
    this.current_index += result.value.length;
    return result;
  }

  private token_error(token: GRMToken, message: string) {
    this.errors.push({
      error_range: new Range(token.location, token.location.translate(0, token.value.length)),
      error_message: message.replace("%%", token.value)
    });
  }

  private update_context(new_context: ParserContext) {
    // close current context range
    if (this.last_token !== undefined && this.context_ranges.length > 0) {
      let last_context = this.context_ranges.pop()!;
      if (last_context.context === this.current_context) {
        last_context.range = new Range(last_context.range.start, this.last_token.location.translate(0, this.last_token.value.length));
        this.context_ranges.push(last_context);
      }
    }
    this.current_context = new_context;
  }

  private push_context(token: GRMToken) {
    if (this.current_context === ParserContext.ERROR ||
        this.current_context === ParserContext.NONE) {
      return;
    }
    // Push new context range from this point forward
    this.context_ranges.push({
      context: this.current_context,
      range: new Range(token.location.translate(0, token.value.length),
                       token.location.translate(0, token.value.length))
    });
  }

  private push_defined_symbols(token: GRMToken) {
    if (token.type === TokenType.CONST_TERMINAL
     || token.type === TokenType.TERMINAL) {
      if (this.defined_symbols.terminals.has(token.value)) {
        this.token_error(token, "Redefinition of TERMINAL %%");
      } else {
        this.defined_symbols.terminals.set(token.value, token);
      }
    } else if (token.type === TokenType.NON_TERMINAL) {
      if (this.defined_symbols.non_terminals.has(token.value)) {
        this.token_error(token, "Redefinition of NON-TERMINAL %%");
      } else {
        this.defined_symbols.non_terminals.set(token.value, token);
      }
    } else if (token.type === TokenType.SET) {
      if (this.defined_symbols.sets.has(token.value)) {
        this.token_error(token, "Redefinition of SET %%");
      } else {
        this.defined_symbols.sets.set(token.value, token);
      }
    }
  }

  private parse_token(first_in_line: boolean) {
    let token = this.read_token();
    // If we expect ::= (for non terminals) or =
    let has_expected_equal = this.expect_equal;
    if (this.expect_equal) {
      if (this.current_context === ParserContext.NON_TERMINAL
       && token.value !== "::=") {
        this.token_error(token, "Expected '::=' got %%");
      } else if (this.current_context !== ParserContext.NON_TERMINAL
              && token.value !== "=") {
        this.token_error(token, "Expected '=' got %%");
      }
    }
    // Reset for next round
    this.expect_equal = false;

    switch (token.type) {
      case TokenType.UNKNOWN:
        if (first_in_line) {
          this.update_context(ParserContext.ERROR);
        }
        // Nothing to do for unreckognized tokens
        break;

      case TokenType.TERMINAL:
        if (first_in_line) {
          this.update_context(ParserContext.TERMINAL);
          this.expect_equal = true;
          this.push_defined_symbols(token);
        } else if (this.current_context !== ParserContext.PARAM) {
          this.used_symbols.terminals.push(token);
          if (this.current_context === ParserContext.SET) {
            this.token_error(token, "TERMINAL symbols are not allowed in SET definitions");
          }
        }
        break;

      case TokenType.NON_TERMINAL:
        if (first_in_line) {
          this.update_context(ParserContext.NON_TERMINAL);
          this.expect_equal = true;
          this.push_defined_symbols(token);
        } else {
          this.used_symbols.non_terminals.push(token);
          if (this.current_context === ParserContext.SET
           || this.current_context === ParserContext.TERMINAL) {
            this.token_error(token, "NON-TERMINAL symbols are only allowed in NON-TERMINAL definitions");
          }
        }
        break;

      case TokenType.SET:
        if (first_in_line) {
          this.update_context(ParserContext.SET);
          this.expect_equal = true;
          this.push_defined_symbols(token);
        } else if (this.current_context !== ParserContext.PARAM) {
          if (this.current_context === ParserContext.NON_TERMINAL) {
            this.token_error(token, "SET definitions are not allowed in NON-TERMINAL definitions");
        }
          this.used_symbols.sets.push(token);
        }
        break;

      case TokenType.PARAMETER:
        if (first_in_line) {
          this.update_context(ParserContext.PARAM);
          this.expect_equal = true;
        } else {
          this.token_error(token, "Parameters must always be on the left hand side");
        }
        break;

      case TokenType.CONST_TERMINAL:
        if (first_in_line) {
          this.update_context(ParserContext.NON_TERMINAL);
          this.expect_equal = true;
          this.push_defined_symbols(token);
        }
        break;

      case TokenType.CONST_SET:
        if (first_in_line) {
          this.update_context(ParserContext.NONE);
          this.token_error(token, "Const set definitions are only allowed on the right hand side of definitions");
        } else if (this.current_context === ParserContext.NON_TERMINAL) {
          this.token_error(token, "SET definitions are not allowed in NON-TERMINAL definitions");
        }
        break;

      case TokenType.OPERATOR:
        if (token.value === "::=" || token.value === "=") {
          this.push_context(token);
        }
        // Equal can always be in new line, and equal checks where already performed
        if (first_in_line && !has_expected_equal) {
          if (this.current_context === ParserContext.NON_TERMINAL &&
              token.value !== "|") {
            this.token_error(token, "Expected '|' but got %%");
          } else if (this.current_context === ParserContext.SET &&
                     token.value !== "+" &&
                     token.value !== "-") {
            this.token_error(token, "Expected '+' or '-' got %%");
          } else if (this.current_context === ParserContext.TERMINAL &&
                     token.value !== "|") {
            this.token_error(token, "Expected '|' got %%");
          }
        }
        break;
    }

    this.last_token = token;
  }

  public parse() {
    // Clear Parser
    this.defined_symbols = {
      sets: new Map<string, GRMToken>(),
      non_terminals: new Map<string, GRMToken>(),
      terminals: new Map<string, GRMToken>()
    };
    DEFAULT_SETS.forEach((token) => this.defined_symbols.sets.set(token.value, token));
    this.used_symbols = {
        sets: [],
        non_terminals: [],
        terminals: []
    };
    this. errors = [];
    this.context_ranges = [];

    this.current_line = 0;
    this.current_index = 0;
    this.current_context = ParserContext.NONE;
    this.expect_equal = false;
    this.last_token = undefined;

    // parse loop
    let first_in_line = true;
    let eof = this.advance() < 0;
    while (!eof) {
      this.parse_token(first_in_line);
      let advanced = this.advance();
      eof = advanced < 0;
      first_in_line = advanced > 0;
    }
    this.update_context(ParserContext.NONE);

    // Finally collect some errors:
    this.undefined_tokens(TokenType.SET, false).forEach((token) => this.token_error(token, "Undefined SET referenced %%"));
    this.undefined_tokens(TokenType.TERMINAL, false).forEach((token) => this.token_error(token, "Undefined TERMINAL referenced %%"));
    this.undefined_tokens(TokenType.NON_TERMINAL, false).forEach((token) => this.token_error(token, "Undefined NON-TERMINAL referenced %%"));
  }

  public update_diagnostics() {
    let diagnostics: Array<Diagnostic> = [];

    for (let error of this.errors) {
      diagnostics.push(new Diagnostic(error.error_range, error.error_message, DiagnosticSeverity.Error));
    }
    globalThis.diagnostics_collection.set(this.document.uri, diagnostics);
  }

  public all_tokens(type: TokenType, unique: boolean = true): Array<GRMToken> {
    let result: Array<GRMToken> = [];
    let added: Set<string> = new Set<string>();

    let tokens = type === TokenType.SET
               ? this.used_symbols.sets
               : type === TokenType.TERMINAL
               ? this.used_symbols.terminals
               : this.used_symbols.non_terminals;

    for (let token of tokens) {
      if (!unique ||!added.has(token.value)) {
        result.push(token);
        added.add(token.value);
      }
    }

    let defined = type === TokenType.SET
                ? this.defined_symbols.sets
                : type === TokenType.TERMINAL
                ? this.defined_symbols.terminals
                : this.defined_symbols.non_terminals;

    for (let token of defined.values()) {
      if (!unique || !added.has(token.value)) {
        result.push(token);
        added.add(token.value);
      }
    }

    return result;
  }

  public undefined_tokens(type: TokenType, unique: boolean = true): Array<GRMToken> {
    let tokens = this.all_tokens(type, unique);
    let defined = type === TokenType.SET
                ? this.defined_symbols.sets
                : type === TokenType.TERMINAL
                ? this.defined_symbols.terminals
                : this.defined_symbols.non_terminals;
    let result = tokens.filter((token) => !defined.has(token.value));

    return result;
  }
}
