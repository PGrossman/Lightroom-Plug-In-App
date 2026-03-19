--
-- json.lua
--
-- Copyright (c) 2020 rxi
--
-- Permission is hereby granted, free of charge, to any person obtaining a copy of
-- this software and associated documentation files (the "Software"), to deal in
-- the Software without restriction, including without limitation the rights to
-- use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
-- of the Software, and to permit persons to whom the Software is furnished to do
-- so, subject to the following conditions:
--
-- The above copyright notice and this permission notice shall be included in all
-- copies or substantial portions of the Software.
--
-- THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
-- IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
-- FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
-- AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
-- LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
-- OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
-- SOFTWARE.
--

local json = { _version = "0.1.2" }

-------------------------------------------------------------------------------
-- Encode
-------------------------------------------------------------------------------

local encode

local escape_char_map = {
  [ "\\" ] = "\\\\",
  [ "\"" ] = "\\\"",
  [ "\b" ] = "\\b",
  [ "\f" ] = "\\f",
  [ "\n" ] = "\\n",
  [ "\r" ] = "\\r",
  [ "\t" ] = "\\t",
}

local escape_char_map_inv = { [ "\\/" ] = "/" }
for k, v in pairs(escape_char_map) do escape_char_map_inv[v] = k end


local function escape_char(c)
  return escape_char_map[c] or string.format("\\u%04x", string.byte(c))
end


local function encode_nil(val)
  return "null"
end


local function encode_table(val, stack)
  local res = {}
  stack = stack or {}

  -- Circular reference check
  if stack[val] then error("circular reference") end

  stack[val] = true

  if rawget(val, 1) ~= nil or next(val) == nil then
    -- Treat as array -- check keys are valid and it is not sparse
    local n = 0
    for k in pairs(val) do
      if type(k) ~= "number" then
        error("invalid table: mixed or non-number keys")
      end
      n = n + 1
    end
    if n ~= #val then
      error("invalid table: sparse array")
    end
    -- Encode
    for i, v in ipairs(val) do
      table.insert(res, encode(v, stack))
    end
    stack[val] = nil
    return "[" .. table.concat(res, ",") .. "]"

  else
    -- Treat as object
    for k, v in pairs(val) do
      if type(k) ~= "string" then
        error("invalid table: non-string key")
      end
      table.insert(res, encode(k, stack) .. ":" .. encode(v, stack))
    end
    stack[val] = nil
    return "{" .. table.concat(res, ",") .. "}"
  end
end


local function encode_string(val)
  return '"' .. val:gsub("[%z\1-\31\\l\"]", escape_char) .. '"'
end


local function encode_number(val)
  -- Check for NaN, -inf and inf
  if val ~= val or val <= -math.huge or val >= math.huge then
    error("unexpected number value '" .. tostring(val) .. "'")
  end
  return string.format("%.14g", val)
end


local type_func_map = {
  [ "nil"     ] = encode_nil,
  [ "table"   ] = encode_table,
  [ "string"  ] = encode_string,
  [ "number"  ] = encode_number,
  [ "boolean" ] = tostring,
}


encode = function(val, stack)
  local t = type(val)
  local f = type_func_map[t]
  if f then
    return f(val, stack)
  end
  error("unexpected type '" .. t .. "'")
end


function json.encode(val)
  return ( encode(val) )
end


-------------------------------------------------------------------------------
-- Decode
-------------------------------------------------------------------------------

local parse

local function create_set(...)
  local res = {}
  for i = 1, select("#", ...) do res[ select(i, ...) ] = true end
  return res
end

local space_chars   = create_set(" ", "\t", "\r", "\n")
local delim_chars   = create_set(" ", "\t", "\r", "\n", "]", "}", ",")
local escape_chars  = create_set("\\", "/", "\"", "b", "f", "n", "r", "t", "u")
local literals      = create_set("true", "false", "null")

local literal_map = {
  [ "true"  ] = true,
  [ "false" ] = false,
  [ "null"  ] = nil,
}


local function next_char(str, idx, set, neg)
  for i = idx, #str do
    if set[ str:sub(i, i) ] ~= neg then
      return i
    end
  end
  return #str + 1
end


local function decode_error(str, idx, msg)
  local line_count = 1
  local col_count = 1
  for i = 1, idx - 1 do
    col_count = col_count + 1
    if str:sub(i, i) == "\n" then
      line_count = line_count + 1
      col_count = 1
    end
  end
  error( string.format("%s at line %d col %d", msg, line_count, col_count) )
end


local function codepoint_to_utf8(n)
  -- http://www.unicode.org/faq/utf_bom.html#utf8-5
  if n <= 0x7f then
    return string.char(n)
  elseif n <= 0x7ff then
    return string.char(math.floor(n / 64) + 192, n % 64 + 128)
  elseif n <= 0xffff then
    return string.char(math.floor(n / 4096) + 224, math.floor(n / 64) % 64 + 128, n % 64 + 128)
  elseif n <= 0x10ffff then
    return string.char(math.floor(n / 262144) + 240, math.floor(n / 4096) % 64 + 128, math.floor(n / 64) % 64 + 128, n % 64 + 128)
  end
  error( string.format("invalid unicode codepoint '%x'", n) )
