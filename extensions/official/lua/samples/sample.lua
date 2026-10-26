-- 示例：覆盖注释、字符串、数字、关键字、函数、表和元表
local M = {}

--[[ 多行注释
  可以写很多行 ]]
local VERSION = "1.0.0"
local MAX = 0xFF + 1e3 + 3.14
local long = [==[
长字符串 ]] 里面可以有括号
]==]

---@class Account
---@field name string
---@field balance number
local Account = {}
Account.__index = Account

function Account.new(name, balance)
  local self = setmetatable({}, Account)
  self.name = name
  self.balance = balance or 0
  return self
end

function Account:deposit(amount)
  if type(amount) ~= "number" or amount <= 0 then
    error("invalid amount: " .. tostring(amount))
  end
  self.balance = self.balance + amount
  return self.balance
end

function Account:__tostring()
  return string.format("%s: %.2f", self.name, self.balance)
end

local function map(list, fn)
  local out = {}
  for i, v in ipairs(list) do
    out[#out + 1] = fn(v, i)
  end
  return out
end

local function fib(n)
  if n < 2 then
    return n
  elseif n == 2 then
    return 1
  else
    return fib(n - 1) + fib(n - 2)
  end
end

local config = {
  name = "demo",
  retries = 3,
  tags = { "a", "b", 'c' },
  nested = { enabled = true, handler = nil },
  ["key with space"] = 42,
}

local i = 0
while i < 3 do
  i = i + 1
  goto continue
  print("skipped")
  ::continue::
end

repeat
  i = i - 1
until i <= 0 or not config.nested.enabled

for key, value in pairs(config) do
  print(key, value, #tostring(value))
end

local ok, err = pcall(function()
  local acct = Account.new("alice", 10)
  acct:deposit(5)
  print(acct, 7 // 2, 5 % 3, 1 << 4, ~0, "a" .. "b")
end)
if not ok then
  io.stderr:write("failed: ", err, "\n")
end

M.fib = fib
M.map = map
M.Account = Account
M.version = VERSION
M.max = MAX
M.long = long

return M
