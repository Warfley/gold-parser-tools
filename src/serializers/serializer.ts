/* eslint-disable @typescript-eslint/naming-convention */
import { CGTData, CGTDFAState, CGTGroup, CGTLRState, CGTRule, CGTSymbol, CharSet } from "@warfley/node-gold-engine";
import { TypeScriptSerializer } from "./ts_serializer";

export const Serializers = new Map<string, CGTSerializer>([
  ["typescript", TypeScriptSerializer]
]);

export type CGTDataName = "version"|"param"|"charset"|"symbol"|"dfastate"
                         |"lrstate"|"dfainitial"|"lrinitial"|"rule"|"group";

export interface CGTSerializer {
  imports?: string;

  before_declarations: (cgt_data: CGTData, grammar_name: string) => string;
  between_declarations: (decl_type_1: CGTDataName, decl_type_2: CGTDataName) => string;
  after_declarations: (cgt_data: CGTData, grammar_name: string) => string;

  before_definitions: (cgt_data: CGTData, grammar_name: string) => string;
  between_definitions: (decl_type_1: CGTDataName, decl_type_2: CGTDataName) => string;
  after_definitions: (cgt_data: CGTData, grammar_name: string) => string;

  // Some languages like C cannot have data in the type declaration
  // Thats why it is distinquished between definition and declaration
  // If the language can do all in one place, set this to true
  only_declaration: boolean;

  array_serializer: ArraySerializer;
  version_serializer: VersionSerializer;
  params_serializer: ParamsSerializer;
  charset_serializer: CharsetSerializer;
  symbol_serializer: SymbolSerializer;
  dfa_state_serializer: DFAStateSerializer;
  lr_state_serializer: LRStateSerializer;
  dfa_initial_serializer: InitialSerializer;
  lr_initial_serializer: InitialSerializer;
  rule_serializer: RuleSerializer;
  group_serializer: GroupSerializer;
}

export interface ArraySerializer {
  value_in_declaration: boolean;
  declaration: (array: Array<object>, datatype: CGTDataName) => string;
  definition: (array: Array<object>, datatype: CGTDataName) => string;
  before_elements: (array: Array<object>, datatype: CGTDataName) => string;
  before_element: (element: object, datatype: CGTDataName) => string;
  after_element: (element: object, datatype: CGTDataName) => string;
  between_elements: (element1: object, element2: object, datatype: CGTDataName) => string;
  after_elements: (array: Array<object>, datatype: CGTDataName) => string;
}

export interface VersionSerializer {
  declaration: (version: "v1"|"v5") => string;
  definition: (version: "v1"|"v5") => string;
}

export interface ParamsSerializer {
  declaration: (params: Map<string, string>) => string;
  definition: (params: Map<string, string>) => string;
}

export interface CharsetSerializer {
  in_array: (charset: CharSet) => string;
}

export interface SymbolSerializer {
  in_array: (symbol: CGTSymbol) => string;
}

export interface DFAStateSerializer {
  in_array: (dfa_state: CGTDFAState) => string;
}

export interface LRStateSerializer {
  in_array: (lr_state: CGTLRState) => string;
}

export interface InitialSerializer {
  declaration: (initial_state: number) => string;
  definition: (initial_state: number) => string;
}

export interface RuleSerializer {
  in_array: (rule: CGTRule) => string;
}

export interface GroupSerializer {
  in_array: (group: CGTGroup) => string;
}

function serialize_element(element: object, datatype: CGTDataName, serializer: CGTSerializer): string {
  switch (datatype) {
  case "charset":
    return serializer.charset_serializer.in_array(element as CharSet);
  case "symbol":
    return serializer.symbol_serializer.in_array(element as CGTSymbol);
  case "dfastate":
    return serializer.dfa_state_serializer.in_array(element as CGTDFAState);
  case "lrstate":
    return serializer.lr_state_serializer.in_array(element as CGTLRState);
  case "rule":
    return serializer.rule_serializer.in_array(element as CGTRule);
  case "group":
    return serializer.group_serializer.in_array(element as CGTGroup);
  }

  throw new Error("Not an array type");
}

