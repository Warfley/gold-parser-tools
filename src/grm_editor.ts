/* eslint-disable @typescript-eslint/naming-convention */
import { commands, Position, Range, TextDocument, TextDocumentChangeEvent, TextEditor, window } from "vscode";
import { DocumentParser, DefinitionType, TokenType } from "./grm_parser";

export function document_opend(document: TextDocument) {
		if (document.languageId === "grm") {
			let parser = DocumentParser.get_or_create(document);
			parser.parse();
			parser.update_diagnostics();
		}
}

function unindent(editor: TextEditor, at_line: number) {
  let ln = editor.document.lineAt(at_line);
  let indent = ln.isEmptyOrWhitespace
             ? ln.range.end.character
             : ln.firstNonWhitespaceCharacterIndex - 1;
  let delete_range = new Range(ln.range.start, ln.range.start.translate(0, indent));
    editor.edit((builder) =>{
      builder.delete(delete_range);
    });
}

function indent_to_last_definition(parser: DocumentParser, editor: TextEditor, autoindent: number = 0, at_line?: number) {

  if (at_line === undefined) {
    at_line = editor.selection.start.line;
  }

  if (at_line < 1) {
    return;
  }

  let last_definition = parser.definition_at(editor.document.lineAt(at_line - 1).range.end);
  if (last_definition === undefined || last_definition?.type === DefinitionType.ERROR) {
    unindent(editor, at_line);
    return;
  }

  let equals_index = last_definition.symbols.findIndex((s) => s.type === TokenType.OPERATOR);
  if (equals_index !== 1) {
    return;
  }
  let indent = last_definition.symbols[equals_index].location.character - autoindent;
  if (indent < 0) {
    return;
  }

  if (editor.document.lineAt(at_line - 1).text.trimEnd().endsWith("=")) {
    indent += 2;
  } else {
    if (last_definition.type === DefinitionType.TERMINAL) {
      unindent(editor, at_line);
      return;
    }
    if (last_definition.type === DefinitionType.NON_TERMINAL) {
      indent += 1;
    };
  }

  if (indent <= 0) {
    return;
  }

  editor.edit((builder) =>{
    builder.insert(new Position(at_line!, 0), ' '.repeat(indent));
  }).then(() =>
    commands.executeCommand("cursorMove", {
      to: "right",
      by: "chacharacter",
      value: indent
  }));
}

const new_line_expr = /\n( *)$/m;

export function document_changed(event: TextDocumentChangeEvent) {
  let editor = window.activeTextEditor;
  if (editor?.document.uri.toString() !== event.document.uri.toString() ||
      event.document.languageId !== "grm" ||
      event.contentChanges.length === 0) {
        return;
  }

  let parser = DocumentParser.get_or_create(event.document);
  parser.parse();
  parser.update_diagnostics();

  // Newline indentations
  if (event.contentChanges.length >= 1) { // Sometimes event with no changes is fired
    let match = new_line_expr.exec(event.contentChanges[0].text);
    if (match !== null) {
      // When autoident it is for some reason 2 changes
      if (event.contentChanges.length === 1 ||(
          event.contentChanges.length === 2 &&
          event.contentChanges[1].text === "" &&
          event.contentChanges[1].range.start.line === event.contentChanges[0].range.start.line + 1
        )) {
        indent_to_last_definition(parser, editor, match[1].length, event.contentChanges[0].range.end.line+1);
      }
    }
  }
}

export function document_closed(document: TextDocument) {
		if (document.languageId === "grm") {
			DocumentParser.close_document(document);
		}
}
