import * as vscode from 'vscode';
import { GRMAutoComplete } from "./autocomplete";

export function activate(context: vscode.ExtensionContext) {
	let completionProvider = vscode.languages.registerCompletionItemProvider(
		"grm", new GRMAutoComplete()
	);
	context.subscriptions.push(completionProvider);
}

// This method is called when your extension is deactivated
export function deactivate() {}
