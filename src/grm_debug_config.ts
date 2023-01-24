/* eslint-disable @typescript-eslint/naming-convention */
import * as path from 'path';
import {DebugAdapterDescriptor, DebugAdapterDescriptorFactory, DebugAdapterInlineImplementation, DebugConfiguration, DebugConfigurationProvider, DebugSession, ProviderResult, Uri, window, workspace, WorkspaceFolder} from 'vscode';
import { GRMDebugSession } from './grm_debug_adapter';

export async function select_grammar(): Promise<Uri|undefined> {
  let grammars = await workspace.findFiles("**/*.grm");
  grammars = grammars.concat(await workspace.findFiles("**/*egt"));
  grammars = grammars.concat(await workspace.findFiles("**/*.cgt"));
  let selection = await window.showQuickPick(grammars.map((grammar_path) => {
    return {
      label: path.basename(grammar_path.path),
      description: workspace.asRelativePath(grammar_path.path),
      uri: grammar_path
    };
  }), {canPickMany: false});
  if (selection !== undefined) {
    return selection.uri;
  }
  return undefined;
}

export const GRMDbgConfigProvider: DebugConfigurationProvider = {
  provideDebugConfigurations(folder: WorkspaceFolder | undefined,
                            ): ProviderResult<DebugConfiguration[]> {
    let result: DebugConfiguration = {
      name: "Parse with Grammar",
      request: "launch",
      type: "grm",
      program: "${file}",
      start_paused: false,
      output_reductions: true,
      output_shifts: false,
      output_tokens: false
    };
    return [result];
  },

  async resolveDebugConfiguration(folder: WorkspaceFolder | undefined,
                                  debugConfiguration: DebugConfiguration,
                                 ): Promise<DebugConfiguration|undefined> {
    // if launch.json is missing or empty
    if (!debugConfiguration.type && !debugConfiguration.request && !debugConfiguration.name) {
      debugConfiguration.type = 'grm';
      debugConfiguration.name = 'Parse File';
      debugConfiguration.request = 'launch';
      debugConfiguration.program = '${file}';
      debugConfiguration.start_paused = false;
      debugConfiguration.output_reductions = true;
      debugConfiguration.output_shifts = false;
      debugConfiguration.output_tokens = false;
    }
    // if grammar is not set
    if (debugConfiguration.grammar === undefined) {
      const grammar = await select_grammar();
      if (grammar === undefined) {
        return undefined;
      }
      debugConfiguration.grammar = grammar.fsPath;
    }
    return debugConfiguration;
  }
};

export const GRMDebugFactory: DebugAdapterDescriptorFactory = {
  createDebugAdapterDescriptor(session: DebugSession): ProviderResult<DebugAdapterDescriptor> {
    return new DebugAdapterInlineImplementation(new GRMDebugSession());
  }
};
