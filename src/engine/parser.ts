/* eslint-disable @typescript-eslint/naming-convention */

import { DFAState, dfa_match, Token } from "./lexer";

enum LRActionType {
  SHIFT = 1,
  REDUCE = 2,
  GOTO = 3,
  ACCEPT = 4
}

enum SymbolType {
  NON_TERMINAL = 0,
  TERMINAL = 1,
  SKIP_SYMBOLS = 2, // Whitespaces, newlines, etc.
  FILE_END = 3,
  GROUP_START = 4,
  GROUP_END = 5,
  COMMENT_LINE = 6,
  ERROR = 7
}

export interface ParserSymbol {
  type: SymbolType;
  name: string;
}

interface LRAction {
  type: LRActionType.ACCEPT|LRActionType.REDUCE|LRActionType.SHIFT,
  symbol: ParserSymbol;
  consumes?: Array<String>;
  target: LRState;
}

interface LRState {
  index: number;
  edges: Map<string, LRAction>;
}

interface LRTreeNode {
  symbol: ParserSymbol;
  children: Token|Array<LRTreeNode>;
}

interface LRStackItem {
  parse_tree: LRTreeNode;
  current_state: LRState;
}

type LRStack = Array<LRStackItem>;

enum LRStepResult { ACCEPT, SHIFT, REDUCE, ERROR }

function LALR_step(look_ahead: Token, stack: LRStack): LRStepResult {
  let current_state = stack[stack.length-1].current_state;
  let action = current_state.edges.get(look_ahead.symbol.name);

  if (action === undefined) {
    return LRStepResult.ERROR;
  }
  if (action.type === LRActionType.ACCEPT) {
    return LRStepResult.ACCEPT;
  }
  if (action.type === LRActionType.SHIFT) {
    stack.push({
      current_state: action.target,
      parse_tree: {
        symbol: action.symbol,
        children: look_ahead
      }
    });
    return LRStepResult.SHIFT;
  } // else if (action.type === LRActionType.REDUCE)

  // Reduction
  if (stack.length < action.consumes!.length) {
    throw new Error("State mismatch");
  }
  let new_symbol = action.symbol;
  let consumes = action.consumes!.map(() => stack.pop()!.parse_tree);
  let top_state = stack[stack.length-1].current_state;
  let next_state = top_state.edges.get(action.symbol.name);

  if (next_state === undefined) {
    throw new Error("Symbol not found");
  }

  stack.push({
    parse_tree: {
      symbol: new_symbol,
      children: consumes
    },
    current_state: next_state.target
  });

  return LRStepResult.REDUCE;
}

function LALR_setup(initial_state: LRState): LRStack {
  return [{
    current_state: initial_state,
    parse_tree: {
      symbol: {
        name: "INITIAL_STATE",
        type: SymbolType.ERROR
      },
      children: []
    }
  }];
}

interface LexerError {
  position: number;
}

interface ParserError {
  last_token: "EOF"|Token;
  stack: LRStack;
}

type DFAEvent = (token: Token) => void;
type LREvent = (orig_state: LRState, look_ahead: Token, stack: LRStack) => void;

export function parse_string(str: string, dfa: DFAState, lalr: LRState,
                             on_token?: DFAEvent,
                             on_reduce?: LREvent,
                             on_shift?: LREvent
                            ): LRTreeNode|LexerError|ParserError {
  let look_ahead: Token|undefined = undefined;
  let current_pos = 0;
  let stack = LALR_setup(lalr);

  while (current_pos < str.length) {
    if (look_ahead === undefined) {
      // Lex next token
      let tok = dfa_match(str, current_pos, dfa);
      if (tok === undefined) {
        return {position: current_pos};
      }
      if (tok === "EOF") {
        return {
          stack: stack,
          last_token: "EOF"
        };
      }
      current_pos += tok.value.length;
      look_ahead = tok;
      if (on_token !== undefined) {
        on_token(tok);
      }
      continue;
    } // else

    let current_state = stack[stack.length-1].current_state;
    let step = LALR_step(look_ahead, stack);
    switch (step) {
      case LRStepResult.ACCEPT:
        return stack.pop()!.parse_tree;

      case LRStepResult.ERROR:
        return {
          last_token: look_ahead,
          stack: stack
        };

        case LRStepResult.REDUCE:
          if (on_reduce !== undefined) {
            on_reduce(current_state, look_ahead, stack);
          }
          break;

        case LRStepResult.SHIFT:
          if (on_shift !== undefined) {
            on_shift(current_state, look_ahead, stack);
          }
          look_ahead = undefined;
          break;
    }
  }
  return {
    stack: stack,
    last_token: "EOF"
  };
}