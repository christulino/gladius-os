// JQL grammar for FlowOS search v1.
// AST node shapes:
//   Query      = { type: 'query', expr, sort: [...] }
//   And/Or     = { type: 'and'|'or', left, right }
//   Not        = { type: 'not', expr }
//   Predicate  = { type: 'predicate', field, op, value }
//   InList     = { type: 'in_list', field, values, negated }
//   IsEmpty    = { type: 'is_empty', field, negated }
//   TextMatch  = { type: 'text_match', field, value, negated }
//   FnCall     = { type: 'fn_call', name, args }
//   Lit        = { type: 'lit', dataType: 'string'|'number'|'identifier', value }
//   Sort       = { field, direction: 'ASC'|'DESC' }

{{
  function mkBinOp(left, rest, type) {
    return rest.reduce((acc, r) => ({ type, left: acc, right: r }), left)
  }
}}

Query
  = _ expr:OrExpr sort:OrderBy? _ { return { type: 'query', expr, sort: sort || [] } }
  / _ sort:OrderBy _ { return { type: 'query', expr: null, sort } }

OrExpr
  = first:AndExpr rest:(_ "OR"i _ AndExpr)* {
      const parts = rest.map(r => r[3])
      return parts.length ? mkBinOp(first, parts, 'or') : first
    }

AndExpr
  = first:NotExpr rest:(_ "AND"i _ NotExpr)* {
      const parts = rest.map(r => r[3])
      return parts.length ? mkBinOp(first, parts, 'and') : first
    }

NotExpr
  = "NOT"i _ inner:Primary { return { type: 'not', expr: inner } }
  / Primary

Primary
  = "(" _ inner:OrExpr _ ")" { return inner }
  / Predicate

Predicate
  = field:Identifier _ "IS"i _ "NOT"i _ ("EMPTY"i / "NULL"i) { return { type: 'is_empty', field, negated: true } }
  / field:Identifier _ "IS"i _ ("EMPTY"i / "NULL"i) { return { type: 'is_empty', field, negated: false } }
  / field:Identifier _ "NOT"i _ "IN"i _ "(" _ values:ValueList _ ")" { return { type: 'in_list', field, values, negated: true } }
  / field:Identifier _ "IN"i _ "(" _ values:ValueList _ ")" { return { type: 'in_list', field, values, negated: false } }
  / field:Identifier _ "!~" _ value:Value { return { type: 'text_match', field, value, negated: true } }
  / field:Identifier _ "~" _ value:Value { return { type: 'text_match', field, value, negated: false } }
  / field:Identifier _ op:Operator _ value:Value { return { type: 'predicate', field, op, value } }

Operator = "<=" / ">=" / "!=" / "=" / "<" / ">"

ValueList
  = first:Value rest:(_ "," _ Value)* { return [first, ...rest.map(r => r[3])] }

Value
  = String
  / Number
  / FnCall
  / id:Identifier { return { type: 'lit', dataType: 'identifier', value: id } }

FnCall
  = name:Identifier "(" _ args:ArgList? _ ")" { return { type: 'fn_call', name, args: args || [] } }

ArgList
  = first:Value rest:(_ "," _ Value)* { return [first, ...rest.map(r => r[3])] }

OrderBy
  = _ "ORDER"i _ "BY"i _ first:SortTerm rest:(_ "," _ SortTerm)* { return [first, ...rest.map(r => r[3])] }

SortTerm
  = field:Identifier _ dir:("ASC"i / "DESC"i)? { return { field, direction: (dir || 'ASC').toUpperCase() } }

String
  = "\"" chars:DQChar* "\"" { return { type: 'lit', dataType: 'string', value: chars.join('') } }
  / "'"  chars:SQChar* "'"  { return { type: 'lit', dataType: 'string', value: chars.join('') } }

DQChar = "\\\\" { return "\\" } / "\\\"" { return '"' } / [^"]
SQChar = "\\\\" { return "\\" } / "\\'"  { return "'" } / [^']

Number = $("-"? [0-9]+ ("." [0-9]+)?) { return { type: 'lit', dataType: 'number', value: parseFloat(text()) } }

Identifier = $([a-zA-Z_][a-zA-Z0-9_]*)

_ = [ \t\r\n]*
