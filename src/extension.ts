/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GRMAutoComplete } from "./autocomplete";
import { document_changed, document_closed, document_opend } from './grm_editor';

declare global {
	var diagnostics_collection: vscode.DiagnosticCollection;
}

function check_path(): boolean {
	let config = vscode.workspace.getConfiguration("gold");

	let gold_path: string|undefined = config.get("path");
	if (gold_path === undefined) {
		return false;
	}
	return fs.existsSync(gold_path)
		  && fs.existsSync(path.join(gold_path, "GOLDbuild.exe"))
		  && fs.existsSync(path.join(gold_path, "GOLDtest.exe"))
		  && fs.existsSync(path.join(gold_path, "GOLDprog.exe"))
		  && fs.existsSync(path.join(gold_path, "GOLDwebpage.exe"));
}

export function activate(context: vscode.ExtensionContext) {
	let completionProvider = vscode.languages.registerCompletionItemProvider(
		"grm", new GRMAutoComplete()
	);
	globalThis.diagnostics_collection = vscode.languages.createDiagnosticCollection("grm");

	let open_event = vscode.workspace.onDidOpenTextDocument(document_opend);
	let change_event = vscode.workspace.onDidChangeTextDocument(document_changed);
	let close_event = vscode.workspace.onDidCloseTextDocument(document_closed);

	if (!check_path()) {
		vscode.window.showErrorMessage("GOLD cmd binaries directory not set correctly. Please set 'gold.path' property");
	}

	context.subscriptions.push(completionProvider);
	context.subscriptions.push(globalThis.diagnostics_collection);
	context.subscriptions.push(open_event);
	context.subscriptions.push(change_event);
	context.subscriptions.push(close_event);
}

// This method is called when your extension is deactivated
export function deactivate() {}
