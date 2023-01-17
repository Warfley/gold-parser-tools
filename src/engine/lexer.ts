/* eslint-disable @typescript-eslint/naming-convention */

import { ParserSymbol, SymbolType } from "./parser";

interface CharRange {
  start: number;
  end: number;
}

export class CharRangeSet {
  private ranges: Array<CharRange> = [];
  private codepage: number = 0; // How is this encoded?

  constructor(codepage: number) {
    this.codepage = codepage;
  }

  public add_range(start: number, end: number) {
    this.ranges.push({
      start: start,
      end: end,
    });
  }

  private encoding(): BufferEncoding {
    // For now: Ignore code page
    return "utf16le";
  }

  public contains(value: string): boolean {
    let code_point = Buffer.from(value, this.encoding()).readUint16LE();
    for (let range of this.ranges) {
      if (code_point >= range.start &&
          code_point <= range.end) {
        return true;
      }
    }
    return false;
  }

}

type SimpleCharset = Set<string>;

export type CharSet = SimpleCharset|CharRangeSet;

function char_in_set(char: string, charset: CharSet) {
  if (charset instanceof CharRangeSet) {
    return charset.contains(char);
  }
  return charset.has(char);
}

interface DFAEdge {
  target: DFAState;
  label: CharSet;
}

export interface DFAState {
  index: number;
  edges: Array<DFAEdge>;
  result?: ParserSymbol;
}

export interface Token {
  symbol: ParserSymbol;
  value: string;
  position: number;
}

export function dfa_match(str: string, start_pos: number, dfa: DFAState): Token|undefined {
  let current_state = dfa;
  let last_match: Token|undefined = undefined;

  for (let i=start_pos; i<str.length; ++i) {
    const chr = str.charAt(i);
    let found = false;
    for (let edge of current_state.edges) {
      if (char_in_set(chr, edge.label)) {
        current_state = edge.target;
        found = true;
        break;
      }
    }
    if (!found) {
      return last_match;
    }
    if (current_state.result !== undefined) {
      last_match = {
        value: str.substring(start_pos, i+1),
        symbol: current_state.result,
        position: start_pos
      };
    }
  }
  return last_match === undefined
       ? { position: str.length,
           symbol: {
             name: "EOF",
             type: SymbolType.FILE_END
           },
           value: "EOF" }
       : last_match;
}