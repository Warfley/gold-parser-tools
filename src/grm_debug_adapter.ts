/* eslint-disable @typescript-eslint/naming-convention */
import { DebugSession } from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import { ExitedEvent, InitializedEvent, OutputEvent, Scope, StoppedEvent, TerminatedEvent, Thread } from "@vscode/debugadapter/lib/debugSession";
import { EventEmitter } from "node:stream";
import { once } from "node:events";
import { BreakReason, GRMDebugger, GRMDebugOptions } from "./grm_debugger";
import { select_grammar } from "./grm_debug_config";
import { parse_successful } from "@warfley/node-gold-engine";

interface LaunchArgs extends DebugProtocol.LaunchRequestArguments {
  /** File to be parsed */
  program: string;
  /** Grammar to be used */
  grammar?: string;
  /* Configurations */
  start_paused?: boolean;
  output_reductions?: boolean;
  output_shifts?: boolean;
  output_tokens?: boolean;
}

export class GRMDebugSession extends DebugSession {
  private events = new EventEmitter();
  private debugger!: GRMDebugger;

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

  private pause_execution(reason: BreakReason) {
    if (reason.reason === "error") {
      this.sendEvent(new StoppedEvent("exception", 1));
      return;
    }
    this.sendEvent(new StoppedEvent(reason.reason, 1));
  }

  protected async launchRequest(response: DebugProtocol.LaunchResponse,
                                args: LaunchArgs,
                                request?: DebugProtocol.Request
                               ): Promise<void> {
    let grammar_file = args.grammar;
    let document = args.program;
    let config: GRMDebugOptions = {
      start_paused: args.start_paused || false,
      output_reductions: args.output_reductions || true,
      output_shifts: args.output_shifts || false,
      output_tokens: args.output_tokens || false,
    };
    if (grammar_file === undefined) {
      let selected = await select_grammar();
      if (selected === undefined) {
        this.sendErrorResponse(response, 201, "No grammar selected");
        return;
      }
      grammar_file = selected.fsPath;
    }

    let create_debugger = await GRMDebugger.create(document, grammar_file, config,
      (output) => this.sendEvent(new OutputEvent(output + "\n", "console")),
      (output) => this.sendEvent(new OutputEvent(output + "\n", "important")),
      (reason) => this.pause_execution(reason),
      (result) => {
        this.sendEvent(new ExitedEvent(parse_successful(result) ? 0 : 1));
        this.sendEvent(new TerminatedEvent());
      });
    if (!(create_debugger instanceof GRMDebugger)) {
        this.sendErrorResponse(response, create_debugger.code, create_debugger.message);
        return;
    }

    this.debugger = create_debugger;

    this.sendEvent(new InitializedEvent());
    await once(this.events, "configuration_done");

    // Start execution
    this.debugger.launch();

    // Now after this returns we are launched
    this.sendResponse(response);
  }


  protected async terminateRequest(response: DebugProtocol.TerminateResponse,
                                   args: DebugProtocol.TerminateArguments,
                                   request?: DebugProtocol.Request
                                  ): Promise<void> {
    this.debugger.terminate();
    this.sendResponse(response);
  }

  protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse,
                                        args: DebugProtocol.SetBreakpointsArguments,
                                        request?: DebugProtocol.Request
                                       ): Promise<void> {
		const source_file = args.source.path as string;
		const requests: Array<number> = args.lines || [];

    let real_breakpoints = this.debugger.update_breakpoints(source_file,
                                                            requests.map((l) => l-1));

    response.body = {
      breakpoints: real_breakpoints.map((bp) => {
        return {
          verified: true,
          line: bp!.line + 1,
          column: bp!.column + 1
        };
      })
    };
    this.sendResponse(response);
  }

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {

		// runtime supports no threads so just return a default thread.
		response.body = {
			threads: [
				new Thread(1, "Parsing Thread"),
			]
		};
		this.sendResponse(response);
	}

  protected async continueRequest(response: DebugProtocol.ContinueResponse,
                                  args: DebugProtocol.ContinueArguments,
                                  request?: DebugProtocol.Request
                                 ): Promise<void> {
    this.debugger.resume();
    this.sendResponse(response);
  }

  protected async nextRequest(response: DebugProtocol.NextResponse,
                              args: DebugProtocol.NextArguments,
                              request?: DebugProtocol.Request
                             ): Promise<void> {
    this.debugger.step();
    this.sendResponse(response);
  }

  protected async stepInRequest(response: DebugProtocol.StepInResponse,
                                args: DebugProtocol.StepInArguments,
                                request?: DebugProtocol.Request
                               ): Promise<void> {
    this.debugger.step_in();
    this.sendResponse(response);
  }

  protected async stepOutRequest(response: DebugProtocol.StepOutResponse,
                                 args: DebugProtocol.StepOutArguments,
                                 request?: DebugProtocol.Request
                                ): Promise<void> {
    this.debugger.step_out();
    this.sendResponse(response);
  }

  protected async pauseRequest(response: DebugProtocol.PauseResponse,
                               args: DebugProtocol.PauseArguments,
                               request?: DebugProtocol.Request
                              ): Promise<void> {

    this.sendResponse(response);
  }

  protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse,
                                    args: DebugProtocol.StackTraceArguments,
                                    request?: DebugProtocol.Request
                                   ): Promise<void> {
    response.body = {
      stackFrames: this.debugger.get_frames()
    };
    this.sendResponse(response);
  }

  protected async scopesRequest(response: DebugProtocol.ScopesResponse,
                                args: DebugProtocol.ScopesArguments,
                                request?: DebugProtocol.Request
                               ): Promise<void> {
    let frame_index = args.frameId;
    response.body = {
      scopes: [new Scope(this.debugger.select_frame(frame_index), 1)]
    };
    this.sendResponse(response);
  }

  protected async variablesRequest(response: DebugProtocol.VariablesResponse,
                                   args: DebugProtocol.VariablesArguments,
                                   request?: DebugProtocol.Request
                                  ): Promise<void> {
    let reference = args.variablesReference;
    response.body = {
      variables: this.debugger.get_variables(reference)
    };
    this.sendResponse(response);
  }

  protected async evaluateRequest(response: DebugProtocol.EvaluateResponse,
                                  args: DebugProtocol.EvaluateArguments,
                                  request?: DebugProtocol.Request
                                 ): Promise<void> {

    this.sendResponse(response);
  }

  protected async exceptionInfoRequest(response: DebugProtocol.ExceptionInfoResponse,
                                       args: DebugProtocol.ExceptionInfoArguments,
                                       request?: DebugProtocol.Request
                                      ): Promise<void> {

    this.sendResponse(response);
  }

  protected async dataBreakpointInfoRequest(response: DebugProtocol.DataBreakpointInfoResponse,
                                            args: DebugProtocol.DataBreakpointInfoArguments,
                                            request?: DebugProtocol.Request
                                           ): Promise<void> {

    this.sendResponse(response);
  }

  protected async setDataBreakpointsRequest(response: DebugProtocol.SetDataBreakpointsResponse,
                                            args: DebugProtocol.SetDataBreakpointsArguments,
                                            request?: DebugProtocol.Request
                                           ): Promise<void> {

    this.sendResponse(response);
  }

  protected async readMemoryRequest(response: DebugProtocol.ReadMemoryResponse,
                                    args: DebugProtocol.ReadMemoryArguments,
                                    request?: DebugProtocol.Request
                                   ): Promise<void> {

    this.sendResponse(response);
  }

  protected async cancelRequest(response: DebugProtocol.CancelResponse,
                                args: DebugProtocol.CancelArguments,
                                request?: DebugProtocol.Request
                               ): Promise<void> {

    this.sendResponse(response);
  }

  protected async breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse,
                                             args: DebugProtocol.BreakpointLocationsArguments,
                                             request?: DebugProtocol.Request
                                            ): Promise<void> {

    this.sendResponse(response);
  }

  protected async setInstructionBreakpointsRequest(response: DebugProtocol.SetInstructionBreakpointsResponse,
                                                   args: DebugProtocol.SetInstructionBreakpointsArguments,
                                                   request?: DebugProtocol.Request
                                                  ): Promise<void> {

    this.sendResponse(response);
  }

}
