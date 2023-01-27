/* eslint-disable @typescript-eslint/naming-convention */
import { Position, TextDocument, window, workspace } from "vscode";
import { GrammarParseResult, load_grammar_tables, LRState, parse_string, Token, LRStackItem, GroupError, LexerError, ParserError, is_group_error, is_parser_error, is_lexer_error, LRActionType, ParserSymbol, ParsingResult, LRParseTreeNode, SymbolType, ParserRule } from '@warfley/node-gold-engine';
import * as path from "path";
import { DefinitionType, DocumentParser, GRMRule, GRMToken, parse_rules, TokenType, token_name } from "./grm_parser";
import { once, EventEmitter } from "node:events";
import { Source, StackFrame, Variable } from "@vscode/debugadapter";
import { prepare_grammar } from "./grm_debug_config";

interface StepInfo {
  step_kind: "step"|"step_out"|"step_in";
}

interface StepOut extends StepInfo{
  step_kind: "step_out";
  last_stack: number;
}

interface StepIn extends StepInfo {
  step_kind: "step_in";
  last_action: "parser"|"lexer";
  last_token: Token;
}

interface Step extends StepInfo {
  step_kind: "step";
  last_action: "parser"|"lexer"|"started";
}

type StepKind = StepOut|StepIn|Step;

function is_step_out(step: StepInfo): step is StepOut {
  return step.step_kind === "step_out";
}

function is_step_in(step: StepInfo): step is StepIn {
  return step.step_kind === "step_in";
}

function is_step(step: StepInfo): step is Step {
  return step.step_kind === "step";
}

function symbol_name(symbol: ParserSymbol): string {
  let result = symbol.name.toLowerCase();
  result = result.substring(1, result.length - 1);
  return result.trim();
}

interface LastParserState {
  stack: ReadonlyArray<LRStackItem>;
  look_ahead: Token;
  action: LRActionType.REDUCE|LRActionType.SHIFT;
}

export interface DebuggerError {
  code: number;
  message: string;
}

function debugger_error(code: number, message: string): DebuggerError {
  return {
    code: code,
    message: message
  };
}

export interface BreakReason {
  reason: "breakpoint"|"step"|"entry"|"pause"|"error";
  triggered_action: "finish"|"lexer"|"parser";
  error?: {
    error_data: LexerError|ParserError|GroupError,
    error_message: string,
  },
  step_info?: StepKind
  breakpoint?: GRMBreakPoint
};

export interface GRMDebugOptions {
  start_paused: boolean;
  output_reductions: boolean;
  output_shifts: boolean;
  output_tokens: boolean;
}

interface GRMBreakPoint {
  id: number,
  type: "LEXER"|"RULE";
  name: string,
  line: number,
  column: number;
}

interface IndexedTree extends LRParseTreeNode {
  id: number;
}

function token_to_symbol_type(token: GRMToken): SymbolType {
  switch (token.type) {
  case TokenType.CONST_TERMINAL:
  case TokenType.TERMINAL:
    return SymbolType.TERMINAL;
  case TokenType.NON_TERMINAL:
    return SymbolType.NON_TERMINAL;
  }
  return SymbolType.ERROR;
}

function token_symbol_compare(token: GRMToken, symbol: ParserSymbol): boolean {
  return token_to_symbol_type(token) === symbol.type &&
         token_name(token) === symbol_name(symbol);
}

function compare_rules(grm_rule: GRMRule, cgt_rule: ParserRule): boolean {
  if (!token_symbol_compare(grm_rule.produces, cgt_rule.produces) ||
      grm_rule.consumes.length !== cgt_rule.consumes.length) {
    return false;
  }
  for (let i=0; i<cgt_rule.consumes.length; ++i) {
    if (!token_symbol_compare(grm_rule.consumes[i], cgt_rule.consumes[i])) {
      return false;
    }
  }
  return true;
}

function find_grm_rule(parser: DocumentParser|undefined, rule: ParserRule): GRMRule|undefined {
  let definition = parser?.symbols.defined_symbols.get(DefinitionType.NON_TERMINAL)
                  ?.get(symbol_name(rule.produces));
  if (definition === undefined) {
    return undefined;
  }
  let rules = parse_rules(definition);
  for (const grm_rule of rules) {
    if (compare_rules(grm_rule, rule)) {
      return grm_rule;
    }
  }
  return undefined;
}

