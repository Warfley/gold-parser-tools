/* eslint-disable @typescript-eslint/naming-convention */
import { TextDocument, Position, CancellationToken, CompletionItemProvider, CompletionContext, CompletionItem, CompletionList, ProviderResult, CompletionItemKind } from "vscode";
import { DocumentParser, GRMToken, ParserContext, TokenType } from "./grm_parser";

export class GRMAutoComplete implements CompletionItemProvider {
  private parser?: DocumentParser = undefined;

  private current_context(position: Position): ParserContext {
    if (this.parser === undefined) {
      return ParserContext.ERROR;
    }

    for (let ctx of this.parser.context_ranges) {
      if (position.line === ctx.range.start.line) {
        return position.character >= ctx.range.start.character
             ? ctx.context
             : ParserContext.NONE;
      } else if (position.line > ctx.range.start.line &&
                 position.line <= ctx.range.end.line) {
        // A context can only start with a new line
        // therefore no char position check required
        return ctx.context;
      }
    }

    return ParserContext.NONE;
  }

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

    this.parser = new DocumentParser(document);
    this.parser.parse();
    let result = new CompletionList<CompletionItem>();

    let ctx = this.current_context(position);

    switch (ctx) {
    case ParserContext.NONE:
      this.add_symbols(this.parser.undefined_tokens(TokenType.SET), result);
      this.add_symbols(this.parser.undefined_tokens(TokenType.TERMINAL), result);
      this.add_symbols(this.parser.undefined_tokens(TokenType.NON_TERMINAL), result);
      break;

    case ParserContext.SET:
      this.add_symbols(this.parser.all_tokens(TokenType.SET), result);
      break;

    case ParserContext.TERMINAL:
      this.add_symbols(this.parser.all_tokens(TokenType.SET), result);
      this.add_symbols(this.parser.all_tokens(TokenType.TERMINAL), result);
      break;

    case ParserContext.NON_TERMINAL:
      this.add_symbols(this.parser.all_tokens(TokenType.NON_TERMINAL), result);
      this.add_symbols(this.parser.all_tokens(TokenType.TERMINAL), result);
      break;

    case ParserContext.PARAM:
      this.add_symbols(this.parser.all_tokens(TokenType.NON_TERMINAL), result);
      break;

    case ParserContext.ERROR:
      this.add_symbols(this.parser.all_tokens(TokenType.NON_TERMINAL), result);
      this.add_symbols(this.parser.all_tokens(TokenType.SET), result);
      this.add_symbols(this.parser.all_tokens(TokenType.TERMINAL), result);

      break;
    }

    this.parser.update_diagnostics();
    return result;
  }

  resolveCompletionItem?(item: CompletionItem, token: CancellationToken): ProviderResult<CompletionItem> {
    this.parser?.parse();
    this.parser?.update_diagnostics();
    return null;
  }

}