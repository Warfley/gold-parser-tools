/* eslint-disable @typescript-eslint/naming-convention */
import { DebugSession } from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import { commands, TextDocument, window, workspace } from "vscode";
import { on_compile_command } from "./grm_tools";
import { GrammarParseResult, GTFileReader, load_grammar_tables, LRState, parse_string, Token, LRStackItem, GroupError, LRParseTreeNode, LexerError, ParserError, is_group_error, is_parser_error, is_lexer_error, parse_successful } from '@warfley/node-gold-engine';
import * as fs from "fs";
import * as path from "path";
import { ExitedEvent, InitializedEvent, OutputEvent, TerminatedEvent } from "@vscode/debugadapter/lib/debugSession";
import { DocumentParser } from "./grm_parser";
import { once, EventEmitter } from "node:events";
import { select_grammar } from "./grm_debug_config";

interface LaunchArgs extends DebugProtocol.LaunchRequestArguments {
  /** File to be parsed */
  program: string;
  /** Grammar to be used */
  grammar?: string;
}

export class GRMDebugSession extends DebugSession {
  private grammar?: TextDocument = undefined;
  private parser?: DocumentParser = undefined;
  private document?: TextDocument = undefined;
  private document_text?: string = undefined;
  private grammar_tables?: GrammarParseResult = undefined;

  private parse_result?: LRParseTreeNode|LexerError|GroupError|ParserError = undefined;

  private events: EventEmitter = new EventEmitter();


  private async prepare_grammar(grammar: string): Promise<GrammarParseResult|undefined> {
    if (grammar.endsWith(".grm")) {
      let doc = await workspace.openTextDocument(grammar);
      let compiled = await on_compile_command(doc.uri);
      if (compiled === false) {
        return undefined;
      }
      grammar = compiled;
    }
    if (!grammar.endsWith(".cgt") && !grammar.endsWith(".egt")) {
      window.showErrorMessage("Requires Gold Grammar Tables (.cgt|.egt) for parsing");
      return undefined;
    }

    if (!(await fs.promises.stat(grammar)).isFile()) {
      window.showErrorMessage("GOLD Parser Tools extension currently only works for local workspaces, this seems to be a remote workspace");
      return undefined;
    }

    let reader = await GTFileReader.from_file(grammar);
    try {
      return load_grammar_tables(reader);
    } catch (error: unknown) {
      window.showErrorMessage((error as Error).message);
      return undefined;
    }
  }

  protected async initializeRequest(response: DebugProtocol.InitializeResponse,
                                    args: DebugProtocol.InitializeRequestArguments
                                   ): Promise<void> {
    response.body = response.body || {};
    /** The debug adapter supports the `configurationDone` request. */
    response.body.supportsConfigurationDoneRequest = true;
    /** The debug adapter supports function breakpoints. */
    response.body.supportsFunctionBreakpoints = false;
    /** The debug adapter supports a (side effect free) `evaluate` request for data hovers. */
    response.body.supportsEvaluateForHovers = false;
    /** The debug adapter supports `exceptionOptions` on the `setExceptionBreakpoints` request. */
    response.body.supportsExceptionOptions = false;
    /** The debug adapter supports a `format` attribute on the `stackTrace`, `variables`, and `evaluate` requests. */
    response.body.supportsValueFormattingOptions = false;
    /** The debug adapter supports the `exceptionInfo` request. */
    response.body.supportsExceptionInfoRequest = false;
    /** The debug adapter supports the `terminate` request. */
    response.body.supportsTerminateRequest = false;
    /** The debug adapter supports the `readMemory` request. */
    response.body.supportsReadMemoryRequest = false;
    /** The debug adapter supports the `cancel` request. */
    response.body.supportsCancelRequest = false;
    /** The debug adapter supports the `breakpointLocations` request. */
    response.body.supportsBreakpointLocationsRequest = false;
    /** The debug adapter supports stepping granularities (argument `granularity`) for the stepping requests. */
    response.body.supportsSteppingGranularity = false;
    /** The debug adapter supports adding breakpoints based on instruction references. */
    response.body.supportsInstructionBreakpoints = false;

    this.sendResponse(response);
  }

  protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse,
                                     args: DebugProtocol.ConfigurationDoneArguments,
                                     request?: DebugProtocol.Request
                                    ): void {
    super.configurationDoneRequest(response, args, request);

    this.events.emit("configuration_done");
  }

  protected async launchRequest(response: DebugProtocol.LaunchResponse,
                                args: LaunchArgs,
                                request?: DebugProtocol.Request
                               ): Promise<void> {
    // Read grammar and compile if necessary
    let grammar_file = args.grammar;
    if (grammar_file === undefined) {
      let selected = await select_grammar();
      if (selected === undefined) {
        this.sendErrorResponse(response,
                              100,
                              "No grammar selected");
        return;
      }
      grammar_file = selected.fsPath;
    }

    let grammar_tables = await this.prepare_grammar(grammar_file);
    if (grammar_tables === undefined) {
      this.sendErrorResponse(response,
                             100,
                             "Compile error");
      return;
    }
    this.grammar_tables = grammar_tables;
    // For debugging find the corresponding grm
    let grammar_document: TextDocument|undefined = undefined;
    if (grammar_file.endsWith(".grm")) {
      grammar_document = await workspace.openTextDocument(grammar_file);
    } else if (grammar_file.endsWith(".egt") || grammar_file.endsWith(".cgt")) {
      let file_name = path.basename(grammar_file);
      file_name = file_name.substring(0, file_name.length - 4) + ".grm";
      let grammars = await workspace.findFiles("**/" + file_name);
      if (grammars.length > 0) {
        let selection = await window.showQuickPick(grammars.map((grammar_path) => {
          return {
            label: path.basename(grammar_path.path),
            description: workspace.asRelativePath(grammar_path.path),
            uri: grammar_path
          };
        }), {canPickMany: false});
        if (selection !== undefined) {
          grammar_document = await workspace.openTextDocument(selection.uri);
        }
      }
    }

    if (grammar_document !== undefined) {
      this.grammar = grammar_document;
      this.parser = DocumentParser.get_or_create(this.grammar);
      this.parser.parse();
    }

    // setup parser
    let document = await workspace.openTextDocument(args.program);
    if (document === undefined) {
      this.sendErrorResponse(response, 200, "Could not read document");
      return;
    }

    this.document = document;
    this.document_text = document.getText();

    // now we are finally initialzed and wait for all the breakpoints and co
    this.sendEvent(new InitializedEvent());
    await once(this.events, "configuration_done");

    // Start the parsing
    let _this = this;
    parse_string(this.document_text, grammar_tables.dfa, grammar_tables.lalr,
                 (...args) => _this.on_lex(...args),
                 (...args) => _this.on_reduce(...args),
                 (...args) => _this.on_shift(...args)
                ).then((result) => {
      this.parse_result = result;
      this.on_finished(result);
    });

    // Switch to debug console
    commands.executeCommand("workbench.debug.action.focusRepl");

    // Now after this returns we are launched
    this.sendResponse(response);
  }

  private async on_finished(result: LRParseTreeNode|LexerError|GroupError|ParserError): Promise<void> {
    if (is_group_error(result)) {
      let top_group = result.groups[result.groups.length - 1];
      let pos = this.document!.positionAt(top_group.start_position);
      this.sendEvent(new OutputEvent("Unfinished group: " + top_group.group.name + " at " + pos.line + ": " + pos.character + "\n"));
    } else  if (is_parser_error(result)) {
      let tok = result.last_token === "(EOF)"
              ? "EOF"
              : result.last_token.symbol.name + ": " + result.last_token.value;
      let pos = result.last_token === "(EOF)"
              ? this.document!.lineAt(this.document!.lineCount - 1).range.end
              : this.document!.positionAt(result.last_token.position);
      this.sendEvent(new OutputEvent("Parser error for " + tok + " at " + pos.line + ": " + pos.character + "\n"));
    } else if (is_lexer_error(result)) {
      let symbol = this.document_text!.substring(result.position, result.position + 7) + "...";
      let pos = this.document!.positionAt(result.position);
      this.sendEvent(new OutputEvent("Unlexable symbol at " + pos.line + ": " + pos.character + " (" + symbol + ")" + "\n"));
    } else {
      this.sendEvent(new OutputEvent("Parsing Successful\n"));
    }
    // Finish the execution
    this.sendEvent(new ExitedEvent(parse_successful(result) ? 0 : 1));
    this.sendEvent(new TerminatedEvent());
  }

  private async on_lex(token: Token, ...args: any[]): Promise<void> {
    let pos = this.document!.positionAt(token.position);
    this.sendEvent(new OutputEvent("Lexed token: " + token.symbol.name + ": " + token.value, " at: " + pos.line + ": " + pos.character + "\n"));
  }

  private async on_reduce(orig_state: LRState,
                          look_ahead: Token,
                          stack: ReadonlyArray<LRStackItem>,
                          ...args: any[]): Promise<void> {
    let reduction = stack[stack.length - 1].parse_tree;
    let rule = "";
    if (reduction.children instanceof Array) {
      rule = reduction.symbol.name + " ::= ";
      for (const c of reduction.children) {
        rule += c.symbol.name + " ";
      }
    } else {
      rule = reduction.symbol.name + " = " + reduction.children.symbol.name;
    }
    this.sendEvent(new OutputEvent("Reductuion: " + rule + "\n"));
  }

  private async on_shift(orig_state: LRState,
                         look_ahead: Token,
                         stack: ReadonlyArray<LRStackItem>,
                         ...args: any[]): Promise<void> {
    this.sendEvent(new OutputEvent("Shifted: " + look_ahead.symbol.name + "\n"));
  }

  protected async terminateRequest(response: DebugProtocol.TerminateResponse,
                                   args: DebugProtocol.TerminateArguments,
                                   request?: DebugProtocol.Request
                                  ): Promise<void> {

  }

  protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse,
                                        args: DebugProtocol.SetBreakpointsArguments,
                                        request?: DebugProtocol.Request
                                       ): Promise<void> {

  }

  protected async continueRequest(response: DebugProtocol.ContinueResponse,
                                  args: DebugProtocol.ContinueArguments,
                                  request?: DebugProtocol.Request
                                 ): Promise<void> {

  }

  protected async nextRequest(response: DebugProtocol.NextResponse,
                              args: DebugProtocol.NextArguments,
                              request?: DebugProtocol.Request
                             ): Promise<void> {

  }

  protected async stepInRequest(response: DebugProtocol.StepInResponse,
                                args: DebugProtocol.StepInArguments,
                                request?: DebugProtocol.Request
                               ): Promise<void> {

  }

  protected async stepOutRequest(response: DebugProtocol.StepOutResponse,
                                 args: DebugProtocol.StepOutArguments,
                                 request?: DebugProtocol.Request
                                ): Promise<void> {

  }

  protected async pauseRequest(response: DebugProtocol.PauseResponse,
                               args: DebugProtocol.PauseArguments,
                               request?: DebugProtocol.Request
                              ): Promise<void> {

  }

  protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse,
                                    args: DebugProtocol.StackTraceArguments,
                                    request?: DebugProtocol.Request
                                   ): Promise<void> {

  }

  protected async scopesRequest(response: DebugProtocol.ScopesResponse,
                                args: DebugProtocol.ScopesArguments,
                                request?: DebugProtocol.Request
                               ): Promise<void> {

  }

  protected async variablesRequest(response: DebugProtocol.VariablesResponse,
                                   args: DebugProtocol.VariablesArguments,
                                   request?: DebugProtocol.Request
                                  ): Promise<void> {

  }

  protected async evaluateRequest(response: DebugProtocol.EvaluateResponse,
                                  args: DebugProtocol.EvaluateArguments,
                                  request?: DebugProtocol.Request
                                 ): Promise<void> {

  }

  protected async exceptionInfoRequest(response: DebugProtocol.ExceptionInfoResponse,
                                       args: DebugProtocol.ExceptionInfoArguments,
                                       request?: DebugProtocol.Request
                                      ): Promise<void> {

  }

  protected async dataBreakpointInfoRequest(response: DebugProtocol.DataBreakpointInfoResponse,
                                            args: DebugProtocol.DataBreakpointInfoArguments,
                                            request?: DebugProtocol.Request
                                           ): Promise<void> {

  }

  protected async setDataBreakpointsRequest(response: DebugProtocol.SetDataBreakpointsResponse,
                                            args: DebugProtocol.SetDataBreakpointsArguments,
                                            request?: DebugProtocol.Request
                                           ): Promise<void> {

  }

  protected async readMemoryRequest(response: DebugProtocol.ReadMemoryResponse,
                                    args: DebugProtocol.ReadMemoryArguments,
                                    request?: DebugProtocol.Request
                                   ): Promise<void> {

  }

  protected async cancelRequest(response: DebugProtocol.CancelResponse,
                                args: DebugProtocol.CancelArguments,
                                request?: DebugProtocol.Request
                               ): Promise<void> {

  }

  protected async breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse,
                                             args: DebugProtocol.BreakpointLocationsArguments,
                                             request?: DebugProtocol.Request
                                            ): Promise<void> {

  }

  protected async setInstructionBreakpointsRequest(response: DebugProtocol.SetInstructionBreakpointsResponse,
                                                   args: DebugProtocol.SetInstructionBreakpointsArguments,
                                                   request?: DebugProtocol.Request
                                                  ): Promise<void> {

  }

}