function serialize_array(array: Array<object>, datatype: CGTDataName, where: "declaration"|"definition", serializer: CGTSerializer): string {
  let result = "";
  result += serializer.array_serializer.declaration(array, datatype);
  if (where === "definition") {
    result += serializer.array_serializer.definition(array, datatype);
  }
  if (where === "declaration" && serializer.array_serializer.value_in_declaration ||
      where === "definition" && !serializer.array_serializer.value_in_declaration) {
    result += serializer.array_serializer.before_elements(array, datatype);
    for (let i=0; i<array.length; ++i) {
      if (i>0) {
        result += serializer.array_serializer.between_elements(array[i-1], array[i], datatype);
      }
      result += serializer.array_serializer.before_element(array[i], datatype);
      result += serialize_element(array[i], datatype, serializer);
      result += serializer.array_serializer.after_element(array[i], datatype);
    }
    result += serializer.array_serializer.after_elements(array, datatype);
  }
  return result;
}

export function serialize_cgt(cgt_data: CGTData, serializer: CGTSerializer,
                              grammar_name: string,
                              where: "declaration"|"definition"): string {
  let result = "";
  if (where === "declaration") {
    result += serializer.before_declarations(cgt_data, grammar_name);
    result += serializer.version_serializer.declaration(cgt_data.version);
    result += serializer.between_declarations("version", "param");
    result += serializer.params_serializer.declaration(cgt_data.params);
    result += serializer.between_declarations("param", "charset");
    result += serialize_array(cgt_data.charsets, "charset", where, serializer);
    result += serializer.between_declarations("charset", "symbol");
    result += serialize_array(cgt_data.symbols, "symbol", where, serializer);
    result += serializer.between_declarations("symbol", "dfastate");
    result += serialize_array(cgt_data.dfa_states, "dfastate", where, serializer);
    result += serializer.between_declarations("dfastate", "lrstate");
    result += serialize_array(cgt_data.lr_states, "lrstate", where, serializer);
    result += serializer.between_declarations("lrstate", "dfainitial");
    result += serializer.dfa_initial_serializer.declaration(cgt_data.dfa_init_state);
    result += serializer.between_declarations("dfainitial", "lrinitial");
    result += serializer.lr_initial_serializer.declaration(cgt_data.lr_init_state);
    result += serializer.between_declarations("lrinitial", "rule");
    result += serialize_array(cgt_data.rules, "rule", where, serializer);
    result += serializer.between_declarations("rule", "group");
    result += serialize_array(cgt_data.groups, "group", where, serializer);
    result += serializer.after_declarations(cgt_data, grammar_name);
  } else { // "definition"
    result += serializer.before_definitions(cgt_data, grammar_name);
    result += serializer.version_serializer.definition(cgt_data.version);
    result += serializer.between_definitions("version", "param");
    result += serializer.params_serializer.definition(cgt_data.params);
    result += serializer.between_definitions("param", "charset");
    result += serialize_array(cgt_data.charsets, "charset", where, serializer);
    result += serializer.between_definitions("charset", "symbol");
    result += serialize_array(cgt_data.symbols, "symbol", where, serializer);
    result += serializer.between_definitions("symbol", "dfastate");
    result += serialize_array(cgt_data.dfa_states, "dfastate", where, serializer);
    result += serializer.between_definitions("dfastate", "lrstate");
    result += serialize_array(cgt_data.lr_states, "lrstate", where, serializer);
    result += serializer.between_definitions("lrstate", "dfainitial");
    result += serializer.dfa_initial_serializer.definition(cgt_data.dfa_init_state);
    result += serializer.between_definitions("dfainitial", "lrinitial");
    result += serializer.lr_initial_serializer.definition(cgt_data.lr_init_state);
    result += serializer.between_definitions("lrinitial", "rule");
    result += serialize_array(cgt_data.rules, "rule", where, serializer);
    result += serializer.between_definitions("rule", "group");
    result += serialize_array(cgt_data.groups, "group", where, serializer);
    result += serializer.after_definitions(cgt_data, grammar_name);
  }

  return result;
}