function build_rule(tree: LRParseTreeNode): string {
  let rule = tree.symbol.name;
  if (tree.children instanceof Array) {
    rule += " ::= ";
    for (const c of tree.children) {
      rule += c.symbol.name + " ";
    }
  } else {
    rule += " = '" + tree.children.value + "'";
  }
  return rule;
}

function rule_string(rule: ParserRule): string {
  let result = rule.produces.name + " ::= ";
  for (const c of rule.consumes) {
    result += c.name + " ";
  }
  return result;
}

interface OpenRule extends ParserRule {
  partial_consumes: Array<LRParseTreeNode>;
  stack_start: number;
}

function open_rule_from_rule(rule: ParserRule, stack_start: number): OpenRule {
  return {
    index: rule.index,
    consumes: rule.consumes,
    produces: rule.produces,
    partial_consumes: [],
    stack_start: stack_start
  };
}

function potential_rules(stack: ReadonlyArray<LRParseTreeNode>,
                         rules: ReadonlyArray<ParserRule>,
                         stack_index: number): Array<OpenRule> {
  let result: Array<OpenRule> = [];
  for (const rule of rules) {
    // No empty rules and at least one symbol must match
    if (rule.consumes.length === 0 ||
        rule.consumes[0].type !== stack[stack_index].symbol.type ||
        rule.consumes[0].name !== stack[stack_index].symbol.name) {
      continue;
    }
    // Count overlap
    let open_rule: OpenRule = open_rule_from_rule(rule, stack_index);
    for (let i=0; i<Math.min(stack.length - stack_index, rule.consumes.length); ++i) {
      let stack_item = stack[stack_index + i];
      if (rule.consumes[i].name === stack_item.symbol.name) {
        open_rule.partial_consumes.push(stack_item);
      } else {
        break;
      }
    }
    result.push(open_rule);
  }
  return result;
}

function open_rules(rules: ReadonlyArray<ParserRule>,
                    stack: ReadonlyArray<LRParseTreeNode>,
                   ): Array<Array<OpenRule>> {
  let result: Array<Array<OpenRule>> = [];
  let stack_index = 0;
  while (stack_index<stack.length) {
    let options = potential_rules(stack, rules, stack_index);
    // Will be at least 1 even if no option is available
    let max = Math.max(1,...options.map((r) => r.partial_consumes.length));
    let max_options = options.filter((o) => o.partial_consumes.length === max);
    for (let i=0; i<max; ++i) {
      result.push(max_options);
    }
    stack_index += max;
  }
  return result;
 }

function file_source(file: string): Source {
  return new Source(path.basename(file), file);
}

export type SendOutputHandler = (output: string) => void;
export type BreakHandler = (reason: BreakReason) => void;
export type FinishHandler = (result: ParsingResult) => void;

export class GRMDebugger {
  private grammar_tables: GrammarParseResult;
  private grm_definition?: TextDocument;
  private parser?: DocumentParser;
  private document: TextDocument;
  private options: GRMDebugOptions;

  private terminated: boolean = false;
  private grammar_break_points: Array<GRMBreakPoint> = [];
  private step_break?: StepKind;
  private selected_frame: number = 0;

  private pause_reason?: BreakReason;

  private events = new EventEmitter();
  // Current state
  private parser_stack: Array<LRParseTreeNode> = [];
  private open_rules: Array<Array<OpenRule>> = [];
  private tokens: Array<Token> = [];

  private write_info: SendOutputHandler;
  private write_error: SendOutputHandler;
  private break_execution: BreakHandler;
  private finish: FinishHandler;

  private constructor(document: TextDocument, grammar_tables: GrammarParseResult,
                      grm_definition: TextDocument|undefined, config: GRMDebugOptions,
                      write_info: SendOutputHandler, write_error: SendOutputHandler,
                      break_execution: BreakHandler, finish: FinishHandler) {
    // Initialization
    this.grammar_tables = grammar_tables;
    this.document = document;
    this.grm_definition = grm_definition;
    if (grm_definition !== undefined) {
      this.parser = DocumentParser.get_or_create(grm_definition);
      this.parser.parse();
    }
    this.options = config;

    if (this.options.start_paused) {
      this.step_break = {
        step_kind: "step",
        last_action: "started"
      };
    }

    // Events
    this.break_execution = break_execution;
    this.write_info = write_info;
    this.write_error = write_error;
    this.finish = finish;
  }

