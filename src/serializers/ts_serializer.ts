/* eslint-disable @typescript-eslint/naming-convention */
import { LRActionType, SymbolType, CharRangeSet } from "@warfley/node-gold-engine";
import { ArraySerializer, CGTDataName, CGTSerializer } from "./serializer";

function escape_string(str: string): string {
  return JSON.stringify(str);
}

const TypeScriptArraySerializer: ArraySerializer = {
  value_in_declaration: true,

  declaration: function (array: object[], datatype: CGTDataName): string {
    switch (datatype) {
    case "charset":
      return "charsets: ";
    case "symbol":
      return "symbols: ";
    case "dfastate":
      return "dfa_states: ";
    case "lrstate":
      return "lr_states: ";
    case "rule":
      return "rules: ";
    case "group":
      return "groups: ";
    }
    throw new Error("Not an array type " + datatype);
  },


  before_elements: (arr, datatype) => "[\n    ",
  before_element: () => "",
  after_element: () => "",
  between_elements: (e1, e2) => ",\n    ",
  after_elements: (arr, datatype) => "\n  ]",

  definition: () => "",
};

export const TypeScriptSerializer: CGTSerializer = {
  imports: 'import { CGTData, CharRangeSet, LRActionType, SymbolType } from "@warfley/node-gold-engine";',

  before_declarations: (cgt_data, grammar_name) =>
    "export const " + grammar_name + "_grammar: CGTData = {\n  ",
  between_declarations: (decl_type_1, decl_type_2) => ",\n  ",
  after_declarations: (cgt_data, grammar_name) => "\n};",
  before_definitions: () => "",
  between_definitions: () => "",
  after_definitions: () => "",

  only_declaration: true,

  version_serializer: {
    declaration: (version) => "version: " + escape_string(version),
    definition: () => ""
  },

  params_serializer: {
    declaration: (params) => {
      const nl = "\n    ";
      let result = "params: new Map<string, string>([" + nl;
      for (let [k, v] of params.entries()) {
        result += "[" + escape_string(k) + ", "+ escape_string(v) + "]," + nl;
      }
      result = result.trim() +  "\n  ])";
      return result;
    },
    definition: () => ""
  },
  charset_serializer: {
    ...TypeScriptArraySerializer,
    serialize_element: (charset, _) => {
      const nl = "\n      ";
      if (charset instanceof CharRangeSet) {
        let result = "new CharRangeSet(" + charset.codepage + ", [" + nl;
        for (const range of charset.ranges) {
          result += "{start: " + range.start + ", end: " + range.end + "}," + nl;
        }
        result = result.trim() + "\n    ])";
        return result;
      }
      let charset_str = "";
      for (const char of charset) {
        charset_str += char;
      }
      return "new Set<string>([..." + escape_string(charset_str) +"])";
    }
  },
  symbol_serializer: {
    ...TypeScriptArraySerializer,
    serialize_element: (symbol, _) => "{name: " + escape_string(symbol.name) + ", type: SymbolType." + SymbolType[symbol.type] + "}"
  },
  dfa_state_serializer: {
    ...TypeScriptArraySerializer,
    serialize_element: (dfa_state, _) => {
      const nl = "\n      ";
      let result = "{" + nl;
      if (dfa_state.result !== undefined) {
        result += "result: " + dfa_state.result + "," + nl;
      }
      result += "edges: [" + nl;
      for (const edge of dfa_state.edges) {
        result += "  {label: " + edge.label + ", target:" + edge.target + "},"+ nl;
      }
      result += "]\n    }";
      return result;
    }
  },
  lr_state_serializer: {
    ...TypeScriptArraySerializer,
    serialize_element: (lr_state, _) => {
      const nl = "\n      ";
      let result = "{" + nl + "transitions: [" + nl;
      for (let edge of lr_state.transitions) {
        result += "  {action_type: LRActionType." + LRActionType[edge.action_type] + ", "
                   + "look_ahead_symbol: " + edge.look_ahead_symbol + ", "
                   + "value: " + edge.value + "}," + nl;
      }
      result += "]\n    }";
      return result;
    }
  },
  dfa_initial_serializer: {
    declaration: (state) => "dfa_init_state: " + state,
    definition: () => ""
  },
  lr_initial_serializer: {
    declaration: (state) => "lr_init_state: " + state,
    definition: () => ""
  },
  rule_serializer: {
    ...TypeScriptArraySerializer,
    serialize_element: (rule, _) => {
      const nl = "\n      ";
      let result = "{" + nl
                 + "index: " + rule.index + "," + nl
                 + "produces: " + rule.produces + "," + nl
                 + "consumes: [";
      for (let consume of rule.consumes) {
        result += consume + ", ";
      }
      result = result.trim() + "]\n    }";
      return result;
    }
  },
  group_serializer: {
    ...TypeScriptArraySerializer,
    serialize_element: (group, _) => {
      const nl = "\n      ";
      let result = "{" + nl
                 + "name: " + escape_string(group.name) + "," + nl
                 + "symbol: " + group.symbol + "," + nl
                 + "start_symbol: " + group.start_symbol + "," + nl
                 + "end_symbol: " + group.end_symbol + "," + nl
                 + "advance_mode: " + escape_string(group.advance_mode) + "," + nl
                 + "ending_mode: " + escape_string(group.ending_mode) + "," + nl
                 + "nestable_groups: [";
      for (let nestable of group.nestable_groups) {
        result += nestable + ", ";
      }
      result = result.trim() + "]\n    }";
      return result;
    }
  }
};
