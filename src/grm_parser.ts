/* eslint-disable @typescript-eslint/naming-convention */
import internal = require("stream");
import { Diagnostic, DiagnosticSeverity, LinkedEditingRangeProvider, Position, Range, TextDocument } from "vscode";

export enum TokenType {UNKNOWN=0, TERMINAL, NON_TERMINAL, SET, PARAMETER, CONST_TERMINAL, CONST_SET, OPERATOR};
const MAX_TOKEN: number = TokenType.OPERATOR;

export interface GRMToken {
  value: string;
  type: TokenType;
  location: Position;
}

interface GRMGrammarSymbols {
  defined_symbols: Map<DefinitionType, Map<string, GRMToken>>;
  used_symbols: Map<TokenType, Array<GRMToken>>;
}

interface GRMError {
  error_range: Range;
  error_message: string;
  severity: DiagnosticSeverity;
}

export enum DefinitionType {ERROR, PARAMETER, SET, TERMINAL, NON_TERMINAL};

interface GRMDefinition {
  spanning_symbol: GRMToken;
  symbols: Array<GRMToken>;
  range: Range;
  type: DefinitionType;
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

export function token_name(token: GRMToken): string {
  switch (token.type) {
    case TokenType.CONST_TERMINAL:
    case TokenType.NON_TERMINAL:
    case TokenType.PARAMETER:
    case TokenType.SET:
      return token.value.substring(1, token.value.length-1).trim();
  }
  return token.value;
}

const advance_expr = new RegExp("!\\*|[^\\s]");
const end_of_comment_expr = new RegExp("\\*!");
// See language definition
// Terminal Token: [A-Za-z0-9_.][A-Za-z0-9_.-]* // to not match (-) (not quite correct)
// Non Terminal Token: <[A-Za-z0-9\s_.-]+>
// Set Token: {.+}
// Parameter token: ".+"
// Const Terminal token: '.*' ('' is allowed)
// const set token: [.+]
// Operators: =|::=|\||\?|\+|\-|\*|\(|\)|@
const token_expr = new RegExp("([A-Za-z0-9_.][A-Za-z0-9_.-]*)|<([A-Za-z0-9\\s_.-]+)>|{(.+?)}|\"(.+?)\"|'(.*?)'|(\\[.+?\\])|(=|::=|\\||\\?|\\+|\\-|\\*|\\(|\\)|@)");

export class DocumentParser {
  private document!: TextDocument;
  // Parsing data
  private current_line: number = 0;
  private current_index: number = 0;

  // parsing results
  private errors: Array<GRMError> = [];
  private definitions: Array<GRMDefinition> = [];
  private symbols: GRMGrammarSymbols = {
      defined_symbols: new Map<DefinitionType, Map<string, GRMToken>>([
        [DefinitionType.PARAMETER, new Map<string, GRMToken>()],
        [DefinitionType.SET, new Map<string, GRMToken>()],
        [DefinitionType.TERMINAL, new Map<string, GRMToken>()],
        [DefinitionType.NON_TERMINAL, new Map<string, GRMToken>()],
      ]),
      used_symbols: new Map<TokenType, Array<GRMToken>>([
        [TokenType.SET, new Array<GRMToken>()],
        [TokenType.TERMINAL, new Array<GRMToken>()],
        [TokenType.NON_TERMINAL, new Array<GRMToken>()],
      ])
  };

  private static instances = new Map<string, DocumentParser>();
  public static get_or_create(document: TextDocument): DocumentParser {
    if (!this.instances.has(document.uri.toString())) {
      this.instances.set(document.uri.toString(), new DocumentParser(document));
    }
    return this.instances.get(document.uri.toString())!;
  }

  public static close_document(document: TextDocument) {
    this.instances.delete(document.uri.toString());
  }