  public static async create(document_file: string, grammar_file: string,
                             config: GRMDebugOptions, write_info: SendOutputHandler,
                             write_error: SendOutputHandler,
                             break_execution: BreakHandler, finish: FinishHandler
                            ): Promise<GRMDebugger | DebuggerError> {
    let document = await workspace.openTextDocument(document_file);
    if (document === undefined) {
      return debugger_error(100, "File not found");
    }

    let cgt = await prepare_grammar(grammar_file);
    if (cgt === undefined) {
      return debugger_error(200, "Compile error");
    }
    let grammar_tables = load_grammar_tables(cgt);
    let grm_defintion = await this.grammar_definition(grammar_file);
    return new GRMDebugger(document, grammar_tables, grm_defintion, config,
                           write_info, write_error, break_execution, finish);
  }

  public launch(): void {
    parse_string(this.document.getText(),
                 this.grammar_tables.dfa, this.grammar_tables.lalr,
                 (...args) => this.token_lexed(...args),
                 (...args) => this.parser_reduction(...args),
                 (...args) => this.parser_shifted(...args)
                ).then((result) => this.parser_finished(result)
                 .then(() => this.finish(result)));
  }

  private static async grammar_definition(selected_grammar: string): Promise<TextDocument | undefined> {
    let grammar_document: TextDocument|undefined = undefined;
    // Already GRM file selected, just get TextDocument
    if (selected_grammar.endsWith(".grm")) {
      return await workspace.openTextDocument(selected_grammar);
    }
    // CGT or EGT: Search corresponding GRM
    let file_name = path.basename(selected_grammar);
    file_name = file_name.substring(0, file_name.length - 4) + ".grm";
    let grammars = await workspace.findFiles("**/" + file_name);
    if (grammars.length === 0) {
      return undefined;
    }
    // Only one possibility, open this
    if (grammars.length === 1) {
      return await workspace.openTextDocument(grammars[0]);
    }

    // Multiple possibilities, let user decide
    let selection = await window.showQuickPick(grammars.map((grammar_path) => {
      return {
        label: path.basename(grammar_path.path),
        description: workspace.asRelativePath(grammar_path.path),
        uri: grammar_path
      };
    }), {canPickMany: false});
    if (selection !== undefined) {
      return await workspace.openTextDocument(selection.uri);
    }

    // No selection
    return undefined;
  }

  private pause_execution(reason: BreakReason): Promise<void> {
    this.pause_reason = reason;
    this.break_execution(reason);
    return once(this.events, "continue").then();
  }

  private async parser_finished(result: ParsingResult): Promise<void> {
    if (this.terminated) {
      return;
    }
    if (is_group_error(result)) {
      let top_group = result.groups[result.groups.length - 1];
      let pos = this.document!.positionAt(top_group.start_position).translate(1, 1);
      let error_message = "Unfinished group " + top_group.group.name + " at " + pos.line + ": " + pos.character;
      await this.pause_execution({
        reason: "error",
        error: {
          error_data: result,
          error_message: error_message
        },
        triggered_action: "finish"
      });
    } else  if (is_parser_error(result)) {
      let tok = result.last_token === "(EOF)"
              ? "EOF"
              : result.last_token.symbol.name + ": " + result.last_token.value;
      let pos = result.last_token === "(EOF)"
              ? this.document!.lineAt(this.document!.lineCount - 1).range.end
              : this.document!.positionAt(result.last_token.position);
      pos = pos.translate(1, 1);
      let error_message = "Parser error for " + tok + " at " + pos.line + ": " + pos.character;
      await this.pause_execution({
        reason: "error",
        error: {
          error_data: result,
          error_message: error_message
        },
        triggered_action: "finish"
      });
    } else if (is_lexer_error(result)) {
      let symbol = this.document.getText()!.substring(result.position, result.position + 3).trim() + "...";
      let pos = this.document!.positionAt(result.position).translate(1, 1);
      let error_message = "Unlexable symbol at " + pos.line + ": " + pos.character + " (" + symbol + ")";
      await this.pause_execution({
        reason: "error",
        error: {
          error_data: result,
          error_message: error_message
        },
        triggered_action: "finish"
      });
    } else {
      let success_message = "Parsing Successful";
      this.write_info(success_message);
    }
  }

  private check_step(previous_action: "parser"|"lexer", step_break: Step): BreakReason|undefined {
    if (step_break.last_action === "started") {
      return {
        reason: "entry",
        triggered_action: previous_action
      };
    }
    if (step_break.last_action === previous_action) {
      return {
        reason: "step",
        triggered_action: previous_action,
        step_info: this.step_break
      };
    }
    return undefined;
  }

