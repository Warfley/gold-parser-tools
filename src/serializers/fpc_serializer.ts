/* eslint-disable @typescript-eslint/naming-convention */
import { CharRangeSet } from "@warfley/node-gold-engine";
import { ArraySerializer, CGTSerializer } from "./serializer";

function escape_string(str: string): string {
  let result = "";
  let in_string = false;
  for (const char of str) {
    if (char.charCodeAt(0) < 32) {
      if (in_string) {
        result += "'";
        in_string = false;
      }
      result += "#" + char.charCodeAt(0);
    } else {
      if (!in_string) {
        result += "'";
        in_string = true;
      }
      if (char === "'") {
        result += "''";
      } else {
        result += char;
      }
    }
  }
  if (in_string) {
    result += "'";
  }
  return result;
}

const FreePascalAddSerializer: ArraySerializer = {
  value_in_declaration: false,

  declaration: () => "",
  definition: () => "",

  before_elements: (arr, datatype) => "",
  before_element: (element, index, datatype) => {
    switch (datatype) {
    case "charset":
      return "FDFA.AddCharset(";
    case "symbol":
      return "SymbolList.Add(";
    case "dfastate":
      return "FDFA.AddState(";
    case "lrstate":
      return "FLALR.AddState(";
    case "rule":
      return "FLALR.AddRule(";
    case "group":
      return "FDFA.AddGroup(";
    }
    throw new Error("Not an array type " + datatype);
  },
  after_element: () => ");\n    ",
  between_elements: () => "",
  after_elements: () => ""
};

export const FreePascalSerializer: CGTSerializer = {
  imports: 'parser, lexer, cgtloader',

  before_declarations: (cgt_data, grammar_name) =>
      "type\n"
    + "  T" + grammar_name + " = class(TCGTGrammar)\n",
  between_declarations: () => "",
  after_declarations: () => "  public\n"
                          + "    constructor Create;\n"
                          + "  end;",
  before_definitions: (cgt_data, grammar_name) =>
      "constructor T" + grammar_name + ".Create;\n"
    + "var\n"
    + "  SymbolList: TGrammarSymbolList;\n"
    + "begin\n"
    + "  inherited Create;\n"
    + "  SymbolList := TGrammarSymbolList.Create;\n"
    + "  try\n    ",
  between_definitions: () => "\n    ",
  after_definitions: () => "\n    Prepare(SymbolList);\n"
                         + "  finally\n"
                         + "    SymbolList.Free;\n"
                         + "  end;\n"
                         + "end;\n",

  only_declaration: false,

  version_serializer: {
    declaration: () => "",
    definition: (version) => "FVersion := " + (
                             version === "v1"
                           ? "gv1;"
                           : "gv5;"
    )
  },

  params_serializer: {
    declaration: () => "",
    definition: (params) => {
      let result = "";
      for (const [k, v] of params.entries()) {
        result += "FParameter.Add(" + escape_string(k) + ", " + escape_string(v)
                + ");\n    ";
      }
      return result.trim();
    }
  },
  charset_serializer: {
    ...FreePascalAddSerializer,
    serialize_element: (charset, _) => {
      const nl = "\n      ";
      if (charset instanceof CharRangeSet) {
        let result = "TRangeCharset.FromArray(" + charset.codepage + ", [" + nl;
        let ranges = charset.ranges.map((range) =>
          "CodepointRange(" + range.start + ", " + range.end + ")");
        result += ranges.join("," + nl) + "\n    ])";
        return result;
      }
      let charset_str = "";
      for (const char of charset) {
        charset_str += char;
      }
      return "TStaticCharset.FromString(" + escape_string(charset_str) + ");";
    }
  },
  symbol_serializer: {
    ...FreePascalAddSerializer,
    serialize_element: (symbol, _) => "Symbol(SymbolList.Count, "
                                 + escape_string(symbol.name)
                                 + ", TSymbolType(" + symbol.type+ "))"
  },
  dfa_state_serializer: {
    ...FreePascalAddSerializer,
    serialize_element: (dfa_state, _) => {
      const nl = "\n      ";
      let result = (dfa_state.result || -1) + ", [" + nl;
      let edges = dfa_state.edges.map((edge) =>
        "DFAEdge(" + edge.label + ", " + edge.target + ")");
      result += edges.join("," + nl) + "\n    ]";
      return result;
    }
  },
  lr_state_serializer: {
    ...FreePascalAddSerializer,
    serialize_element: (lr_state, _) => {
      const nl = "\n      ";
      let result = "TLRState.Create([" + nl;
      let transitions = lr_state.transitions.map((edge) =>
          "LRTransition(" + edge.look_ahead_symbol + ", "
        + "TLRActionType(" + edge.action_type + "), "
        + edge.value + ")");
      result += transitions.join("," + nl) + "\n    ])";
      return result;
    }
  },
  dfa_initial_serializer: {
    declaration: () => "",
    definition: (state) => "FDFA.SetInitialState(" + state + ");"
  },
  lr_initial_serializer: {
    declaration: () => "",
    definition: (state) => "FLALR.SetInitialState(" + state + ");\n"
  },
  rule_serializer: {
    ...FreePascalAddSerializer,
    serialize_element: (rule, _) => {
      let result = "LRRule(" + rule.produces + ", [";
      result += rule.consumes.join(", ") + "])";
      return result;
    }
  },
  group_serializer: {
    ...FreePascalAddSerializer,
    serialize_element: (group, _) => {
      let result = "Group(" + escape_string(group.name) + ", "
                 + group.symbol + ", " + group.start_symbol + ", "
                 + group.end_symbol + ", ga" + group.advance_mode + "wise, "
                 + "ge" + group.ending_mode + ", [";
      result += group.nestable_groups.join(", ") + "])";
      return result;
    }
  }
};
