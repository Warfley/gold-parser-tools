import { TextDocument, Position, CancellationToken, CompletionItemProvider, CompletionContext, CompletionItem, CompletionList, ProviderResult } from "vscode";

export class GRMAutoComplete implements CompletionItemProvider {
  provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext): ProviderResult<CompletionItem[] | CompletionList<CompletionItem>> {
    return [];
  }
  resolveCompletionItem?(item: CompletionItem, token: CancellationToken): ProviderResult<CompletionItem> {
    return null;
  }

}