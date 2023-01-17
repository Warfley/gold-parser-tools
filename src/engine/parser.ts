/* eslint-disable @typescript-eslint/naming-convention */

import { DFAState, dfa_match, Token } from "./lexer";

export enum LRActionType {
  SHIFT = 1,
  REDUCE = 2,
  GOTO = 3,
  ACCEPT = 4
}

export enum SymbolType {
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
  group?: MatchGroup;
}

export interface ParserRule {
  produces: ParserSymbol;
  consumes: Array<ParserSymbol>;
}

export interface MatchGroup {
  name: string;
  symbol: ParserSymbol;
  start_symbol: ParserSymbol;
  end_symbol: ParserSymbol;
  advance_mode: "Char"|"Token";
  ending_mode: "Open"|"Closed";

  nestable_groups: Set<string>;
}

export interface LRAction {
  type: LRActionType.REDUCE|LRActionType.SHIFT|LRActionType.GOTO,
  target: LRState|ParserRule;
}

export interface LRState {
  index: number;
  edges: Map<string, LRAction|"Accept">;
}

export interface LRParseTreeNode {
  symbol: ParserSymbol;
  children: Token|Array<LRParseTreeNode>;
}

interface LRStackItem {
  parse_tree: LRParseTreeNode;
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
  if (action === "Accept") {
    return LRStepResult.ACCEPT;
  }
  if (action.type === LRActionType.SHIFT) {
    stack.push({
      current_state: action.target as LRState,
      parse_tree: {
        symbol: look_ahead.symbol,
        children: look_ahead
      }
    });
    return LRStepResult.SHIFT;
  } // else if (action.type === LRActionType.REDUCE)

  // Reduction
  let rule = action.target as ParserRule;
  if (stack.length < rule.consumes.length) {
    throw new Error("State mismatch");
  }
  let new_symbol = rule.produces;
  let consumes = rule.consumes.map(() => stack.pop()!.parse_tree).reverse();
  let top_state = stack[stack.length-1].current_state;
  let next_state = top_state.edges.get(rule.produces.name);

  if (next_state === undefined) {
    throw new Error("Symbol not found");
  }

  if (next_state === "Accept") {
    throw new Error("Unexpected Accept");
  }

  if (next_state.type === LRActionType.GOTO) {
    throw new Error("GOTO Expected");
  }

  stack.push({
    parse_tree: {
      symbol: new_symbol,
      children: consumes
    },
    current_state: next_state.target as LRState
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

interface GroupError {
  groups: GroupStack;
}

interface GroupStackItem {
  group: MatchGroup,
  start_token: Token
}

type GroupStack = Array<GroupStackItem>;

function advance_mode(stack: GroupStack): "Char"|"Token" {
  return stack.length === 0
      ? "Token"
      : stack[stack.length - 1].group.advance_mode;
}

function next_increment(stack: GroupStack, token?: Token): number {
  if (token === undefined || advance_mode(stack) === "Char") {
    return 1;
  }
  return token.value.length;
}

function close_group(stack: GroupStack, end_pos: number, str: string): Token {
  let top_group = stack.pop()!;
  return {
    position: top_group.start_token.position,
    symbol: top_group.group.symbol,
    value: str.substring(top_group.start_token.position,
                         end_pos)
  };
}

function next_token(str: string, position: number, dfa: DFAState): Token|GroupError|undefined {
  let group_stack: GroupStack = [];

  let token: Token|undefined = undefined;

  for (let curr_pos=position;
       curr_pos <= str.length && // <= because on the first out of bounds char will get EOF
      (token === undefined || // If no token was read we advance 1 char
       group_stack.length > 0); // If a group is still open we try to close it
      curr_pos += next_increment(group_stack, token)) {

    token = dfa_match(str, curr_pos, dfa);
    if (token === undefined) {
      // Not in group: parser error
      if (group_stack.length === 0) {
        return undefined;
      }
      // In group we accept anything
      continue;
    }

    if (token.symbol.type === SymbolType.FILE_END) {
      // On EOF stop reading
      break;
    }

    let stack_top = group_stack.length > 0
                  ? group_stack[group_stack.length - 1]
                  : undefined;

    if (token.symbol.type === SymbolType.GROUP_START &&
       (stack_top === undefined ||
        stack_top.group.nestable_groups.has(token.symbol.group!.name))) {
      // New group started: push to stack
      group_stack.push({
        group: token.symbol.group!,
        start_token: token
      });
      continue;
    }
    if (stack_top !== undefined &&
        stack_top.group.end_symbol.name === token.symbol.name) {
      let end_pos = token.position + token.value.length;
      if (token.symbol.name.toLowerCase() === "newline") {
        // Special handling for groups ending on newline: don't consume newline
        end_pos = token.position;
      }
      token = close_group(group_stack, end_pos, str);
      // If there are no more groups the for loop will exit and token will be returned
      continue;
    }
  }

  // Check for still open groups
  while (group_stack.length > 0) {
    let top = group_stack[group_stack.length - 1];
    if (top.group.ending_mode === "Open") {
      // Open groups can be closed at EOF
      token = close_group(group_stack, str.length, str);
    } else { // Closed groups must be finished
      return {groups: group_stack};
    }
  }

  return token;
}

type DFAEvent = (token: Token, ...args: any[]) => Promise<void>;
type LREvent = (orig_state: LRState, look_ahead: Token, stack: ReadonlyArray<LRStackItem>, ...args: any[]) => Promise<void>;

export async function parse_string(str: string, dfa: DFAState, lalr: LRState,
                             on_token?: DFAEvent,
                             on_reduce?: LREvent,
                             on_shift?: LREvent,
                             ...args: any[]
                            ): Promise<LRParseTreeNode|LexerError|GroupError|ParserError> {
  let look_ahead: Token|undefined = undefined;
  let current_pos = 0;
  let stack = LALR_setup(lalr);

  while (current_pos <= str.length || look_ahead !== undefined) {
    if (look_ahead === undefined) {
      // Lex next token
      let tok = next_token(str, current_pos, dfa);
      if (tok === undefined) {
        return {position: current_pos};
      }
      if ("groups" in tok) {
        return tok;
      }
      current_pos += tok.value.length;
      if (tok.symbol.type === SymbolType.SKIP_SYMBOLS) {
        continue;
      }
      look_ahead = tok;
      if (on_token !== undefined) {
        await on_token(tok, ...args);
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
            await on_reduce(current_state, look_ahead, stack, ...args);
          }
          break;

        case LRStepResult.SHIFT:
          if (on_shift !== undefined) {
            await on_shift(current_state, look_ahead, stack, ...args);
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