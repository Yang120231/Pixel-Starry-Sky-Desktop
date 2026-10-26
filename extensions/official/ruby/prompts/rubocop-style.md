请按项目的 RuboCop 配置整理下面这段 {{language}} 代码（文件 {{file}}）：

```ruby
{{selection}}
```

要求：
1. 先读项目根目录的 `.rubocop.yml`（以及 `.rubocop_todo.yml`、它继承的配置），按里面启用的规则整理；没有配置时按 RuboCop 默认风格，不要引入新规则或新依赖。
2. 只改风格，不改行为：引号、缩进、行宽、卫语句、`&.`、Hash 简写、`frozen_string_literal` 等；改动前后的返回值和副作用必须一致。
3. 能运行时用 `bundle exec rubocop 文件路径`（没有 Gemfile.lock 就直接 `rubocop`）确认没有新增违规，把结果告诉我；某条规则确实不该遵守时，说明理由，不要随手加 `rubocop:disable`。
