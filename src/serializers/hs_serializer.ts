/* eslint-disable @typescript-eslint/naming-convention */
import { LRActionType, SymbolType, CharRangeSet } from "@warfley/node-gold-engine";
import { ArraySerializer, CGTDataName, CGTSerializer } from "./serializer";

function escape_string(str: string): string {
  return JSON.stringify(str);
}

const HaskellArraySerializer: ArraySerializer = {
  value_in_declaration: true,

  declaration: () => "",
  before_elements: () => "",
  before_element: () => "",
  after_element: () => "\n\n",
  between_elements: () => "",
  after_elements: () => "\n",

  definition: () => "",
};

export const HaskellSerializer: CGTSerializer = {
  imports: "import Ranges ( (...), fromList, RangeSet )\n" +
           "import Tokenizer\n" +
           "import Parser\n" +
           "    ( LRAction(Reduction, Accept, Shift), LRState(LRState) )\n" +
           "import Data.Map(Map, fromList)\n" +
           "import Data.Char(chr)\n",

  before_declarations: (cgt_data, grammar_name) => "\n",
  between_declarations: (decl_type_1, decl_type_2) => "\n\n",
  after_declarations: (cgt_data, grammar_name) => "\n",
  before_definitions: () => "",
  between_definitions: () => "",
  after_definitions: () => "",

  only_declaration: true,

  version_serializer: {
    declaration: (version) =>
      "grammarVersion :: String\n"
    + "grammarVersion = " + escape_string(version),
    definition: () => ""
  },

  params_serializer: {
    declaration: (params) => {
      const nl = "\n    ";
      let result = "grammarParams :: Map String String\n"
                 + "grammarParams = Data.Map.fromList" + nl + "$ ";
      for (let [k, v] of params.entries()) {
        result += "(" + escape_string(k) + ", "+ escape_string(v) + ")" + nl + ": ";
      }
      result += '[]';
      return result;
    },
    definition: () => ""
  },
  charset_serializer: {
    ...HaskellArraySerializer,
    serialize_element: (charset, idx) => {
      const nl = "\n      ";
      let result = "charset" + idx.toString() + " :: RangeSet Char\n"
                 + "charset" + idx.toString() + " = Ranges.fromList" + nl + "$ ";
      if (charset instanceof CharRangeSet) {
        for (const range of charset.ranges) {
          let cpOffset = (1<<16)*charset.codepage;
          let rStart = cpOffset + range.start;
          let rEnd = cpOffset + range.end;
          result += "( chr " + rStart.toString() + " ... chr " + rEnd.toString() + " )" + nl+ ": ";
        }
      } else {
        for (const char of charset) {
          result += "( '" + char + "'...'" + char + "' )" + nl+ ": ";
        }
      }
      return result + "[]";
    }
  },
  symbol_serializer: {
    ...HaskellArraySerializer,
    serialize_element: (symbol, idx, grp) => {
      switch (symbol.type) {
        case SymbolType.NON_TERMINAL:
          return "symbol" + idx + " :: (String, ())\n" +
                 "symbol" + idx + ' = ("<' + symbol.name + '>", ())';
        case SymbolType.TERMINAL:
          return "symbol" + idx + " :: (String, TokenType String String)\n" +
                 "symbol" + idx + ' = ("\\"' + symbol.name + '\\"", Literal)';
        case SymbolType.SKIPPABLE:
          return "symbol" + idx + " :: (String, TokenType String String)\n" +
                 "symbol" + idx + ' = ("\\"' + symbol.name + '\\"", Skippable)';
        case SymbolType.EOF:
          return "symbol" + idx + " :: (String, TokenType String String)\n" +
                 "symbol" + idx + ' = ("(' + symbol.name + ')", Literal)\n\n' +
                 "eofSymbol" + " :: String\n" +
                 "eofSymbol = fst $ symbol" + idx + '\n\n';
        case SymbolType.GROUP_START:
          if (grp === undefined) {
            throw new Error("Group start without a group");
          }
          return "symbol" + idx + " :: (String, TokenType String String)\n" +
                 "symbol" + idx + ' = ("\\"' + symbol.name + '\\"", GroupStart matchingGroup' + grp +')';
        case SymbolType.GROUP_END:
          if (grp === undefined) {
            throw new Error("Group end without a group");
          }
          return "symbol" + idx + " :: (String, TokenType String String)\n" +
                 "symbol" + idx + ' = ("\\"' + symbol.name + '\\"", GroupEnd $ groupName matchingGroup' + grp +')';
        case SymbolType.ERROR:
          return "";
      }
      throw new Error("Unserializable symbol type");
    }
  },
  dfa_state_serializer: {
    value_in_declaration: true,

    declaration: () => "dfaStates :: [(Int, Maybe (String, TokenType String String), [(RangeSet Char, Int)])]\n",
    before_elements: () => "dfaStates =\n    ",
    before_element: () => "( ",
    after_element: () => "\n    )",
    between_elements: () => "\n    : ",
    after_elements: () => "    : []\n\n" +
      "grammarDFA :: DFA Char (String, TokenType String String)\n" +
      "grammarDFA = DFA\n" +
      "    (Data.Map.fromList [(s, t) | (s, _, t) <- dfaStates])\n" +
      "    (Data.Map.fromList $ filterFinals dfaStates)\n" +
      "    dfaInitialState where\n" +
      "        filterFinals [] = []\n" +
      "        filterFinals ((s, Just t, _):xs) = (s, t):(filterFinals xs)\n" +
      "        filterFinals (_:xs) = filterFinals xs\n",

    definition: () => "",

    serialize_element: (dfa_state, index) => {
      const nl = "\n        ";
      let result = index + ", ";
      result += dfa_state.result !== undefined
              ? "Just symbol" + dfa_state.result
              : "Nothing";
      result += ", ";
      for (const edge of dfa_state.edges) {
        result += "( charset" + edge.label + ", " + edge.target + " )" + nl+ ": ";
      }
      result += "[]";
      return result;
    },
  },
  lr_state_serializer: {
    ...HaskellArraySerializer,
    serialize_element: (lr_state, index) => {
      const nl = "\n        ";
      let result = "lalrState" + index + " :: LRState String\n" +
                   "lalrState" + index + " = LRState " + index + "\n" +
                   "    ( Data.Map.fromList" + nl + "$ ";
      for (let edge of lr_state.transitions) {
        switch(edge.action_type) {
          case LRActionType.SHIFT:
            result += "( fst symbol" + edge.look_ahead_symbol + ", Shift lalrState" + edge.value + " )" + nl + ": ";
            break;
          case LRActionType.REDUCE:
            result += "( fst symbol" + edge.look_ahead_symbol + ", lalrRule" + edge.value + " )" + nl + ": ";
            break;
          case LRActionType.GOTO:
            break;
          case LRActionType.ACCEPT:
            result += "( fst symbol" + edge.look_ahead_symbol + ", Accept )" + nl + ": ";
            break;
        }
      }
      result += "[]\n    ) ( Data.Map.fromList" + nl + "$ ";
      for (let edge of lr_state.transitions) {
        if (edge.action_type === LRActionType.GOTO) {
            result += "( fst symbol" + edge.look_ahead_symbol + ", lalrState" + edge.value + " )" + nl + ": ";
        }
      }
      result += "[]\n    )";
      return result;
    }
  },
  dfa_initial_serializer: {
    declaration: (state) => "dfaInitialState :: Int\n" +
                            "dfaInitialState = " + state,
    definition: () => ""
  },
  lr_initial_serializer: {
    declaration: (state) => "lalrInitialState :: LRState String\n" +
                            "lalrInitialState = lalrState" + state,
    definition: () => ""
  },
  rule_serializer: {
    ...HaskellArraySerializer,
    serialize_element: (rule, index) => {
      const nl = "\n      ";
      let result = "lalrRule" + index + " :: LRAction String\n" +
                   "lalrRule" + index + " = Reduction (fst symbol" + rule.produces + ")" + nl + "$ ";
      for (let consume of rule.consumes) {
        result += "fst symbol" + consume + nl + ": ";
      }
      result += "[]";
      return result;
    }
  },
  group_serializer: {
    ...HaskellArraySerializer,
    serialize_element: (group, index) => {
      const nl = "\n    ";
      let result = "matchingGroup" + index + " :: MatchingGroup String String\n"
                 + "matchingGroup" + index + " = MatchingGroup" + nl
                 + escape_string(group.name) + nl
                 + "symbol" + group.symbol + nl
                 + "(fst symbol" + group.start_symbol + ")" + nl
                 + "(fst symbol" + group.end_symbol + ")" + nl
                 + group.advance_mode + "wise" + nl
                 + group.ending_mode + nl + "    $ ";
      for (let nestable of group.nestable_groups) {
        result += "groupName matchingGroup" + nestable + nl + "    : ";
      }
      result += "[]";
      return result;
    }
  }
};
