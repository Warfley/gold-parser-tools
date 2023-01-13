/* eslint-disable @typescript-eslint/naming-convention */
import { TextDocument, Position, CancellationToken, CompletionItemProvider, CompletionItem, CompletionList, ProviderResult, CompletionItemKind, CompletionContext } from "vscode";
import { DocumentParser, GRMToken, DefinitionType, TokenType } from "./grm_parser";

export class GRMAutoComplete implements CompletionItemProvider {
  private parser?: DocumentParser = undefined;

  private add_symbols(symbols: Array<GRMToken>, list: CompletionList) {
    list.items = list.items.concat(
      symbols.map((symbol) => new CompletionItem(symbol.value,
          symbol.type === TokenType.SET
        ? CompletionItemKind.Enum
        : symbol.type === TokenType.NON_TERMINAL
        ? CompletionItemKind.Variable
        : CompletionItemKind.Constant
    )));
  }

  provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext): ProviderResult<CompletionItem[] | CompletionList<CompletionItem>> {

    this.parser = DocumentParser.get_or_create(document);
    let result = new CompletionList<CompletionItem>();

    let last_definition = this.parser.definition_at(position);
    if (last_definition === undefined ||
        last_definition.type === DefinitionType.ERROR) {
      this.add_symbols(this.parser.undefined_tokens(TokenType.SET), result);
      this.add_symbols(this.parser.undefined_tokens(TokenType.TERMINAL), result);
      this.add_symbols(this.parser.undefined_tokens(TokenType.NON_TERMINAL), result);
    } else {
      let definition = last_definition.type;
      switch (definition) {
      case DefinitionType.SET:
        this.add_symbols(this.parser.all_tokens(TokenType.SET), result);
        break;

      case DefinitionType.TERMINAL:
        this.add_symbols(this.parser.all_tokens(TokenType.SET), result);
        this.add_symbols(this.parser.all_tokens(TokenType.TERMINAL), result);
        break;

      case DefinitionType.NON_TERMINAL:
        this.add_symbols(this.parser.all_tokens(TokenType.NON_TERMINAL), result);
        this.add_symbols(this.parser.all_tokens(TokenType.TERMINAL), result);
        break;

      case DefinitionType.PARAMETER:
        this.add_symbols(this.parser.all_tokens(TokenType.NON_TERMINAL), result);
        break;
      }
    }

    this.parser.update_diagnostics();
    return result;
  }

  resolveCompletionItem?(item: CompletionItem, token: CancellationToken): ProviderResult<CompletionItem> {
    return null;
  }

}