  private check_step_out(previous_action: "parser"|"lexer", step_break: StepOut): BreakReason|undefined {
    if (previous_action === "lexer" ||
        this.parser_stack.length > step_break.last_stack) {
      // Step out can only effect parser
      return undefined;
    }
    return {
      reason: "step",
      triggered_action: previous_action,
      step_info: step_break
    };
  }

  private check_step_in(previous_action: "parser"|"lexer", step_break: StepIn): BreakReason|undefined {
    return {
      reason: "step",
      triggered_action: previous_action,
      step_info: step_break
    };
  }

  private step_break_required(previous_action: "lexer"|"parser"): BreakReason|undefined {
    if (this.step_break === undefined) {
      return undefined;
    }

    let result: BreakReason|undefined = undefined;

    if (is_step(this.step_break)) {
      result = this.check_step(previous_action, this.step_break);
    } else if (is_step_in(this.step_break)) {
      result = this.check_step_in(previous_action, this.step_break);
    } else if (is_step_out(this.step_break)) {
      result = this.check_step_out(previous_action, this.step_break);
    }

    return result;
  }

  private async token_lexed(token: Token, ...args: any[]): Promise<void> {
    if (this.terminated) {
      return;
    }
    // update state
    this.tokens.push(token);

    // Check for any lexer breakpoints
    let breakpoint = this.grammar_break_points
                    .find((bp) => bp.type === "LEXER" &&
                                  bp.name === symbol_name(token.symbol));
    if (breakpoint !== undefined) {
      await this.pause_execution({
        reason: "breakpoint",
        triggered_action: "lexer",
        breakpoint: breakpoint
      });
      if (this.terminated) {
        return;
      }
    }

    let break_on_step = this.step_break_required("lexer");
    if (break_on_step !== undefined) {
      await this.pause_execution(break_on_step);
      if (this.terminated) {
        return;
      }
    }

    // Debug output
    if (this.options.output_tokens) {
      let pos = this.document!.positionAt(token.position);
      let status_message = "Lexed token: " + token.symbol.name + ": " + token.value + " at: " + pos.line + ": " + pos.character;
      this.write_info(status_message);
    }
  }

  private update_parser_stack(stack: ReadonlyArray<LRStackItem>): void {
    this.parser_stack = [];
    for (let i=1; i<stack.length; ++i) {
      this.parser_stack.push(stack[i].parse_tree);
    }
    this.open_rules = open_rules(this.grammar_tables.rules, this.parser_stack);
  }

  private find_rule(production: ParserSymbol, consumes: Array<ParserSymbol>): GRMRule|undefined {
    if (this.parser === undefined) {
      return undefined;
    }
    let definition = this.parser!.symbols.defined_symbols.get(DefinitionType.NON_TERMINAL)?.get(symbol_name(production));
    if (definition === undefined) {
      return undefined;
    }
    let rules = parse_rules(definition);
    for (const rule of rules) {
      if (rule.consumes.length === consumes.length) {
        // Check all parameters
        let found = true;
        for (let i=0; i<rule.consumes.length; ++i) {
          let rc = rule.consumes[i];
          let c = consumes[i];
          if (!token_symbol_compare(rc, c)) {
            found = false;
            break;
          }
        }
        if (found) {
          return rule;
        }
      }
    }
    return undefined;
  }

  private async parser_reduction(orig_state: LRState,
                                 look_ahead: Token,
                                 stack: ReadonlyArray<LRStackItem>,
                                 ...args: any[]): Promise<void> {
    if (this.terminated) {
      return;
    }
    this.update_parser_stack(stack);

    let reduction = this.parser_stack[this.parser_stack.length - 1];
    let consumes = reduction.children as Array<LRParseTreeNode>;
    let rule = this.find_rule(reduction.symbol, consumes.map((c) => c.symbol));

    // Check for rule based breakpoints
    let breakpoint = this.grammar_break_points
                    .find((bp) => bp.type === "RULE" &&
                                  bp.name === rule?.name);
    if (breakpoint !== undefined) {
      await this.pause_execution({
        reason: "breakpoint",
        triggered_action: "parser",
        breakpoint: breakpoint
      });
      if (this.terminated) {
        return;
      }
    }

    let break_on_step = this.step_break_required("parser");
    if (break_on_step !== undefined) {
      await this.pause_execution(break_on_step);
      if (this.terminated) {
        return;
      }
    }

    if (this.options.output_reductions) {
      let rule = build_rule(reduction);
      let status_message = "Reductuion: " + rule;
      this.write_info(status_message);
    }
  }

