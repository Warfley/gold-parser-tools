/* eslint-disable @typescript-eslint/naming-convention */
import * as fs from "fs";

enum GrammarDataType {
  BOOLEAN = "B",
  EMPTY = "E",
  INT = "I",
  STRING = "S",
  BYTE = "b"
}

enum GrammarRecordType{
  // V1
    CHARSET = "C",
    DFASTATE ="D",
    INITIALSTATES = "I",
    LRSTATE ="L",
    PARAMETER = "P",
    RULE = "R",
    SYMBOL = "S",
    COUNTS = "T",
  // V5
    CHARRANGES = "c",
    GROUP = "g",
    GROUPNESTING = "n",
    PROPERTY = "p",
    COUNTS_V5 = "t",
}
