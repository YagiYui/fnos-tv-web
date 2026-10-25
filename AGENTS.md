# FNOS TV 前端维护

这是 FNOS TV 项目的前端仓库。主项目入口是同级后端 `../fnos-tv/`，两个仓库保持独立 Git 历史。

## 开始工作

- 先阅读 `LOCAL-MAINTENANCE.md` 并检查当前 Git 状态。
- 涉及后端、Nginx、部署或跨仓库修改时，读取 `../fnos-tv/AGENTS.md` 和后端维护说明，遵循其中的项目部署与回退流程。
- 正式源码在 `E:/YagiYui/Documents/Repositories/fnos-tv-web`。旧 Codex 日期目录是调试历史，NAS 挂载目录是发布目标，不应成为唯一源码来源。
- 根据当次请求执行本地修改、部署、提交与推送，并明确报告各步骤状态。用户要求界面方案先确认时，先给具体方案再实施。

## 前端约定

- 技术栈：Vue 3、Vite、Naive UI、ArtPlayer。保留既有字幕、弹幕、外部播放器、返回导航、主题和移动端播放器定制。
- 布局宽度与输入方式分开处理：宽屏平板不能仅因超过 `768px` 就失去触摸手势保护。
- 首页轮播使用 `src/components/HomeCarousel.vue`。按一屏卡片数量整页翻动，末页不足时保留列宽，分页指示位于卡片下方。
- 现有布局：窄屏继续观看 2 张、海报 3 张；宽屏分别为 4 张和 7 张。改变数量属于界面行为变更，应结合当前需求处理。
- 触摸方向锁定见 `direction-locked-swipe.js`：上下和模糊斜向手势保留滚动，明确横滑达到阈值后才翻页，不在竖滑时让卡片轻微横移。
- 触摸处理适用于所有视口宽度。通过输入能力控制鼠标箭头和拖动，实际触摸可启用分页指示；兼容混合输入设备。
- 保留横滑后的误点击保护、多指和取消处理，以及 resize、媒体查询监听的卸载清理。
- 保留合理的语义、按钮可访问名称、键盘焦点和减少动态效果设置。

## 构建与验证

- 使用现有锁文件：`pnpm install --frozen-lockfile`；不为普通界面修改主动升级依赖或更改锁文件。
- 构建命令为 `pnpm build`。Windows 构建子进程被权限限制时，按工具权限流程处理，不通过放宽项目安全设置绕过。
- PowerShell 全部前端检查：`$testFiles = Get-ChildItem -File -Filter '*.test.mjs' | Select-Object -ExpandProperty FullName; node --test $testFiles`。
- 首页手势相关检查：`node --test carousel-gesture.test.mjs carousel-interaction.test.mjs`。
- 根据改动运行必要检查。文档修改使用差异检查即可；界面代码应构建；涉及既有播放器功能时运行相应回归。
- 可选 PGS 真实素材测试依赖 `PGS_TEST_FILE`，缺少素材时应注明跳过，不将影片或字幕样本纳入 Git。
- `public/vendor` 的字幕渲染资源、字体及许可证属于发布所需资源，应保留。
- 自动化逻辑检查、构建成功和真实手机/平板上的视觉、手势体验分别报告，不宣称未经实际检查的设备效果。

## 发布、Git 与文档

- NAS 发布目标为 `/vol7/1000/docker/fnos-tv`，源码通常同步到 `patches/frontend/`、构建产物同步到 `web/`；实际挂载关系先按后端指引核对。
- 发布前备份，先上传散列资源再切换首页，保留回退版本。源码、构建产物和后端接口版本应配套。
- 按当前任务授权在本仓库 `dev` 提交并推送个人 fork 的 `origin/dev`；跨仓任务分别操作各自的 Git，不在父目录初始化新仓库合并二者。
- 保留用户已有修改，只暂存相关源码、必要回归和说明；不提交 `dist`、依赖、日志、凭据、影片素材或备份包。
- 长期维护决策和部署边界更新到 `LOCAL-MAINTENANCE.md`，操作记录避免包含敏感请求头和会话凭据。
