/* eslint-disable @typescript-eslint/naming-convention */
import { Diagnostic, DiagnosticSeverity, Position, Range, TextDocument } from "vscode";

export enum TokenType {UNKNOWN=0, TERMINAL, NON_TERMINAL, SET, PARAMETER, CONST_TERMINAL, OPERATOR, CONST_SET};
const MAX_TOKEN: number = TokenType.CONST_SET;

export interface GRMToken {
  value: string;
  type: TokenType;
  location: Position;
  hint?: string;
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

export interface GRMDefinition {
  symbols: Array<GRMToken>;
  range: Range;
  type: DefinitionType;
}

export interface GRMRule {
  produces: GRMToken;
  consumes: Array<GRMToken>;
  line: number;
}

export function parse_rules(definition: GRMDefinition): Array<GRMRule> {
  if (definition.type !== DefinitionType.NON_TERMINAL) {
    return [];
  }
  let result: Array<GRMRule> = [];
  let current_rule: GRMRule = {
    produces: definition.symbols[0],
    consumes: [],
    line: definition.range.start.line
  };
  for (let i=2; i<definition.symbols.length; ++i) {
    let symbol = definition.symbols[i];
    if (symbol.type === TokenType.OPERATOR) {
      result.push(current_rule);
      current_rule = {
        produces: definition.symbols[0],
        consumes: [],
        line: symbol.location.line
      };
    } else {
      current_rule.consumes.push(symbol);
    }
  }
  result.push(current_rule);
  return result;
}

function default_set(name: string, hint?: string): GRMToken {
  return {
    value: name,
    type: TokenType.SET,
    location: new Position(0, 0),
    hint: hint
  };
}

/* Exctracted from http://goldparser.org/doc/grammars/index.htm with
let s=""
for (let tr of trs) {
  let set = tr.children[0].innerText;
  if (!set.startsWith("{")) continue;
  let call = 'default_set("' + set + '"';
  if (tr.children.length === 3) call += ', "' + tr.children[2].innerText + '"';
  s += call + "),\n"
}
*/

const DEFAULT_SETS: Array<GRMToken> = [
default_set("{HT}", "Horizontal Tab character."),
default_set("{LF}", "Line Feed character."),
default_set("{VT}", "Vertical Tab character. This character is rarely used."),
default_set("{FF}", "Form Feed character. This character is also known as 'New Page'."),
default_set("{CR}", "Carriage Return character {#13}."),
default_set("{Space}", "Space character. Technically, this set is not needed since a 'space' can be expressed by using single quotes: ' '. The set was added to allow the developer to more explicitly indicate the character and add readability."),
default_set("{NBSP}", "No-Break Space character. The No-Break Space character is used to represent a space where a line break is not allowed. It is often used in source code for indentation."),
default_set("{LS}", "Unicode Line Separator"),
default_set("{PS}", "Unicode Paragraph Separator"),
default_set("{Number}", "0123456789"),
default_set("{Digit}", "0123456789\nThis set is maintained to support older grammars. The term 'digit' is technically inaccurate and this set will eventually be removed, but not for a long time. Please use the {Number} set."),
default_set("{Letter}", "abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
default_set("{AlphaNumeric}", "This set includes all the characters in {Letter} and {Number}"),
default_set("{Printable}", "This set includes all standard characters that can be printed onscreen. This includes the characters from  #32 to #127 and  #160 (No-Break Space). The No-Break Space character was included since it is often used in source code."),
default_set("{Letter Extended}", "This set includes all the letters which are part of the extended characters in the first 256 characters (ANSI)."),
default_set("{Printable Extended}", "This set includes all the printable characters above #127. Although rarely used in programming languages, they could be used, for instance, as valid characters in a string literal."),
default_set("{Whitespace}", "This set includes all characters that are normally considered whitespace and ignored by the parser. The set consists of the Space, Horizontal  Tab, Line Feed, Vertical Tab, Form Feed, Carriage Return and No-Break Space."),
default_set("{All Valid}", "The {All Valid} character set contains every valid character in the Basic Multilingual Plane of the Unicode Character Set. This includes the characters from &1 to &D7FF and  &DC00 to &FFEF.\n Please note that this set also includes whitespace and control characters that are rarely used in programming languages.  It is only available in versions 2.6 and later of the Builder."),
default_set("{ANSI Mapped}", "This set contains the characters between 128 and 159 that have different values in Unicode. The set is only available in versions 2.0.6 and later of the Builder."),
default_set("{ANSI Printable}", "This set contains all printable characters available in ANSI. Essentially, this is a union of {Printable}, {Printable Extended} and {ANSI Mapped}.  The set is only available in versions 2.0.6 and later of the Builder."),
default_set("{Control Codes}", "This set includes the characters from 1 to 31 and from 127 to 159.  It is only available in versions 2.6 and later of the Builder."),
default_set("{Euro Sign}", "The Euro Currency Sign."),
default_set("{Formatting}", "Unicode formatting characters."),
default_set("{All Latin}"),
default_set("{All Letters}"),
default_set("{All Printable}"),
default_set("{All Space}"),
default_set("{All Newline}"),
default_set("{All Whitespace}"),
default_set("{Basic Latin}"),
default_set("{Latin-1 Supplement}"),
default_set("{Latin Extended-A}"),
default_set("{Latin Extended-B}"),
default_set("{IPA Extensions}"),
default_set("{Spacing Modifier Letters}"),
default_set("{Combining Diacritical Marks}"),
default_set("{Greek and Coptic}"),
default_set("{Cyrillic}"),
default_set("{Cyrillic Supplement}"),
default_set("{Armenian}"),
default_set("{Hebrew}"),
default_set("{Arabic}"),
default_set("{Syriac}"),
default_set("{Arabic Supplement}"),
default_set("{Thaana}"),
default_set("{NKo}"),
default_set("{Samaritan}"),
default_set("{Devanagari}"),
default_set("{Bengali}"),
default_set("{Gurmukhi}"),
default_set("{Gujarati}"),
default_set("{Oriya}"),
default_set("{Tamil}"),
default_set("{Telugu}"),
default_set("{Kannada}"),
default_set("{Malayalam}"),
default_set("{Sinhala}"),
default_set("{Thai}"),
default_set("{Lao}"),
default_set("{Tibetan}"),
default_set("{Myanmar}"),
default_set("{Georgian}"),
default_set("{Hangul Jamo}"),
default_set("{Ethiopic}"),
default_set("{Ethiopic Supplement}"),
default_set("{Cherokee}"),
default_set("{Unified Canadian Aboriginal Syllabics}"),
default_set("{Ogham}"),
default_set("{Runic}"),
default_set("{Tagalog}"),
default_set("{Hanunoo}"),
default_set("{Buhid}"),
default_set("{Tagbanwa}"),
default_set("{Khmer}"),
default_set("{Mongolian}"),
default_set("{Unified Canadian Aboriginal Syllabics Extended}"),
default_set("{Limbu}"),
default_set("{Tai Le}"),
default_set("{New Tai Lue}"),
default_set("{Khmer Symbols}"),
default_set("{Buginese}"),
default_set("{Tai Tham}"),
default_set("{Balinese}"),
default_set("{Sundanese}"),
default_set("{Lepcha}"),
default_set("{Ol Chiki}"),
default_set("{Vedic Extensions}"),
default_set("{Phonetic Extensions}"),
default_set("{Phonetic Extensions Supplement}"),
default_set("{Combining Diacritical Marks Supplement}"),
default_set("{Latin Extended Additional}"),
default_set("{Greek Extended}"),
default_set("{General Punctuation}"),
default_set("{Superscripts and Subscripts}"),
default_set("{Currency Symbols}"),
default_set("{Combining Diacritical Marks for Symbols}"),
default_set("{Letterlike Symbols}"),
default_set("{Number Forms}"),
default_set("{Arrows}"),
default_set("{Mathematical Operators}"),
default_set("{Miscellaneous Technical}"),
default_set("{Control Pictures}"),
default_set("{Optical Character Recognition}"),
default_set("{Enclosed Alphanumerics}"),
default_set("{Box Drawing}"),
default_set("{Block Elements}"),
default_set("{Geometric Shapes}"),
default_set("{Miscellaneous Symbols}"),
default_set("{Dingbats}"),
default_set("{Miscellaneous Mathematical Symbols-A}"),
default_set("{Supplemental Arrows-A}"),
default_set("{Braille Patterns}"),
default_set("{Supplemental Arrows-B}"),
default_set("{Miscellaneous Mathematical Symbols-B}"),
default_set("{Supplemental Mathematical Operators}"),
default_set("{Miscellaneous Symbols and Arrows}"),
default_set("{Glagolitic}"),
default_set("{Latin Extended-C}"),
default_set("{Coptic}"),
default_set("{Georgian Supplement}"),
default_set("{Tifinagh}"),
default_set("{Ethiopic Extended}"),
default_set("{Cyrillic Extended-A}"),
default_set("{Supplemental Punctuation}"),
default_set("{CJK Radicals Supplement}"),
default_set("{Kangxi Radicals}"),
default_set("{Ideographic Description Characters}"),
default_set("{CJK Symbols and Punctuation}"),
default_set("{Hiragana}"),
default_set("{Katakana}"),
default_set("{Bopomofo}"),
default_set("{Hangul Compatibility Jamo}"),
default_set("{Kanbun}"),
default_set("{Bopomofo Extended}"),
default_set("{CJK Strokes}"),
default_set("{Katakana Phonetic Extensions}"),
default_set("{Enclosed CJK Letters and Months}"),
default_set("{CJK Compatibility}"),
default_set("{CJK Unified Ideographs Extension A}"),
default_set("{Yijing Hexagram Symbols}"),
default_set("{CJK Unified Ideographs}"),
default_set("{Yi Syllables}"),
default_set("{Yi Radicals}"),
default_set("{Lisu}"),
default_set("{Vai}"),
default_set("{Cyrillic Extended-B}"),
default_set("{Bamum}"),
default_set("{Modifier Tone Letters}"),
default_set("{Latin Extended-D}"),
default_set("{Syloti Nagri}"),
default_set("{Common Indic Number Forms}"),
default_set("{Phags-pa}"),
default_set("{Saurashtra}"),
default_set("{Devanagari Extended}"),
default_set("{Kayah Li}"),
default_set("{Rejang}"),
default_set("{Hangul Jamo Extended-A}"),
default_set("{Javanese}"),
default_set("{Cham}"),
default_set("{Myanmar Extended-A}"),
default_set("{Tai Viet}"),
default_set("{Meetei Mayek}"),
default_set("{Hangul Syllables}"),
default_set("{Hangul Jamo Extended-B}"),
default_set("{Private Use Area}"),
default_set("{CJK Compatibility Ideographs}"),
default_set("{Alphabetic Presentation Forms}"),
default_set("{Arabic Presentation Forms-A}"),
default_set("{Variation Selectors}"),
default_set("{Vertical Forms}"),
default_set("{Combining Half Marks}"),
default_set("{CJK Compatibility Forms}"),
default_set("{Small Form Variants}"),
default_set("{Arabic Presentation Forms-B}"),
default_set("{Halfwidth and Fullwidth Forms}"),
];

export function token_name(token: GRMToken): string {
  switch (token.type) {
    case TokenType.CONST_TERMINAL:
    case TokenType.NON_TERMINAL:
    case TokenType.PARAMETER:
    case TokenType.SET:
      return token.value.substring(1, token.value.length-1).trim().toLowerCase();
  }
  return token.value.toLocaleLowerCase();
}

const advance_expr = new RegExp("!\\*|[^\\s]");
const end_of_comment_expr = new RegExp("\\*!");
const set_range_expr = new RegExp("\\s*(#\\d+|&[0-9a-fA-F]{1,4})(\\s*\\.\\.\\s*(#\\d+|&[0-9a-fA-F]{1,4}))?\\s*");
// See language definition
// Terminal Token: [A-Za-z0-9_.][A-Za-z0-9_.-]* // to not match (-) (not quite correct)
// Non Terminal Token: <[A-Za-z0-9\s_.-]+>
// Set Token: {.+}
// Parameter token: ".+"
// Const Terminal token: '.*' ('' is allowed)
// Operators: =|::=|\||\?|\+|\-|\*|\(|\)|@
// const set token: \[([^\[\]']|'[^']*')+\]
const token_expr = new RegExp("([A-Za-z0-9_.][A-Za-z0-9_.-]*)|<([A-Za-z0-9\\s_.-]+)>|{(.+?)}|\"(.+?)\"|'(.*?)'|(=|::=|\\||\\?|\\+|\\-|\\*|\\(|\\)|@)|(\\[([^\\[\\]']|'[^']*')+\\])");

const required_parameter = [
    "name",
    "version",
    "author",
    "about",
    "case sensitive",
    "start symbol",
];

export class DocumentParser {
  private document!: TextDocument;
  // Parsing data
  private current_line: number = 0;
  private current_index: number = 0;

  // parsing results
  private errors: Array<GRMError> = [];
  private definitions: Array<GRMDefinition> = [];
  public symbols: GRMGrammarSymbols = {
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
      error_message: message.replace("%T", TokenType[token.type]).replace("%N", token_name(token)).replace("%%", token.value),
      severity: severity
    });
  }