end


local function parse_unicode_escape(s, idx)
  local n1 = tonumber( s:sub(idx, idx + 3), 16 )
  if not n1 then
    return nil, "invalid unicode escape 'u" .. s:sub(idx, idx + 3) .. "'"
  end
  -- Check for surrogate pair
  if n1 >= 0xd800 and n1 <= 0xdbff then
    local n2 = tonumber( s:sub(idx + 6, idx + 9), 16 )
    if s:sub(idx + 4, idx + 5) == "\\u" and n2 and n2 >= 0xdc00 and n2 <= 0xdfff then
      return codepoint_to_utf8( (n1 - 0xd800) * 0x400 + (n2 - 0xdc00) + 0x10000 ), idx + 10
    else
      return nil, "invalid unicode escape 'u" .. s:sub(idx, idx + 3) .. "' (missing second half of surrogate pair)"
    end
  end
  return codepoint_to_utf8(n1), idx + 4
end


local function parse_string(str, idx)
  local res = ""
  local j = idx + 1
  while j <= #str do
    local c = str:sub(j, j)
    if c == "\"" then
      return res, j + 1
    elseif c == "\\" then
      local next = str:sub(j + 1, j + 1)
      if next == "u" then
        local val, new_idx = parse_unicode_escape(str, j + 2)
        if not val then decode_error(str, j, new_idx) end
        res = res .. val
        j = new_idx
      else
        if not escape_chars[next] then
          decode_error(str, j, "invalid escape char '" .. next .. "'")
        end
        res = res .. (escape_char_map_inv["\\" .. next] or next)
        j = j + 2
      end
    elseif string.byte(c) < 32 then
      decode_error(str, j, "control char in string")
    else
      res = res .. c
      j = j + 1
    end
  end
  decode_error(str, idx, "expected closing quote for string")
end


local function parse_number(str, idx)
  local i = next_char(str, idx, delim_chars)
  local next = str:sub(idx, i - 1)
  local res = tonumber(next)
  if not res then
    decode_error(str, idx, "invalid number '" .. next .. "'")
  end
  return res, i
end


local function parse_literal(str, idx)
  local i = next_char(str, idx, delim_chars)
  local next = str:sub(idx, i - 1)
  if not literals[next] then
    decode_error(str, idx, "invalid literal '" .. next .. "'")
  end
  return literal_map[next], i
end


local function parse_array(str, idx)
  local res = {}
  local n = 1
  idx = next_char(str, idx + 1, space_chars, true)
  local c = str:sub(idx, idx)
  if c == "]" then
    return res, idx + 1
  end
  while idx <= #str do
    res[n], idx = parse(str, idx)
    n = n + 1
    idx = next_char(str, idx, space_chars, true)
    c = str:sub(idx, idx)
    if c == "]" then
      return res, idx + 1
    end
    if c ~= "," then
      decode_error(str, idx, "expected ']' or ','")
    end
    idx = next_char(str, idx + 1, space_chars, true)
  end
  decode_error(str, idx, "unclosed array")
end


local function parse_object(str, idx)
  local res = {}
  idx = next_char(str, idx + 1, space_chars, true)
  local c = str:sub(idx, idx)
  if c == "}" then
    return res, idx + 1
  end
  while idx <= #str do
    local key
    if c ~= "\"" then
      decode_error(str, idx, "expected string for object key")
    end
    key, idx = parse_string(str, idx)
    idx = next_char(str, idx, space_chars, true)
    c = str:sub(idx, idx)
    if c ~= ":" then
      decode_error(str, idx, "expected ':' after object key")
    end
    res[key], idx = parse(str, next_char(str, idx + 1, space_chars, true))
    idx = next_char(str, idx, space_chars, true)
    c = str:sub(idx, idx)
    if c == "}" then
      return res, idx + 1
    end
    if c ~= "," then
      decode_error(str, idx, "expected '}' or ','")
    end
    idx = next_char(str, idx + 1, space_chars, true)
    c = str:sub(idx, idx)
  end
  decode_error(str, idx, "unclosed object")
end


parse = function(str, idx)
  local c = str:sub(idx, idx)
  if c == "\"" then
    return parse_string(str, idx)
  elseif c == "{" then
    return parse_object(str, idx)
  elseif c == "[" then
    return parse_array(str, idx)
  elseif create_set("-", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9")[c] then
    return parse_number(str, idx)
  else
    return parse_literal(str, idx)
  end
end


function json.decode(str)
  if type(str) ~= "string" then
    error("expected argument of type string, got " .. type(str))
  end
  local res, idx = parse(str, next_char(str, 1, space_chars, true))
  idx = next_char(str, idx, space_chars, true)
  if idx <= #str then
    decode_error(str, idx, "trailing garbage")
  end
  return res
end


return json
