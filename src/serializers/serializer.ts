/* eslint-disable @typescript-eslint/naming-convention */
import { CGTData, CGTDFAState, CGTGroup, CGTLRState, CGTRule, CGTSymbol, CharSet, SymbolType } from "@warfley/node-gold-engine";
import { FreePascalSerializer } from "./fpc_serializer";
import { TypeScriptSerializer } from "./ts_serializer";
import { HaskellSerializer } from "./hs_serializer";

export const Serializers = new Map<string, CGTSerializer>([
  ["typescript", TypeScriptSerializer],
  ["pascal", FreePascalSerializer],
  ["haskell", HaskellSerializer]
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
  before_element: (element: object, index: number, datatype: CGTDataName) => string;
  after_element: (element: object, index: number, datatype: CGTDataName) => string;
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

export interface CharsetSerializer extends ArraySerializer {
  serialize_element: (charset: CharSet, index: number) => string;
}

export interface SymbolSerializer extends ArraySerializer {
  serialize_element: (symbol: CGTSymbol, index: number, grp?: number) => string;
}

export interface DFAStateSerializer extends ArraySerializer {
  serialize_element: (dfa_state: CGTDFAState, index: number) => string;
}

export interface LRStateSerializer extends ArraySerializer {
  serialize_element: (lr_state: CGTLRState, index: number) => string;
}

export interface InitialSerializer {
  declaration: (initial_state: number) => string;
  definition: (initial_state: number) => string;
}

export interface RuleSerializer extends ArraySerializer {
  serialize_element: (rule: CGTRule, index: number) => string;
}

export interface GroupSerializer extends ArraySerializer {
  serialize_element: (group: CGTGroup, index: number) => string;
}

export class GrammarSerializer {
  private cgt_data: CGTData;

  constructor (cgt_data: CGTData) {
    this.cgt_data = cgt_data;
  }

  private findSymGroup(idx: number): number|undefined {
    let symbol = this.cgt_data.symbols[idx];
    if (symbol.type !== SymbolType.GROUP_START &&
        symbol.type !== SymbolType.GROUP_END) {
          return undefined;
        }
    for (let i=0;i<this.cgt_data.groups.length;++i) {
      let grp = this.cgt_data.groups[i];
      if (grp.start_symbol === idx || grp.end_symbol === idx) {
        return i;
      }
    }
    return undefined;
  }

  private serialize_element(element: object, index: number, datatype: CGTDataName, serializer: ArraySerializer): string {
    switch (datatype) {
    case "charset":
      return (serializer as CharsetSerializer).serialize_element(element as CharSet, index);
    case "symbol":
      return (serializer as SymbolSerializer).serialize_element(element as CGTSymbol, index, this.findSymGroup(index));
    case "dfastate":
      return (serializer as DFAStateSerializer).serialize_element(element as CGTDFAState, index);
    case "lrstate":
      return (serializer as LRStateSerializer).serialize_element(element as CGTLRState, index);
    case "rule":
      return (serializer as RuleSerializer).serialize_element(element as CGTRule, index);
    case "group":
      return (serializer as GroupSerializer).serialize_element(element as CGTGroup, index);
    }

    throw new Error("Not an array type");
  }

  private serialize_array(array: Array<object>, datatype: CGTDataName, where: "declaration"|"definition", element_serializer: ArraySerializer): string {
    let result = "";
    result += element_serializer.declaration(array, datatype);
    if (where === "definition") {
      result += element_serializer.definition(array, datatype);
    }
    if (where === "declaration" && element_serializer.value_in_declaration ||
        where === "definition" && !element_serializer.value_in_declaration) {
      result += element_serializer.before_elements(array, datatype);
      for (let i=0; i<array.length; ++i) {
        if (i>0) {
          result += element_serializer.between_elements(array[i-1], array[i], datatype);
        }
        result += element_serializer.before_element(array[i], i, datatype);
        result += this.serialize_element(array[i], i, datatype, element_serializer);
        result += element_serializer.after_element(array[i], i, datatype);
      }
      result += element_serializer.after_elements(array, datatype);
    }
    return result;
  }

  public serialize(serializer: CGTSerializer,
                     grammar_name: string,
                     where: "declaration"|"definition"): string {
    let result = "";
    if (where === "declaration") {
      result += serializer.before_declarations(this.cgt_data, grammar_name);
      result += serializer.version_serializer.declaration(this.cgt_data.version);
      result += serializer.between_declarations("version", "param");
      result += serializer.params_serializer.declaration(this.cgt_data.params);
      result += serializer.between_declarations("param", "charset");
      result += this.serialize_array(this.cgt_data.charsets, "charset", where, serializer.charset_serializer);
      result += serializer.between_declarations("charset", "symbol");
      result += this.serialize_array(this.cgt_data.symbols, "symbol", where, serializer.symbol_serializer);
      result += serializer.between_declarations("symbol", "dfastate");
      result += this.serialize_array(this.cgt_data.dfa_states, "dfastate", where, serializer.dfa_state_serializer);
      result += serializer.between_declarations("dfastate", "lrstate");
      result += this.serialize_array(this.cgt_data.lr_states, "lrstate", where, serializer.lr_state_serializer);
      result += serializer.between_declarations("lrstate", "dfainitial");
      result += serializer.dfa_initial_serializer.declaration(this.cgt_data.dfa_init_state);
      result += serializer.between_declarations("dfainitial", "lrinitial");
      result += serializer.lr_initial_serializer.declaration(this.cgt_data.lr_init_state);
      result += serializer.between_declarations("lrinitial", "rule");
      result += this.serialize_array(this.cgt_data.rules, "rule", where, serializer.rule_serializer);
      result += serializer.between_declarations("rule", "group");
      result += this.serialize_array(this.cgt_data.groups, "group", where, serializer.group_serializer);
      result += serializer.after_declarations(this.cgt_data, grammar_name);
    } else { // "definition"
      result += serializer.before_definitions(this.cgt_data, grammar_name);
      result += serializer.version_serializer.definition(this.cgt_data.version);
      result += serializer.between_definitions("version", "param");
      result += serializer.params_serializer.definition(this.cgt_data.params);
      result += serializer.between_definitions("param", "charset");
      result += this.serialize_array(this.cgt_data.charsets, "charset", where, serializer.charset_serializer);
      result += serializer.between_definitions("charset", "symbol");
      result += this.serialize_array(this.cgt_data.symbols, "symbol", where, serializer.symbol_serializer);
      result += serializer.between_definitions("symbol", "group");
      result += this.serialize_array(this.cgt_data.groups, "group", where, serializer.group_serializer);
      result += serializer.between_definitions("group", "dfastate");
      result += this.serialize_array(this.cgt_data.dfa_states, "dfastate", where, serializer.dfa_state_serializer);
      result += serializer.between_definitions("dfastate", "lrstate");
      result += this.serialize_array(this.cgt_data.lr_states, "lrstate", where, serializer.lr_state_serializer);
      result += serializer.between_definitions("lrstate", "dfainitial");
      result += serializer.dfa_initial_serializer.definition(this.cgt_data.dfa_init_state);
      result += serializer.between_definitions("dfainitial", "lrinitial");
      result += serializer.lr_initial_serializer.definition(this.cgt_data.lr_init_state);
      result += serializer.between_definitions("lrinitial", "rule");
      result += this.serialize_array(this.cgt_data.rules, "rule", where, serializer.rule_serializer);
      result += serializer.after_definitions(this.cgt_data, grammar_name);
    }

    return result;
  }
};
