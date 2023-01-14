/* eslint-disable @typescript-eslint/naming-convention */
import { TextDocument, Position, CancellationToken, CompletionItemProvider, CompletionItem, CompletionList, ProviderResult, CompletionItemKind, CompletionContext, languages, Range } from "vscode";
import { DocumentParser, GRMToken, DefinitionType, TokenType, GRMDefinition } from "./grm_parser";

export class GRMAutoComplete implements CompletionItemProvider {
  private parser?: DocumentParser = undefined;

  private add_symbols(symbol_type: TokenType, 
                      list: CompletionList, 
                      replace_token?: GRMToken, 
                      only_undefined: boolean = false) {
    if (this.parser === undefined) {
      return;
    }
    if (replace_token !== undefined &&
        replace_token!.type !== TokenType.UNKNOWN &&
        replace_token!.type !== symbol_type) {
      // Only add those that match the currently replaced token
      return;
    }
    let symbols = only_undefined 
                ? this.parser.undefined_tokens(symbol_type)
                : this.parser.all_tokens(symbol_type);

    for (let symbol of symbols) {
      let item = new CompletionItem(symbol.value,
            symbol.type === TokenType.SET
          ? CompletionItemKind.Enum
          : symbol.type === TokenType.NON_TERMINAL
          ? CompletionItemKind.Variable
          : CompletionItemKind.Constant
      );
      if (replace_token !== undefined) {
        item.range = new Range(replace_token.location,
                               replace_token.location.translate(0, replace_token.value.length));
      }
      list.items.push(item);
    }
  }

  private backtrack_token(document: TextDocument, position: Position, current_definition: GRMDefinition): GRMToken|undefined {
    let last_index = 0;
    for (; last_index<current_definition.symbols.length; ++last_index) {
      if (current_definition.symbols[last_index].location.isAfter(position)) {
        break;
      }
    }
    if (last_index === current_definition.symbols.length) {
      --last_index;
    }
    let last_token = current_definition.symbols[last_index];
    if (last_token.location.line !== position.line) { // If first in new line it cannot be part of another token
      return undefined;
    }

    let last_char = last_token.location.character + last_token.value.length;
    // Check if position is in token
    if ((last_token.type !== TokenType.TERMINAL &&
        position.character < last_char) ||
        (last_token.type === TokenType.UNKNOWN &&
        position.character <= last_char)) {
      return last_token;
    } else if (last_token.type === TokenType.TERMINAL) {
      // are special because they are not enclosed
      // If a token is incomplete (i.e. <foo) it will be recognized as "ERROR" followed by "TERMINAL"
      // In this case we want to complete the token
      let error_token: GRMToken|undefined = undefined;
      for (let i=last_index - 1; i>=0; --i) {
        error_token = current_definition.symbols[i];
        if (error_token.type === TokenType.UNKNOWN && (
            error_token.value.endsWith("<") || 
            error_token.value.endsWith("[") || 
            error_token.value.endsWith("{") || 
            error_token.value.endsWith("'") || 
            error_token.value.endsWith("\"")
        )) {
          break; // Found the start of an unclosed definition
        } else if (error_token.type !== TokenType.TERMINAL ||
                   error_token.location.line !== position.line) {
          // If we reach the first symbol thats neither a terminal
          // nor one of the opening tokens as described above
          // or if we reached the previous line
          // we stop searching
          error_token = undefined;
          break;
        }
      }
      if (error_token !== undefined) {
        let error_end = error_token.value.at(error_token.value.length - 1);
        // Create new temporary token to be returned
        let token_start = error_token.location.translate(0, error_token.value.length - 1);
        let token_end = Math.max(position.character, last_char);
        return {
          location: token_start,
          value: document.lineAt(position.line).text.substring(token_start.character, token_end),
          type: error_end === "<"
              ? TokenType.NON_TERMINAL
              : error_end === "["
              ? TokenType.CONST_SET
              : error_end === "{"
              ? TokenType.SET
              : error_end === "'"
              ? TokenType.CONST_TERMINAL
              : error_end === "\""
              ? TokenType.PARAMETER
              : TokenType.UNKNOWN
        };
      }
      // If we are in this token or we can append this token
      if (position.character <= last_char) {
        return last_token;
      }
    }

    return undefined;
  }

  provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext): ProviderResult<CompletionItem[] | CompletionList<CompletionItem>> {

    this.parser = DocumentParser.get_or_create(document);
    this.parser.parse();
    let result = new CompletionList<CompletionItem>();

    let last_definition = this.parser.definition_at(position);
    let replace_token = last_definition !== undefined
                        ? this.backtrack_token(document, position, last_definition)
                        : undefined;

    if (last_definition === undefined ||
        last_definition.type === DefinitionType.ERROR) {
      this.add_symbols(TokenType.SET, result, replace_token, true);
      this.add_symbols(TokenType.TERMINAL, result, replace_token, true);
      this.add_symbols(TokenType.NON_TERMINAL, result, replace_token, true);
    } else {
      let definition = last_definition.type;
      switch (definition) {
      case DefinitionType.SET:
        this.add_symbols(TokenType.SET, result, replace_token);
        break;

      case DefinitionType.TERMINAL:
        this.add_symbols(TokenType.SET, result, replace_token);
        this.add_symbols(TokenType.TERMINAL, result, replace_token);
        this.add_symbols(TokenType.CONST_TERMINAL, result, replace_token);
        break;

      case DefinitionType.NON_TERMINAL:
        this.add_symbols(TokenType.NON_TERMINAL, result, replace_token);
        this.add_symbols(TokenType.TERMINAL, result, replace_token);
        this.add_symbols(TokenType.CONST_TERMINAL, result, replace_token);
        break;

      case DefinitionType.PARAMETER:
        this.add_symbols(TokenType.NON_TERMINAL, result, replace_token);
        break;
      }
    }

    this.parser.update_diagnostics();
    return result;
  }

}
