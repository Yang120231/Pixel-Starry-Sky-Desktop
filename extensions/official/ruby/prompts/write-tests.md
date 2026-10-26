请为下面这段 {{language}} 代码写测试，代码在 {{file}}（项目 {{project}}）：

```ruby
{{selection}}
```

要求：
1. 先看项目用的是 RSpec（有 `spec/`、`.rspec`）还是 Minitest（有 `test/`），沿用已有的目录、命名、`spec_helper` / `test_helper` 和已有的 mock 库，不要新装测试库，也不要混用两种框架。
2. 覆盖正常路径、边界值和出错路径（用 `raise_error` / `assert_raises` 断言异常）；输入输出有多组时用循环生成用例或 `shared_examples`，不要复制粘贴。
3. 一个用例只验证一件事，描述写清场景；不要 stub 被测对象本身，只替换网络、时间、文件系统这类外部依赖。
4. 写完后用项目自己的方式运行（有 Gemfile.lock 时加 `bundle exec`，例如 `bundle exec rspec 测试文件路径` 或 `bundle exec rake test`），把结果告诉我；如果发现被测代码本身有问题，先说明，不要悄悄改它。
