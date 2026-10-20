# 本地维护说明

此仓库于 2026-10-20 从 YagiYui/fnos-tv-web 干净克隆，并迁入本次会话的定制源码。

- 当前工作分支：`dev`，迁入基线：`084773748c793176b1cc29723df37d2a304a1208`。
- `origin` 指向个人 fork；`upstream` 指向 thshu/fnos-tv-web。
- 前后端分别维护，另一个仓库位于同级目录。定制修改维护在 dev 分支，后续提交推送到个人 fork 的 origin/dev。
- 原始调试目录保留于 `E:/YagiYui/Documents/Codex/2026-10-19/new-chat/work/fnos-tv-debug/fnos-tv-web/thshu-fnos-tv-web-0847737`；这是历史来源，今后应在本仓库修改。
- 运行数据、账号凭据、临时播放票据、node_modules、dist 和历史部署压缩包不纳入源码迁移。
- public/vendor 内的字幕渲染资源、字体及许可证属于必要发布资源，已保留。

## 验证与发布边界

前端可用锁文件安装依赖：`pnpm install --frozen-lockfile`，再执行 `node --test *.test.mjs` 和 `pnpm build`（PowerShell 需先展开测试文件列表）。后端标准库测试见 tests/README.md。

初次迁移只同步了本地源码，未修改 NAS、构建发布镜像或推送 GitHub。生产部署仍在 `/vol7/1000/docker/fnos-tv`，不能直接用上游镜像更新来覆盖定制配置。后续需配套前后端版本构建和部署，并保留回退版本。

当前后端 Dockerfile 仍来自上游；它尚未整合生产中额外安装的 FFmpeg、字体、前端构建和 Compose 私有 tmpfs 等配置，不能把直接构建此仓库视作现有生产环境的完整复现。

PGS 真实素材测试为可选项：设置 `PGS_TEST_FILE` 指向本地 `.sup` 后运行 `node --test pgs-decoder.test.mjs`。默认跳过，不把影片字幕素材纳入 Git；测试不再向仓库外写预览文件。

构建工具安装策略仅允许 esbuild 的必要安装脚本（pnpm-workspace.yaml），避免新版 pnpm 生成未完成的审批模板后使 install/build 退出失败。没有放开其他依赖脚本。

## 2026-10-20 首页分页与触摸手势

首页轮播按当前布局的卡片数量分组翻页：窄屏继续观看每页 2 张、海报每页 3 张；宽屏分别为 4 张和 7 张。触摸端的分页圆点位于卡片下方，当前页以短条高亮，超过 7 页显示数字页码。

触摸输入与视口宽度分离，所有宽度下均禁用轮播原生触摸拖动，使用方向锁定和距离阈值，松手后翻一整页；竖向及模糊斜向手势保留页面滚动。鼠标能力决定箭头和鼠标拖动，实际触摸可启用分页指示；横滑后短暂拦截点击以避免打开影片。相关媒体查询监听在卸载时清理。

新增 `carousel-gesture.test.mjs` 与 `carousel-interaction.test.mjs`，覆盖方向锁定、翻页阈值、宽屏触摸、卡片分组、鼠标能力和监听清理。前端已构建并同步到 NAS 持久化源码及静态目录，未重启容器；真实手机及平板的视觉和手感仍以人工体验为准。
