---
name: ruby-project
description: 在 Ruby 项目里写代码、跑测试、修报错时使用，包括认 Bundler / Rake / RSpec / Minitest / RuboCop、识别 Ruby 版本（rbenv / asdf）。Use when working in a Ruby project: detecting Bundler, Rake, RSpec or Minitest, RuboCop, the Ruby version manager, running tests and fixing load or dependency errors.
---

# Ruby 项目工作指南

## 先认工具链，不要擅自换

1. 看根目录有什么：
   - `Gemfile` / `Gemfile.lock`：Bundler 管依赖。有 `Gemfile.lock` 就用 `bundle exec` 运行所有命令，保证用锁定的版本。
   - `*.gemspec`：这是一个 gem 库；`Gemfile` 里通常只有 `gemspec` 一行，依赖写在 gemspec 里。
   - `Rakefile`：任务入口，`bundle exec rake -T` 列出带说明的任务。
   - `spec/`、`.rspec` 是 RSpec；`test/` 是 Minitest；`.rubocop.yml` 是 RuboCop；`.standard.yml` 是 StandardRB。
   - Rails 项目还有 `config/application.rb`、`bin/rails`，用 `bin/rails` 而不是全局 `rails`。
2. 沿用项目已有的测试框架、lint 工具和依赖管理。**不要**为了方便新增 gem、升级版本或改 `Gemfile.lock`（`bundle update` 会一次升级很多依赖）；确实需要新依赖时，先说明理由，让用户确认。
3. 改依赖用 `bundle add 名字` / `bundle remove 名字`，不要手写 `Gemfile.lock`。

## 识别 Ruby 版本

- `.ruby-version`（rbenv / rvm / chruby）、`.tool-versions`（asdf / mise）、`Gemfile` 里的 `ruby "3.3.0"`、gemspec 的 `required_ruby_version`、CI 里的 `ruby-version`、`Dockerfile` 基础镜像。
- 本机实际版本用 `ruby -v`；与项目要求不一致时先告诉用户（`rbenv install` / `asdf install` 会下载编译，不要擅自跑）。
- 只使用该版本支持的语法：`Data.define` 3.2+，`it` 隐式块参数 3.4+，模式匹配 `case/in` 3.0+，`=>` 右赋值 3.0+，Hash 简写 `{x:, y:}` 3.1+，`Array#sum` 2.4+。

## 构建和验证（改完代码按这个顺序）

```
bundle install                    # 依赖没装、Gemfile 变了时
bundle exec rspec                 # RSpec
bundle exec rspec spec/models/user_spec.rb:42     # 只跑一个文件 / 一行的用例
bundle exec rake test             # Minitest（有 Rakefile 的 TestTask）
bundle exec ruby -Itest test/user_test.rb         # 只跑一个 Minitest 文件
bundle exec ruby -Itest test/user_test.rb -n test_name   # 只跑一个用例
bundle exec rubocop path/to/file.rb               # 风格检查，只查改过的文件
bundle exec rake                  # 默认任务，常常是测试 + lint
```

- 没有 `Gemfile.lock` 时去掉 `bundle exec`，直接 `rspec` / `rake test`。
- RuboCop 的自动修复：`rubocop -a`（安全修复）；`-A` 会改行为，先问用户。项目没配置 RuboCop 就不要自己引入。
- Rails 项目：`bin/rails test`、`bin/rails db:migrate`；改了 migration 先看 `db/schema.rb` 的变化是否符合预期。
- 网络不通时 `bundle install --local` 只用已缓存的 gem；依赖确实缺失时如实告诉用户，不要改 `source`。

## 测试

- 先看现有测试用 RSpec 还是 Minitest，以及有没有 FactoryBot、WebMock / VCR、Timecop 等；照现有风格写，不要混用两种框架。
- RSpec：`describe` / `context` / `it`，`let` 懒加载、`let!` 立即执行、`before`，断言 `expect(x).to eq(y)`、`raise_error`；共享用例用 `shared_examples`。
- Minitest：`class FooTest < Minitest::Test`（Rails 是 `ActiveSupport::TestCase`），方法名以 `test_` 开头，`assert_equal 期望值, 实际值`（顺序是期望在前）。
- 先看测试失败的真实原因，不要为了变绿去改断言或删测试；随机顺序下才失败的测试说明用例之间有共享状态，用 `--seed 种子` 复现。

## 常见坑

- `cannot load such file -- xxx`（LoadError）：没用 `bundle exec`，或 gem 没装、`require` 路径写错；先 `bundle check`。
- `Bundler::GemNotFound` / `Could not find gem`：`bundle install` 没跑，或 Ruby 版本不对。
- `You have already activated X, but your Gemfile requires Y`：用 `bundle exec` 运行，别用全局的 `rake` / `rspec`。
- `NoMethodError: undefined method ... for nil`：先追查 nil 的来源，不要直接加 `&.`。
- `frozen string` 报错（`FrozenError`）：文件开头有 `# frozen_string_literal: true` 时字符串字面量不可变，用 `+""`、`dup` 或 `String.new`，或改成不原地修改。
- `Gemfile.lock` 提交与否看项目：应用要提交，库项目常常不提交（`.gitignore` 里有就别加）。
- 平台相关：Windows 上原生扩展 gem 编译失败常见，如实说明报错，不要改成别的 gem。
