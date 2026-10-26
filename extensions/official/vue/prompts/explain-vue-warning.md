下面是 {{project}} 项目里的一段 Vue 警告、运行时报错或 vue-tsc 类型错误，请帮我定位原因。

要求：
1. 先说明这条信息的含义（例如 `[Vue warn]: Property ... was accessed during render but is not defined`、`Hydration mismatch`、`Extraneous non-props attributes`、`Failed to resolve component`、vue-tsc 的 `TS2322` 等）。
2. 根据信息里的组件调用链或文件和行号，打开相关 `.vue` 文件确认，不要只凭报错文字猜测；注意区分模板里的错误和 `<script>` 里的错误。
3. 说明触发条件，再给最小的修复方案；类型错误不要靠 `any` 或 `@ts-ignore` 绕过。
4. 如果可能与依赖版本有关（Vue、vue-router、pinia、vite 插件版本不匹配），先查 package.json 和锁文件再下结论；不要擅自升级依赖或更换构建工具。

报错内容：

```
{{selection}}
```
