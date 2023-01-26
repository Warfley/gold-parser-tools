/* eslint-disable @typescript-eslint/naming-convention */
import { DiagnosticSeverity, workspace, TextDocument, window, Diagnostic, commands, Uri, debug, QuickPickItem } from "vscode";
import * as fs from 'fs';
import * as path from 'path';
import { platform } from "process";
import { spawnSync } from "child_process";
import { prepare_grammar, select_grammar } from "./grm_debug_config";
import { Serializers, serialize_cgt } from "./serializers/serializer";
import { CGTData } from "@warfley/node-gold-engine";

export const BUILD_EXE = "GOLDbuild.exe";
export const TEST_EXE = "GOLDtest.exe";
export const PROG_EXE = "GOLDprog.exe";
export const WEBPAGE_EXE = "GOLDwebpage.exe";

export function executable_path(exec: string): string|undefined {
	let config = workspace.getConfiguration("gold");
	let config_path: string|undefined = config.get("path");

  if (config_path === undefined) {
    return undefined;
  }

  return path.join(config_path, exec);
}

export function check_paths(): boolean {
  let paths = [
    executable_path(BUILD_EXE),
    executable_path(TEST_EXE),
    executable_path(PROG_EXE),
    executable_path(WEBPAGE_EXE),
  ];

  for (let p of paths) {
    if (p === undefined || !fs.existsSync(p)) {
      return false;
    }
  }

  if (platform !== "win32") {
    // On Unix require wine
    let which = spawnSync("which", ["wine"]);
    // Which checks if a exec is in PATH and returns 0 if so
    if (which.status === null || which.status !== 0) {
      return false;
    }
  }

  return true;
}

function compile_grammar(grammar_file: string, output_dir: string, v5_grammar: boolean = true): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let base_name = path.basename(grammar_file, ".grm");
    let compiled_name = base_name
                      + (v5_grammar
                      ? ".egt"
                      : ".cgt");

    let compiled_file = path.join(output_dir, compiled_name);
    let log_file = path.join(output_dir, compiled_name + ".log");

    let exec = executable_path(BUILD_EXE);
    if (exec === undefined) {
      reject();
      return;
    }

    let args: Array<string> = [];
    if (platform !== "win32") {
      args.push(exec);
      exec = "wine";
    }
    args.push(grammar_file);
    args.push(compiled_file);
    args.push(log_file);

    let term = window.createTerminal("gold",
    exec, args);
    let pid = term.processId;
    term.show();

    window.onDidCloseTerminal((t) => {
      if (t.processId !== pid) {
        return;
      }
      if (t.exitStatus?.code === undefined || t.exitStatus.code !== 0) {
        reject();
      } else {
        resolve(compiled_file);
      }
    });
  });
}

const log_read_regex = /(Grammar|LALR States|DFA States|System)+\s+([^\s]+)\s+(\d+)?\s+(.+)/gm;
function lookup_errors(log_file: string, document: TextDocument): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    fs.readFile(log_file, {encoding: "utf-8"}, (err, data) => {
      if (err !== null) {
        reject();
        return;
      }
      data = data.replace("\uFEFF", "");
      let result = false;
      let errors: Array<Diagnostic> = [];
      let matches = data.matchAll(log_read_regex);
      for (let match of matches) {
        let compile_step: string = match[1];
        let message_type: string = match[2];
        let line_str: string | undefined = match[3];
        let message: string = match[4];

        if (message_type === "Details" &&
            match[0].endsWith(" : ")) {
          continue;
        }

        let error_range = line_str === undefined
                        ? document.lineAt(0).range
                        : document.lineAt(+line_str).range;

        if (compile_step === "System") {
          result = message_type === "Success";
          break;
        }
        errors.push(new Diagnostic(error_range,
                                   "[" + compile_step + "]: " + message,
                                     message_type === "Warning"
                                   ? DiagnosticSeverity.Warning
                                   : message_type === "Error"
                                   ? DiagnosticSeverity.Error
                                   : DiagnosticSeverity.Information
                                   ));
      }
      diagnostics_collection.set(document.uri, errors);
      fs.rm(log_file, (err) => undefined);
      resolve(result);
    });
  });
}