  private push_definition(spanning_symbol: GRMToken) {
    let definition: GRMDefinition = {
      symbols: [spanning_symbol],
      range: new Range(spanning_symbol.location, spanning_symbol.location),
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
    current_definition.range = new Range(current_definition.range.start,
                                          after_symbol);
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
    for (let set of DEFAULT_SETS) {
      this.symbols.defined_symbols.get(DefinitionType.SET)!.set(token_name(set), set);
    }
  }

  private incomplete_definition_error(definition: GRMDefinition, expected: string) {
    let last_symbol = definition.symbols[definition.symbols.length - 1];
    this.errors.push({
      error_message: "Incomplete " + DefinitionType[definition.type] +
                     " definition (expected \"%T " + expected + "\")",
      error_range: new Range(last_symbol.location.translate(0, last_symbol.value.length),
                             this.document.lineAt(last_symbol.location.line).range.end),
      severity: DiagnosticSeverity.Error
    });
  }

  private validate_param_definition(definition: GRMDefinition) {
    if (definition.symbols.length < 3) {
      this.incomplete_definition_error(definition, "= VALUE [VALUES ...]");
      return;
    }
    if (definition.symbols[1].value !== "=") {
      this.token_error(definition.symbols[1], "Expected OPERATOR =, but found %T %%");
    }
    let param_key = token_name(definition.symbols[0]);
    let value_token = definition.symbols[2];
    if (param_key === "Case Sensitive" &&
        value_token.value !== "True" &&
        value_token.value !== "False") {
      this.token_error(value_token, "Expected boolean values (True|False) got %T %%");
    } else if (param_key === "Start Symbol" &&
               value_token.type !== TokenType.NON_TERMINAL) {
      this.token_error(value_token, "Expected NON-TERMINAL symbol got %T %%");
    }
    if (param_key === "Name" ||
        param_key === "Version" ||
        param_key === "Author" ||
        param_key === "About") {
      if (value_token.type !== TokenType.CONST_TERMINAL) {
        this.token_error(value_token, "Expected a single quoted string literal, got %T %%");
      }
      for (let i=3; i<definition.symbols.length; ++i) {
        this.token_error(definition.symbols[i], "Unexpected %T %%, expected EOL");
      }
    }
  }

  private validate_set_definition(definition: GRMDefinition) {
    if (definition.symbols.length < 3) {
      this.incomplete_definition_error(definition, "= SET [+|- SET...]");
      return;
    }
    if (definition.symbols[1].value !== "=") {
      this.token_error(definition.symbols[1], "Expected OPERATOR =, but found %T %%");
    }
    let expect_set = true;
    for (let i=2; i<definition.symbols.length; ++i) {
      let symbol = definition.symbols[i];
      if (symbol.type === TokenType.CONST_SET || symbol.type === TokenType.SET) {
        if (!expect_set) {
          this.token_error(symbol, "Expected OPERATOR +/- got %T %N");
        }
        expect_set = false;
      } else if (symbol.type === TokenType.OPERATOR) {
        if (symbol.value !== "+" && symbol.value !== "-") {
          this.token_error(symbol, "Expected OPERATOR +/- got %T %N");
        } else if (expect_set) {
          this.token_error(symbol, "Expected a SET got %T %%");
        }
        expect_set = true;
      } else {
        this.token_error(symbol, "Unexpected %T %%, SET definitions must be of form SET [+|- SET...]");
      }
    }
  }

  private validate_terminal_definition(definition: GRMDefinition) {
    if (definition.symbols.length < 3) {
      this.incomplete_definition_error(definition, "= REGEX");
      return;
    }
    let start_index = 1;
    if (definition.symbols[0].value === "Comment" &&
         (definition.symbols[1].value === "Line" ||
          definition.symbols[1].value === "Start" ||
          definition.symbols[1].value === "End")
    ){
      start_index = 2;
      if (definition.symbols.length < 4) {
        this.incomplete_definition_error(definition, "= REGEX");
        return;
      }
    }
    if (definition.symbols[start_index].value !== "=") {
      this.token_error(definition.symbols[start_index + 1], "Expected OPERATOR =, but found %T %%");
    }
    if (definition.symbols[start_index + 1].type !== TokenType.CONST_SET &&
        definition.symbols[start_index + 1].type !== TokenType.SET &&
        definition.symbols[start_index + 1].type !== TokenType.TERMINAL &&
        definition.symbols[start_index + 1].type !== TokenType.CONST_TERMINAL &&
        definition.symbols[start_index + 1].value !== "(") {
      this.token_error(definition.symbols[start_index + 1], "Invalid regular expression symbol %T %%");
    }
    let bracket_stack: Array<GRMToken> = [];
    for (let i=start_index + 1; i<definition.symbols.length; ++i) {
      let symbol = definition.symbols[i];
      if (symbol.type === TokenType.OPERATOR) {
        if (symbol.value === "(") {
          bracket_stack.push(symbol);
        } else if (symbol.value === ")") {
          if (bracket_stack.length === 0) {
            this.token_error(symbol, "Unexpected %T %%");
          } else {
            bracket_stack.pop();
          }
        } else if (symbol.value === "+" || symbol.value === "?" || symbol.value === "*") {
          let prev_symbol = definition.symbols[i-1];
          if (prev_symbol.type === TokenType.OPERATOR && prev_symbol.value !== ")") {
            this.token_error(symbol, "Kleene %T %% must be preceded by a bracketed expression, SET or TERMINAL symbol");
          }
        } else if (symbol.value === "|") {
          let prev_symbol = definition.symbols[i-1];
          if (prev_symbol.type === TokenType.OPERATOR &&
              prev_symbol.value !== ")" &&
              prev_symbol.value !== "*" &&
              prev_symbol.value !== "?" &&
              prev_symbol.value !== "+") {
            this.token_error(symbol, "Invalid regular expression symbol %T %%");
          }
        } else {
          this.token_error(symbol, "Invalid regular expression symbol %T %%");
        }
      } else if (symbol.type !== TokenType.SET &&
                 symbol.type !== TokenType.TERMINAL &&
                 symbol.type !== TokenType.CONST_SET &&
                 symbol.type !== TokenType.CONST_TERMINAL) {
        this.token_error(symbol, "Invalid regular expression symbol %T %%");
      }
    }
    for (let not_closed of bracket_stack) {
      this.token_error(not_closed, "Not closed %T %%");
    }
  }

  private validate_non_terminal_definition(definition: GRMDefinition) {
    if (definition.symbols.length < 3) {
      this.incomplete_definition_error(definition, "::= BCNF");
      return;
    }
    if (definition.symbols[1].value !== "::=") {
      this.token_error(definition.symbols[1], "Expected OPERATOR ::=, but found %T %%");
    }
    for (let i=2; i<definition.symbols.length; ++i) {
      let symbol = definition.symbols[i];
      if (symbol.type !== TokenType.CONST_TERMINAL &&
          symbol.type !== TokenType.TERMINAL &&
          symbol.type !== TokenType.NON_TERMINAL &&
          symbol.value !== "|") {
        this.token_error(symbol, "Invalid %T %% in BCNF rule");
      }
    }
  }

  private check_range_set(token: GRMToken): boolean {
    if (token.type !== TokenType.SET) {
      return false;
    }
    let name = token.value.substring(1, token.value.length-1);
    let match = name.match(set_range_expr);
    if (match === null || match[0].length !== name.length) {
      return false;
    }
    let start_str = match[1];
    let start = start_str.startsWith("#")
              ? +start_str.substring(1)
              : Number("0x" + start_str.substring(1));
    let stop = start;
    if (match[2] !== undefined) {
      let stop_str = match[3];
      stop = stop_str.startsWith("#")
                ? +stop_str.substring(1)
                : Number("0x" + stop_str.substring(1));
      if (start > stop) {
        this.token_error(token, "The start of a range must be smaller than then end");
      }
    }
    if (start > 65519 || stop > 65519) {
      this.token_error(token, "Range values out of the allowed character range for UTF-16");
    }
    return true;
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
      let defined_symbol = definition.symbols[0];
      let definition_map = this.symbols.defined_symbols.get(definition.type)!;
      if (defined_symbol.value !== "Comment") {
        if (definition_map.has(token_name(defined_symbol))) {
          this.token_error(defined_symbol, "Redefinition of %T '%N'");
        } else {
          definition_map.set(token_name(defined_symbol), defined_symbol);
        }
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

      if (definition.type === DefinitionType.PARAMETER &&
          defined_symbol.value !== "Start Symbol") {
        // skip unused analysis for not used tokens in parameters
        continue;
      }

      let start_index = defined_symbol.value === "Comment"
                      ? 2 : 1;
      // parse other symbols:
      for (let i=start_index; i<definition.symbols.length; ++i) {
        let symbol = definition.symbols[i];
        if (this.check_range_set(symbol)) {
          // Treat range sets as constants and ignore them here
          continue;
        }
        // undefiled chain through ? skips if not found
        this.symbols.used_symbols.get(symbol.type)?.push(symbol);
      }
    }

    // Collect undefined token errors:
    for (let token of this.undefined_tokens(TokenType.PARAMETER)) {
      if (token.value === '"Start Symbol"') {
        this.token_error(token, "Missing required parameter %N");
      } else {
        this.token_error(token, "Missing default parameter %N",
                         DiagnosticSeverity.Warning);
      }
    }
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

    this.check_errors();
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

  private missing_parameter(): Array<GRMToken> {
    let parameters = this.symbols.defined_symbols.get(DefinitionType.PARAMETER);
    let missing = required_parameter.filter((param) => !parameters!.has(param));
    let result = [];

    for (let param of missing) {
      result.push({
            type: TokenType.PARAMETER,
            value: '"' + param + '"',
            location: new Position(0, 0)
      });
    }

    return result;
  }

  public undefined_tokens(type: TokenType, unique: boolean = true): Array<GRMToken> {
    if (type === TokenType.PARAMETER) {
      return this.missing_parameter();
    }
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
    let result = tokens.filter((token) => !defined!.has(token_name(token)));

    return result;
  }

  public definition_at(position: Position): GRMDefinition|undefined {
    // A defenition can only start with a new line
    // therefore no char position check required
    for (let definition of this.definitions) {
      if (position.line >= definition.range.start.line &&
          position.line <= definition.range.end.line) {
        return definition;
      }
    }

    return undefined;
  }
}