  private async parser_shifted(orig_state: LRState,
                               look_ahead: Token,
                               stack: ReadonlyArray<LRStackItem>,
                               ...args: any[]): Promise<void> {
    if (this.terminated) {
      return;
    }

    this.update_parser_stack(stack);

    let open_rules = this.open_rules[this.open_rules.length - 1];
    let breakpoint: GRMBreakPoint|undefined = undefined;
    if (open_rules.length === 1) {
      // Check for rule based breakpoints
      for (const rule of open_rules) {
        let grm_rule = find_grm_rule(this.parser, rule);
        if (grm_rule !== undefined) {
          breakpoint = this.grammar_break_points.find((bp) => bp.type === "RULE" &&
                                                              bp.name === grm_rule?.name);
          if (breakpoint !== undefined) {
            break;
          }
        }
      }
    }

    if (breakpoint !== undefined) {
      await this.pause_execution({
        reason: "breakpoint",
        triggered_action: "parser",
        breakpoint: breakpoint
      });
      if (this.terminated) {
        return;
      }
    }

    let break_on_step = this.step_break_required("parser");
    if (break_on_step !== undefined) {
      await this.pause_execution(break_on_step);
      if (this.terminated) {
        return;
      }
    }

    if (this.options.output_shifts) {
      let status_message = "Shifted: " + look_ahead.symbol.name;
      this.write_info(status_message);
    }
  }

  public update_breakpoints(file: string, lines: Array<number>) : Array<GRMBreakPoint> {
    if (file !== this.grm_definition?.fileName) {
      return [];
    }
    this.grammar_break_points = [];

    for (const line of lines) {
      let definition = this.parser!.definition_at(new Position(line, 0));
      if (definition === undefined) {
        continue;
      }
      if (definition.type === DefinitionType.TERMINAL) {
        this.grammar_break_points.push({
          type: "LEXER",
          id: this.grammar_break_points.length,
          name: token_name(definition.symbols[0]),
          line: definition.range.start.line,
          column: definition.range.start.character
        });
      }
      if (definition.type === DefinitionType.NON_TERMINAL) {
        let rules = parse_rules(definition);
        for (const rule of rules) {
          if (rule.position.line === line) {
            this.grammar_break_points.push({
              type: "RULE",
              id: this.grammar_break_points.length,
              name: rule.name,
              line: rule.position.line,
              column: rule.position.character
            });
          }
        }
      }
    }

    return this.grammar_break_points;
  }

  private lexer_stack_frames(): Array<StackFrame> {
    let result: Array<StackFrame> = [];
    for (let i=this.tokens.length-1; i>=0; --i) {
      let token = this.tokens[i];
      let pos = this.document.positionAt(token.position);
      result.push({
        id: i,
        name: symbol_name(token.symbol),
        source: file_source(this.document.fileName),
        line: pos.line + 1,
        column: pos.character + 1
      });
    }
    return result;
  }

  public parser_stack_frames(): Array<StackFrame> {
    let result: Array<StackFrame> = [];

    for (let i=this.parser_stack.length-1; i>=0; --i) {
      let parse_tree = this.parser_stack[i];
      if (parse_tree.children instanceof Array) {
        let rule = this.find_rule(parse_tree.symbol, parse_tree.children.map((t) => t.symbol));
        let pos = rule?.position.translate(1, 1);
        let source = this.grm_definition && file_source(this.grm_definition.fileName);
        result.push({
          name: parse_tree.symbol.name,
          id: i,
          source: source,
          line: pos?.line || 0,
          column: pos?.character || 0
        });
      } else { // SHift stack frame
        let pos: Position|undefined = undefined;
        let source: Source|undefined = undefined;
        if (this.open_rules[i].length > 0) {
          let open_rule = this.open_rules[i][0];
          let grm_rule = find_grm_rule(this.parser, open_rule);
          if (grm_rule !== undefined) {
            let nt_token = grm_rule.consumes[open_rule.partial_consumes.length - 1];
            pos = nt_token.location.translate(1, 1);
            source = file_source(this.grm_definition!.fileName);
          }
        }
        if (pos === undefined || source === undefined) {
          pos = this.document.positionAt(parse_tree.children.position).translate(1, 1);
          source = file_source(this.document.fileName);
        }
        result.push({
          name: parse_tree.symbol.name,
          id: i,
          source: source,
          line: pos.line,
          column: pos.character
        });
      }
    }
    return result;
  }