export async function on_compile_command(grm_file?: Uri): Promise<false|string> {
  let document = grm_file !== undefined
               ? await workspace.openTextDocument(grm_file)
               : undefined;
  if (document === undefined) {
    document =window.activeTextEditor?.document;
  }
  if (document === undefined || document.languageId !== "grm") {
    window.showErrorMessage("Only Gold Grammar files (.grm) can be compiled with this command");
    return false;
  }
  if (!fs.existsSync(document.fileName)) {
    window.showErrorMessage("GOLD Parser Tools extension currently only works for local workspaces, this seems to be a remote workspace");
    return false;
  }

  await document.save();

  let output_dir = path.join(path.dirname(document.fileName), "gold-build");
  if (!fs.existsSync(output_dir)) {
    fs.mkdirSync(output_dir);
  }

  let compile_result = await compile_grammar(document.fileName, output_dir);
  let success = await lookup_errors(compile_result + ".log", document);

  success = success && fs.existsSync(compile_result);

  commands.executeCommand("workbench.actions.view.problems");

  if (!success) {
    return false;
  }
  return compile_result;
}

export async function on_parse_command(text_file?: Uri, grammar?: Uri): Promise<boolean> {
  let document = text_file !== undefined
               ? await workspace.openTextDocument(text_file)
               : undefined;
  if (document === undefined) {
    document = window.activeTextEditor?.document;
  }

  if (document === undefined) {
    return false;
  }

  if (grammar === undefined) {
    grammar = await select_grammar();
  }

  if (grammar === undefined) {
    return false;
  }

  debug.startDebugging(undefined, {
    name: "Parse File with Grammar",
    type: "grm",
    request: "launch",
    program: document.fileName,
    grammar: grammar.fsPath
  });

  return true;
}

function grammar_name(file_name: string, cgt: CGTData): string {
  let name = cgt.params.get("Name") || cgt.params.get("name");
  if (name === undefined) {
    name = path.basename(file_name).toLowerCase();
    name = name.substring(0, name.length - 4);
  }
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

export async function on_generate_from_grammar(grammar?: Uri): Promise<boolean> {
  if (grammar === undefined) {
    grammar = await select_grammar();
  }
  if (grammar === undefined) {
    return false;
  }

  let current_editor = window.activeTextEditor;
  if (current_editor === undefined) {
    return false;
  }

  let cgt_data = await prepare_grammar(grammar.fsPath);
  if (cgt_data === undefined) {
    window.showErrorMessage("Grammar Compilation Error");
    return false;
  }

  let selected_serializer = Serializers.get(current_editor.document.languageId);
  if (selected_serializer === undefined) {
    let selection = await window.showQuickPick([...Serializers.keys()].map((s) => {
      return {
        label: s
      };
    }), {canPickMany: false});
    if (selection !== undefined) {
      selected_serializer = Serializers.get(selection.label);
    }
  }

  if (selected_serializer === undefined) {
    return false;
  }

  let where: "declaration"|"definition"|"imports"|undefined = undefined;
  let selectable: Array<QuickPickItem> = [{
    label: "declaration",
    detail: "Generate the Declaration (Header) of the CGT Data"
  }];
  if (!selected_serializer.only_declaration) {
    selectable.push({
      label: "definition",
      detail: "Generate the Definition (implementation) of the CGT Data"
    });
  }
  if (selected_serializer.imports !== undefined) {
    selectable.unshift({
      label: "imports",
      detail: "Generate the Imports for a CGT Grammar"
    });
  }
  let selection = await window.showQuickPick(selectable, {canPickMany: false});
  if (selection?.label === "declaration" ||
      selection?.label === "definition" ||
      selection?.label === "imports") {
    where = selection.label;
  }

  if (where === undefined) {
    return false;
  }

  let serialized = where === "imports"
                 ? selected_serializer.imports!
                 : serialize_cgt(cgt_data, selected_serializer, grammar_name(grammar.fsPath, cgt_data), where);

  current_editor.edit((builder) => builder.insert(current_editor!.selection.start, serialized));
  return true;
}