  private constructor(document: TextDocument) {
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
  private advance(end_line: number): number {
    let start_line = this.current_line;
    let start_index = this.current_index;

    while (this.current_line < end_line) {
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
        let end_of_comment = rest_of_line.search(end_of_comment_expr);
        while (end_of_comment < 0) {
          if (!this.next_line()) {
            this.errors.push({
              error_range: new Range(start_line, start_index + next_match.index, this.current_line, 0),
              error_message: "Unterminated multiline comment",
              severity: DiagnosticSeverity.Error
            });
            return -1;
          }
          end_of_comment = this.remaining_line().search(end_of_comment_expr);
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

    // Advance to after this token
    this.current_index += result.value.length;
    return result;
  }

  private token_error(token: GRMToken, message: string, severity: DiagnosticSeverity = DiagnosticSeverity.Error) {
    this.errors.push({
      error_range: new Range(token.location, token.location.translate(0, token.value.length)),
      error_message: message.replace("%T", TokenType[token.type]).replace("%N", token_name(token).replace("%%", token.value)),
      severity: severity
    });
  }

  private push_definition(spanning_symbol: GRMToken) {
    let definition: GRMDefinition = {
      spanning_symbol: spanning_symbol,
      symbols: [],
      range: new Range(0, 0, 0, 0),
      type: spanning_symbol.type === TokenType.PARAMETER
          ? DefinitionType.PARAMETER
          : spanning_symbol.type === TokenType.SET
          ? DefinitionType.SET
          : spanning_symbol.type === TokenType.TERMINAL ||
            spanning_symbol.type === TokenType.CONST_TERMINAL
          ? DefinitionType.TERMINAL
          : spanning_symbol.type === TokenType.NON_TERMINAL
          ? DefinitionType.NON_TERMINAL
          : DefinitionType.ERROR
    };
    if (definition.type === DefinitionType.ERROR) {
      this.token_error(spanning_symbol, "Symbol of type %T cannot be on RHS of a declaration");
    }
    this.definitions.push(definition);
  }

  private add_to_definition(symbol: GRMToken) {
    if (this.definitions.length === 0) {
      this.push_definition(symbol);
    }
    let after_symbol = symbol.location.translate(0, symbol.value.length);
    let current_definition = this.definitions.pop()!;
    if (current_definition.symbols.length === 0) {
      // First symbol spans up the range
      current_definition.range = new Range(after_symbol, after_symbol);
    } else {
      // There is at least one symbol already part
      current_definition.range = new Range(current_definition.range.start,
                                           after_symbol);
    }
    current_definition.symbols.push(symbol);
    this.definitions.push(current_definition);
  }

  private reset(start_line: number, start_index: number) {
    // Clear Parser
    this. errors = [];
    this.definitions = [];

    this.current_line = start_line;
    this.current_index = start_index;

    this.symbols = {
      defined_symbols: new Map<DefinitionType, Map<string, GRMToken>>([
        [DefinitionType.PARAMETER, new Map<string, GRMToken>()],
        [DefinitionType.SET, new Map<string, GRMToken>()],
        [DefinitionType.TERMINAL, new Map<string, GRMToken>()],
        [DefinitionType.NON_TERMINAL, new Map<string, GRMToken>()],
      ]),
      used_symbols: new Map<TokenType, Array<GRMToken>>([
        [TokenType.SET, new Array<GRMToken>()],
        [TokenType.TERMINAL, new Array<GRMToken>()],
        [TokenType.NON_TERMINAL, new Array<GRMToken>()],
      ])
    };
  }

  private validate_param_definition(definition: GRMDefinition) {

  }

  private validate_set_definition(definition: GRMDefinition) {

  }

  private validate_terminal_definition(definition: GRMDefinition) {

  }

  private validate_non_terminal_definition(definition: GRMDefinition) {

  }

  private check_errors() {
    // first collect all symbols
    for (let definition of this.definitions) {
      if (definition.type === DefinitionType.ERROR) {
        this.errors.push({
          error_message: "Invalid definition, unable to parse",
          error_range: definition.range,
          severity: DiagnosticSeverity.Warning
        });
        continue; // Skip unparsables (maybe better handling in future)
      }
      let defined_symbol = definition.spanning_symbol;
      let definition_map = this.symbols.defined_symbols.get(definition.type)!;
      if (definition_map.has(token_name(defined_symbol))) {
        this.token_error(defined_symbol, "Redefinition of %T '%N'");
      } else {
        definition_map.set(token_name(defined_symbol), defined_symbol);
      }

      switch (definition.type) {
        case DefinitionType.PARAMETER:
          this.validate_param_definition(definition);
          break;

        case DefinitionType.SET:
          this.validate_set_definition(definition);
          break;

        case DefinitionType.TERMINAL:
          this.validate_terminal_definition(definition);
          break;

        case DefinitionType.NON_TERMINAL:
          this.validate_non_terminal_definition(definition);
          break;
      }

      // parse other symbols:
      for (let symbol of definition.symbols) {
        // undefiled chain through ? skips if not found
        this.symbols.used_symbols.get(symbol.type)?.push(symbol);
      }
    }

    // Finally collect some errors:
    this.undefined_tokens(TokenType.SET, false).forEach((token) => this.token_error(token, "Undefined SET referenced %%"));
    this.undefined_tokens(TokenType.TERMINAL, false).forEach((token) => this.token_error(token, "Undefined TERMINAL referenced %%, if you want to match the token as string please use '%%'", DiagnosticSeverity.Information));
    this.undefined_tokens(TokenType.NON_TERMINAL, false).forEach((token) => this.token_error(token, "Undefined NON-TERMINAL referenced %%"));
  }

  public parse(from: number = 0, to?: number) {
    this.reset(from, 0);
    if (to === undefined) {
      to = this.document.lineCount;
    }

    // parse loop
    let first_in_line = true;
    // Goto first token
    let eof = this.advance(to) < 0;
    while (!eof) {
      let token = this.read_token();
      if (token.type !== TokenType.OPERATOR && first_in_line) {
        this.push_definition(token);
      } else {
        this.add_to_definition(token);
      }
      let advanced = this.advance(to);
      eof = advanced < 0;
      first_in_line = advanced > 0;
    }
  }

  public update_diagnostics() {
    let diagnostics: Array<Diagnostic> = [];
    /* DEBUG: Show recognized contexts
    for (let context of this.context_ranges) {
      diagnostics.push(new Diagnostic(context.range, ParserContext[context.context], DiagnosticSeverity.Warning));
    }
    */
    for (let error of this.errors) {
      diagnostics.push(new Diagnostic(error.error_range, error.error_message, error.severity));
    }
    globalThis.diagnostics_collection.set(this.document.uri, diagnostics);
  }

  public all_tokens(type: TokenType, unique: boolean = true): Array<GRMToken> {
    let result: Array<GRMToken> = [];
    let added: Set<string> = new Set<string>();

    let tokens = this.symbols.used_symbols.get(type);
    if (tokens === undefined) {
      return result;
    }

    for (let token of tokens) {
      let key = token_name(token);
      if (!unique ||!added.has(key)) {
        result.push(token);
        added.add(key);
      }
    }

    let defined = this.symbols.defined_symbols.get(
        type === TokenType.SET
      ? DefinitionType.SET
      : type === TokenType.TERMINAL
      ? DefinitionType.TERMINAL
      : type === TokenType.NON_TERMINAL
      ? DefinitionType.NON_TERMINAL
      : DefinitionType.ERROR
    );
    if (defined === undefined) {
      return result;
    }

    for (let token of defined.values()) {
      let key = token_name(token);
      if (!unique || !added.has(key)) {
        result.push(token);
        added.add(key);
      }
    }

    return result;
  }

  public undefined_tokens(type: TokenType, unique: boolean = true): Array<GRMToken> {
    let tokens = this.all_tokens(type, unique);
    let defined = this.symbols.defined_symbols.get(
        type === TokenType.SET
      ? DefinitionType.SET
      : type === TokenType.TERMINAL
      ? DefinitionType.TERMINAL
      : type === TokenType.NON_TERMINAL
      ? DefinitionType.NON_TERMINAL
      : DefinitionType.ERROR
    );
    if (defined === undefined) {
      return tokens;
    }
    let result = tokens.filter((token) => defined!.has(token_name(token)));

    return result;
  }

  public definition_at(position: Position): GRMDefinition|undefined {
    for (let definition of this.definitions) {
      if (position.line === definition.range.start.line) {
        return position.character >= definition.range.start.character
             ? definition
             : undefined;
      } else if (position.line > definition.range.start.line &&
                 position.line <= definition.range.end.line) {
        // A defenition can only start with a new line
        // therefore no char position check required
        return definition;
      }
    }

    return undefined;
  }
}