  public error_stack_frames(): Array<StackFrame> {
    let result: Array<StackFrame> = [];
    let error = this.pause_reason?.error?.error_data;
    if (error === undefined) {
      return [];
    }

    if (is_group_error(error)) {
      let end_pos = this.document.lineAt(this.document.lineCount - 1).range.end.translate(1, 1);
      for (let i=error.groups.length-1; i>=0; --i) {
        let open_group = error.groups[i];
        let group_pos = this.document.positionAt(open_group.start_position).translate(1, 1);
        result.push({
          name: "Unfinished Group: " + open_group.group.name,
          id: i,
          line: group_pos.line,
          column: group_pos.character,
          endLine: end_pos.line,
          endColumn: end_pos.character,
          source: file_source(this.document.fileName)
        });
      }
    } else if (is_parser_error(error)) {
      let open_rules = this.open_rules[this.open_rules.length-1];
      if (open_rules.length > 0) {
        let open_rule = open_rules[0];
        let first_sym = open_rule.partial_consumes[0];
        let last_sym = open_rule.partial_consumes[open_rule.partial_consumes.length - 1];
        let rule_pos = this.document
                      .positionAt(first_sym.start)
                      .translate(1, 1);
        let rule_end = this.document
                      .positionAt(last_sym.end)
                      .translate(1, 1);
        result.push({
          name: "Unfinished " + open_rule.produces.name,
          id: -1,
          line: rule_pos.line,
          column: rule_pos.character,
          endLine: rule_end.line,
          endColumn: rule_end.character,
          source: file_source(this.document.fileName)
        });
      }
      result = result.concat(this.parser_stack_frames());
    } else if (is_lexer_error(error)) {
      let location = this.document.positionAt(error.position).translate(1, 1);
      result.push({
        name: "Unreckognized Token: " + this.document.getText().substring(error.position, error.position + 3).trim() + "...",
        id: - 1,
        line: location.line,
        column: location.character,
        source: file_source(this.document.fileName)
      });
      result = result.concat(this.lexer_stack_frames());
    }

    return result;
  }

  public get_frames(): Array<StackFrame> {
    switch (this.pause_reason?.triggered_action) {
    case "lexer":
      return this.lexer_stack_frames();
    case "parser":
      return this.parser_stack_frames();
    case "finish":
      return this.error_stack_frames();
    }
    return [];
  }

  private index_tree(tree: LRParseTreeNode, index: number): number {
    let id = index;
    (tree as IndexedTree).id = id++;
    if (tree.children instanceof Array) {
      for (const c of tree.children) {
        id = this.index_tree(c, id);
      }
    }
    return id;
  }

  public select_frame(index: number): string {
    this.selected_frame = index;
    switch (this.pause_reason!.triggered_action) {
    case "lexer":
      return "Token";
    case "parser":
      this.index_tree(this.parser_stack[index], 0);
      return this.parser_stack[index].children instanceof Array
           ? "Reduction"
           : "Shift";
    case "finish":
      if (is_lexer_error(this.pause_reason!.error!.error_data)) {
        return index < 0 ? "Lexer Error" : "Token";
      } else if (is_parser_error(this.pause_reason!.error!.error_data)) {
        if (index >= 0) {
          this.index_tree(this.parser_stack[index], 0);
        }
        return index < 0
            ? "Parser Error"
            : this.parser_stack[index].children instanceof Array
            ? "Reduction"
            : "Shift";
      } // Group_error
      return "Group";
    }
  }

  private token_variables(token: Token): Array<Variable> {
    let pos = this.document.positionAt(token.position);
    return [
      {
        name: "Symbol Type",
        value: SymbolType[token.symbol.type],
        variablesReference: 0
      },
      {
        name: "Symbol",
        value: token.symbol.name,
        variablesReference: 0
      },
      {
        name: "Value",
        value: "'" + token.value + "'",
        variablesReference: 0
      },
      {
        name: "Line",
        value: (pos.line + 1).toString(),
        variablesReference: 0
      },
      {
        name: "Column",
        value: (pos.character + 1).toString(),
        variablesReference: 0
      },
    ];
  }

