# 2.0.0 演示制作任务书

目标：基于当前项目 2.0.0（源码基线 `3a4b9e8`）录制新的中英文真实操作短片，面向首次接触插件的开发者。沿用已确定的完整 DSH 导航、原速操作、剪去等待、稳定阅读时间与无声字幕方案；不采用被否决的概念图或截图轮播。

## 本轮方案

复用已执行过的 Tabbit CDP 录制和本地 FFmpeg 合成链。新素材写入 `.tmp/interaction-capture-v2/`，最终媒体使用 `dsh-claude-compat-v2-interactive` 前缀，旧版不覆盖。画面固定 1440×900、30fps、SAR1:1；原预估35–50秒；实际有效操作约22–23秒，以真实有效操作为准，不按固定时长补空画面。工具预算45次往返、30分钟，后台单次等待不超过60秒。

## 产品证据与画面

| 场景 | 实际操作与结果 | 对应源码 | 文案边界 |
|---|---|---|---|
| overview | DSH 主窗口进入 Claude 桥接总览，展示三栏分类与项目发现清单 | `src/client.js:1497–1509`、`src/inventory.js:353` | 发现清单不代表运行时挂载成功 |
| drill | 选中插件，点击能力计数下钻；输入搜索，展示当前筛选并清除 | `src/client.js:903–913`、`src/client.js:1137` | 插件提供的声明与有效候选分开 |
| viewer | 选择公开项目技能/命令，打开实际文件查看器，返回详情 | `src/client.js:803–862`、`src/inventory.js:438` | 文件查看不是编辑器；不展示私人正文 |

如能在隔离演示文件上安全操作，可补充 DSH 开关；仅控制技能、命令与 Agents 的注入，不改变 Claude Code 开关或运行中的 MCP/Hooks（`src/client.js:918–923`、`src/inventory.js:418`）。默认不动真实用户条目。

翻译原文件不变，目标为当前 DSH 界面语言，围栏代码块不送翻译提供方；缓存按原文与目标语言区分。缺少服务时可能逐段调用默认模型产生费用（`src/translate.js`）。本轮未单独授权模型翻译费用时不触发翻译，不能用伪造译文替代真实功能。

## 环境与授权

用户允许启动独立 Web 录制实例，并允许针对实际缺失的编码器补齐依赖。既有 Web profile 安装包仍为1.2.1，本轮以仓库打包的2.0.0替换其本地包并重启任务自有进程。未修改桌面实例。FFmpeg8.1缺少x265动态库，本轮采用临时目录独立工具，不改系统动态库链接。

录制只用已授权页面；私人项目/会话树、账号和绝对路径遮盖。界面原语言与视口在录制后恢复。最终交付前必须检查实际源帧、编码场景帧、媒体规格、完整解码和正常速度播放。原始缓存不随仓库分发时，需记录干净克隆无法直接重放。

## 完成状态

已实际录制两种语言的三个场景：`overview`（总览与插件详情）、`drill`（能力下钻与即时搜索）、`viewer`（原文件查看及作用边界）。六段均固定1440×900、原速、无模型调用，输入源目录为 `.tmp/interaction-capture-v2-take2/{zh-CN,en}/{scene}/`。先前失败的拍摄目录保留作诊断，不参与成片。

旧命令行运行时0.2.2-rc.1加载新版客户端时显示 `web boot: 1 entry did not activate / dsh-claude-compat: failed`。本轮未修改产品代码绕过；改为使用本机桌面应用已安装的0.2.2-rc.3运行时启动独立Web服务，随后真实总览正常工作。此观察不扩大源码中已声明的兼容验证范围，也不证明旧宿主失败的具体根因已修复。

媒体工具安装在忽略目录 `.tmp/video-v2/`：`@ffmpeg-installer/darwin-arm64@4.1.5`提供FFmpeg4.4，`@ffprobe-installer/darwin-arm64@5.0.1`提供ffprobe n4.4.1。原Homebrew安装未修改。imageio-ffmpeg0.6.0下载停滞后已取消，未使用其产物。旧FFmpeg8.1仍有动态库问题，不称其已修复。

可编辑动作见[录制模块](record-v2.mjs)，剪辑见[新版清单](interaction-edit-v2.json)，构建器见[本地导出入口](build-interactions.py)。本轮执行命令（cwd为项目根目录）：

```bash
PATH="$PWD/.tmp/video-v2/bin:$PATH" python3 docs/demo-video/build-interactions.py \
  --lang both --render \
  --capture-root .tmp/interaction-capture-v2-take2 \
  --edit-manifest docs/demo-video/interaction-edit-v2.json \
  --output-prefix dsh-claude-compat-v2-interactive \
  --report docs/videos/interaction-verification-v2.json
```

录制辅助模块需要Tabbit的已认证 `context/page`，不是一键登录脚本。初始空白界面、插件列表和搜索状态先通过真实UI恢复，再录制；不替换页面数据或伪造结果。公开的superpowers插件及brainstorming技能只作为文件查看示例，未执行该技能。所有开关、回写、卸载、回收站及翻译按钮均未触发。

完成后已验证页面为中文、视口1904×889、录制覆盖层为0；Tabbit任务已释放，用户页签保留。最终媒体检查结果见[机器验证记录](../videos/interaction-verification-v2.json)。原始JPEG及capture.json只保存在忽略缓存中，干净克隆需要重新采集或取得该素材缓存才能重剪；没有承诺跨机器逐像素或逐字节一致。


## 本次成片与验收

- [中文2.0.0视频](../videos/dsh-claude-compat-v2-interactive-zh-CN.mp4)：22.333秒，670完整解码帧。
- [English 2.0.0 video](../videos/dsh-claude-compat-v2-interactive-en.mp4)：23.033秒，691完整解码帧。
- [中文封面](../videos/dsh-claude-compat-v2-interactive-zh-CN-poster.png)与[英文封面](../videos/dsh-claude-compat-v2-interactive-en-poster.png)取自各自最终编码视频总览段的稳定画面。

所有片段1倍速，1440×900、30fps、H.264/yuv420p、SAR1:1、DAR8:5、faststart，无音轨。已核对输入帧尺寸、最终视频SHA-256、元信息及完整解码计数；打开六个最终场景帧，另抽取稳定结果帧。两份视频在浏览器1倍速播放至ended；中文呈现丢帧0、英文呈现丢帧4，与完整解码计数分别记录，不混为一谈。

FFmpeg4.4的concat解析器不支持旧清单中的`option framerate`，因此当前构建器将实际时间轴中的源JPEG按交付30fps采样送入MJPEG管道。没有生成光流、虚构结果或非等比拉伸。旧版CLI参数默认值保持不变，新版明确使用独立目录和前缀。重复或丢弃的都是实际捕获帧。

本轮生成本地新版视频与制作源，未覆盖或上传旧版媒体，未更新GitHub附件、发布外部页面或提交推送。未调用真实模型翻译、配音、配乐、图片或视频生成服务。录制用Web profile升级至2.0.0，任务自有Web服务留在本机3080；桌面实例未改动。
