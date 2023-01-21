/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import { GRMAutoComplete } from "./grm_completion";
import { document_changed, document_closed, document_opend } from './grm_editor';
import { check_paths, on_compile_command, on_parse_command } from './grm_tools';

declare global {
	var diagnostics_collection: vscode.DiagnosticCollection;
}

export function activate(context: vscode.ExtensionContext) {
	let completionProvider = vscode.languages.registerCompletionItemProvider(
		"grm", new GRMAutoComplete()
	);
	globalThis.diagnostics_collection = vscode.languages.createDiagnosticCollection("grm");

	let open_event = vscode.workspace.onDidOpenTextDocument(document_opend);
	let change_event = vscode.workspace.onDidChangeTextDocument(document_changed);
	let close_event = vscode.workspace.onDidCloseTextDocument(document_closed);

	let compile_command = vscode.commands.registerCommand("gold-parser-tools.compileGrammar", on_compile_command);
	let parse_command = vscode.commands.registerCommand("gold-parser-tools.parseWithGrammar", on_parse_command);

	if (!check_paths()) {
		vscode.window.showErrorMessage("GOLD cmd binaries directory not set correctly. Please set 'gold.path' property");
	}

	context.subscriptions.push(completionProvider);
	context.subscriptions.push(globalThis.diagnostics_collection);
	context.subscriptions.push(open_event);
	context.subscriptions.push(change_event);
	context.subscriptions.push(close_event);
	context.subscriptions.push(compile_command);
	context.subscriptions.push(parse_command);
}

// This method is called when your extension is deactivated
export function deactivate() {

}