  private node_by_index(node: LRParseTreeNode, index: number): LRParseTreeNode|undefined {
    if ((node as IndexedTree).id === index) {
      return node;
    }
    // Leaf
    if (!(node.children instanceof Array)) {
      return undefined;
    }
    // Logarithmic search:
    // left subtree always has index lower than right
    for (let i=node.children.length - 1; i>=0; --i) {
      const child = node.children[i] as IndexedTree;
      if (child.id <= index) {
        // Highest numbered child which is smaller than index
        // I.e. subtree that contains index if ther
        return this.node_by_index(child, index);
      }
    }
    return undefined;
  }

  private sub_tree_variables(reference: number, subtree: LRParseTreeNode) {
    let index = Math.floor(reference / 2);
    let subindex = (reference - 2) % 2;
    let tree_node = this.node_by_index(subtree, index);
    if (tree_node === undefined) {
      return [];
    }
    if (subindex === 0) {
      return [
        {
          name: "Rule",
          value: build_rule(tree_node),
          variablesReference: reference + 1
        },
        {
          name: "Operation",
          value: "Reduction",
          variablesReference: 0
        },
        {
          name: "Text",
          value: "'" + this.document.getText().substring(tree_node.start||0,
                                                   tree_node.end||0) + "'",
          variablesReference: 0
        },
        {
          name: "Children",
          value: tree_node.children instanceof Array
              ? "[...]"
              : "Token",
          variablesReference: reference + 1
        }
      ];
    }
    if (tree_node.children instanceof Array) {
      return tree_node.children.map((child) => {
        return {
          name: child.symbol.name,
          value: '{...}',
          variablesReference: (child as IndexedTree).id * 2 + 2
        };
      });
    }
    return [
      {
        name: "Symbol",
        value: tree_node.children.symbol.name,
        variablesReference: 0
      },
      {
        name: "Value",
        value: "'" + tree_node.children.value + "'",
        variablesReference: 0
      }
    ];
  }

  public get_reduction_variables(reference: number): Array<Variable> {
    let stack_frame = this.parser_stack[this.selected_frame];
    /** Reference mapping:
     * 1: Top level
     * index = Floor((reference - 2) / 2)
     * index + 0: Stack item info: Rule, operation, value, children
     * index + 1: Subtrees
     */
    if (reference === 1) {
      // Top level
      return [
        {
          name: "Operation",
          value: stack_frame.children instanceof Array
              ? "Reduction"
              : "Shift",
          variablesReference: 0
        },
        {
          name: "Look Ahead",
          value: "'" + this.tokens[this.token_lexed.length - 1].symbol.name + "'",
          variablesReference: 0
        },
        {
          name: "Parse Tree",
          value: stack_frame.symbol.name,
          variablesReference: 2
        },
      ];
    }
    return this.sub_tree_variables(reference - 2, stack_frame);
  }

  private get_shift_variables(reference: number): Array<Variable> {
    let tree_node = this.parser_stack[this.selected_frame];
    let open_rules = this.open_rules[this.selected_frame];
    /** Reference Mapping
     * 1: Top Level
     * 2: If multiple open rules, rules
     */
    if (reference === 1) {
      return [
        {
          name: "Token",
          value: build_rule(tree_node),
          variablesReference: 0
        },
        {
          name: "Operation",
          value: "Reduction",
          variablesReference: 0
        },
        {
          name: "Text",
          value: "'" + this.document.getText().substring(tree_node.start,
                                                         tree_node.end) + "'",
          variablesReference: 0
        },
        {
          name: "Open Rule",
          value: open_rules.length === 0
               ? "Unknown"
               : open_rules.length === 1
               ? rule_string(open_rules[0])
               : "[...]",
          variablesReference: open_rules.length > 1
                            ? 2
                            : 0
        }
      ];
    }
    if (reference === 2) {
      let index = 0;
      return open_rules.map((rule) => {
        return {
          name: (index++).toString(),
          value: rule_string(rule),
          variablesReference: 0
        };
      });
    }
    return [];
  }

  private parser_error_tree(): LRParseTreeNode|undefined {
    let open_rules = this.open_rules[this.open_rules.length - 1];
    if (open_rules.length === 0) {
      return undefined;
    }
    let result = {
      symbol: open_rules[0].produces,
      children: open_rules[0].partial_consumes,
      start: open_rules[0].partial_consumes[0].start,
      end: open_rules[0].partial_consumes[open_rules[0].partial_consumes.length - 1].end
    };
    this.index_tree(result, 0);
    return result;
  }

  private get_error_variables(reference: number): Array<Variable> {
    let error = this.pause_reason!.error!.error_data;
    if (is_lexer_error(error)) {
      let error_pos = this.document.positionAt(error.position);
      return [{
        name: "Unreckognized",
        value: "'" + this.document.getText().substring(error.position, error.position + 3).trim() + "...'",
        variablesReference: 0
      },
      {
        name: "Line",
        value: "" + (error_pos.line + 1),
        variablesReference: 0
      },
      {
        name: "Column",
        value: "" + (error_pos.character + 1),
        variablesReference: 0
      }];
    }
    // Group error handled seperately
    error = error as ParserError;
    let open_rule = this.open_rules[this.open_rules.length - 1][0];
    let parse_tree = this.parser_error_tree()!;
    /** Reference mapping:
     * 1: Top level
     * 2: parial consumes
     * index = Floor((reference - 3) / 2)
     * index + 0: Stack item info: Rule, operation, value, children
     * index + 1: Subtrees
     */
    if (reference === 1) {
      return [
        {
          name: "Current Rule",
          value: rule_string(open_rule),
          variablesReference: reference + 1
        },
        {
          name: "Look Ahead",
          value: "'" + this.tokens[this.token_lexed.length - 1].symbol.name + "'",
          variablesReference: reference + 1
        },
        {
          name: "Text",
          value: "'" + this.document.getText().substring(parse_tree.start,
                                                         parse_tree.end) + "'",
          variablesReference: 0
        },
      ];
    }
    return this.sub_tree_variables(reference - 1, parse_tree);
  }

  private get_group_variables(reference: number): Array<Variable> {
    let error = this.pause_reason!.error!.error_data as GroupError;
    let error_group = error.groups[this.selected_frame];
    let start_position = this.document.positionAt(error_group.start_position);
    return [{
      name: "Group",
      value: "'" + error_group.group.name  + "'",
      variablesReference: 0
    },
    {
      name: "Started by",
      value: "'" + symbol_name(error_group.group.start_symbol) + "'",
      variablesReference: 0
    },
    {
      name: "Expected",
      value: "'" + symbol_name(error_group.group.end_symbol) + "'",
      variablesReference: 0
    },
    {
      name: "Advance Mode",
      value: error_group.group.advance_mode,
      variablesReference: 0
    }];
  }

  public get_variables(reference: number): Array<Variable> {
    switch (this.pause_reason!.triggered_action) {
    case "lexer":
      return this.token_variables(this.tokens[this.selected_frame]);
    case "parser":
      return this.parser_stack[this.selected_frame].children instanceof Array
           ? this.get_reduction_variables(reference)
           : this.get_shift_variables(reference);
    case "finish":
      if (this.selected_frame < 0) {
        return this.get_error_variables(reference);
      }
      if (is_parser_error(this.pause_reason!.error!.error_data)) {
        return this.parser_stack[this.selected_frame].children instanceof Array
            ? this.get_reduction_variables(reference)
            : this.get_shift_variables(reference);
      }
      if (is_lexer_error(this.pause_reason!.error!.error_data)) {
        return this.token_variables(this.tokens[this.selected_frame]);
      }
      return this.get_group_variables(reference);
    }
  }

  public error_id(): string {
    if (is_group_error(this.pause_reason!.error!.error_data)) {
      return "Group Error";
    }
    if (is_lexer_error(this.pause_reason!.error!.error_data)) {
      return "Lexer Error";
    }
    return "Parser Error";
  }

  public error_message(): string {
    return this.pause_reason!.error!.error_message;
  }

  public terminate(): void {
    this.terminated = true;
    this.resume();
  }

  public resume(): void {
    this.step_break = undefined;
    this.events.emit("continue");
  }

  public step(): void {
    if (this.pause_reason!.triggered_action !== "finish") {
      this.step_break = {
        step_kind: "step",
        last_action: this.pause_reason!.triggered_action!
      };
    }
    this.events.emit("continue");
  }

  public step_in(): void {
    if (this.pause_reason!.triggered_action === "lexer") {
      // already on the lowest level, same as step
      return this.step();
    }
    this.step_break = {
      step_kind: "step_in",
      last_action: "parser",
      last_token: this.tokens[this.tokens.length - 1]
    };
    this.events.emit("continue");
  }

  public step_out(): void {
    this.step_break = {
      step_kind: "step_out",
      last_stack: this.pause_reason!.triggered_action === "lexer"
                ? this.parser_stack.length + 1
                : this.parser_stack.length
    };
    this.events.emit("continue");
  }
}
