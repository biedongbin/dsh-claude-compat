# 2.0.0 完整产品演示制作记录

状态：**全部16段当前2.0素材已就绪，实际标记裁切已完成；正在执行完整导出，视觉验收尚待完成。** 主录制代理负责补齐安装、对话插件管理、技能执行、历史接续与总结五段素材。此前22秒新版仅展示总览的新功能，不是完整产品介绍；本版补齐完整使用链路，全部画面依据当前2.0.0，不混用1.2.1旧视频。

## 基线与范围

- 产品：dsh-claude-compat **2.0.0**，源码基线 **`3a4b9e8`**；实际录制宿主为 **DSH 0.2.2-rc.3**。
- 中英文UI分别录制，固定1440×900，交付30fps、H.264/yuv420p、SAR1:1、DAR8:5、faststart、无声。
- 动作原速、正常输入与光标移动，保留实际界面及结果；只允许按技能及总结录制的真实submit/result标记剪除模型等待，不生成UI、动画或模型回复，不加静态停留凑时长。
- 演示技能和合成历史须明确标注为fixture，不是插件内置业务能力；真实模型输出仅在主代理实际运行并确认后才可称已展示。
- 保留DSH标识和导航，遮盖私人工作区、会话、账号及绝对路径；代码和字体不拉伸。语言及视口恢复由主录制代理验证。

## 顺序与来源

| 顺序 | 场景 | 当前2.0.0素材来源 | 本阶段状态 |
|---|---|---|---|
| 1 | install | `.tmp/complete-v2-capture/{zh-CN,en}/install/` | 主代理录制，尚未收到ready确认 |
| 2 | plugins | `.tmp/complete-v2-capture/{zh-CN,en}/plugins/` | 主代理录制，尚未收到ready确认 |
| 3 | skill | `.tmp/complete-v2-capture/{zh-CN,en}/skill-good/` | 等待实际submit/result标记，再确定等待剪除区间 |
| 4 | history | `.tmp/complete-v2-capture/{zh-CN,en}/history/` | 主代理录制，handoff后结束，不补造完成状态 |
| 5 | summary | `.tmp/complete-v2-capture/{zh-CN,en}/summary/` | 只接受本轮真实接续结果 |
| 6 | overview | `.tmp/interaction-capture-v2-take2/{zh-CN,en}/overview/` | 已有当前2.0.0录制缓存 |
| 7 | drill | `.tmp/interaction-capture-v2-take2/{zh-CN,en}/drill/` | 已有当前2.0.0录制缓存 |
| 8 | viewer | `.tmp/interaction-capture-v2-take2/{zh-CN,en}/viewer/` | 已有当前2.0.0录制缓存 |

[剪辑清单](interaction-edit-complete-v2.json)按以上顺序组装。唯一输入根为`.tmp/complete-v2-source/`，各语言/场景仅以独占创建的符号链接指向表中相应当前版本目录。未录好的目标允许暂时不存在；最终构建器必须因缺少capture.json而失败，绝不从旧缓存回退。原始2.0.0录制和代码证据见[新版制作记录](v2-production.md)。

## 功能声明边界

总览是发现清单，不是运行时挂载快照。插件能力计数可下钻，搜索输入即时更新并展示筛选；文件查看器读取原文，不是编辑器。DSH开关仅过滤技能、命令和Agents，不改变Claude Code侧状态，也不卸载运行中的MCP或Hooks。翻译只影响查看，可能调用模型消耗token；没有实际执行的翻译不写成已展示。对应源码证据沿用[2.0.0分析](v2-production.md)：`src/client.js`、`src/inventory.js`及`src/translate.js`。

## 完整录制就绪后的操作

1. 主代理明确确认十个新场景缓存均已写完，再读取两语言skill的真实capture.json与marks。主代理已确认ready；已按技能与总结段的真实submit/result标记写入语言裁切，没有虚构时间码。
2. 保留首帧至`submit + 0.8秒`，再保留`result - 0.3秒`至实际录制结束；边界限制在真实首帧/结束范围，所有区间speed=1。如果区间重叠或标记缺失，停止并报告，不能猜测。
3. 更新清单ready状态和两种语言技能裁切后，确认八场景各自有capture.json，所有被选帧真实存在、尺寸一致、来源只在本记录允许的两个当前版本根下。
4. 再执行以下本地导出命令。本次已获主代理完整录制ready确认并执行导出；结果见最终机器报告。

```bash
# cwd: repository root; use the isolated existing local encoder/probe.
PATH="$PWD/.tmp/video-v2/bin:$PATH" python3 docs/demo-video/build-interactions.py \
  --lang both --render \
  --capture-root .tmp/complete-v2-source \
  --edit-manifest docs/demo-video/interaction-edit-complete-v2.json \
  --output-prefix dsh-claude-compat-2.0-complete \
  --report docs/videos/complete-v2-verification.json
```

本机现有独立工具为FFmpeg4.4和ffprobe n4.4.1，位于忽略的`.tmp/video-v2/bin/`，不依赖损坏的Homebrew FFmpeg8.1。编码器通过真实JPEG帧管道按时间轴采样，不制造插值帧。默认拒绝已有媒体；没有核对明确输出目标之前不使用`--overwrite`。旧MP4保持原样。

预期输出文件名为`docs/videos/dsh-claude-compat-2.0-complete-{zh-CN,en}.mp4`及对应`-poster.png`，机器报告为`docs/videos/complete-v2-verification.json`。这些是待产物名称，不表示文件已生成。真正完成时，逐流参数、起止时间、完整解码帧数、哈希、faststart、每段实际编码帧和正常速度播放需分别验收，不能以文件存在或元信息替代视觉检查。

原始capture.json、JPEG及聚合符号链接属于未入库缓存。干净克隆需要取得这些原始素材或重新录制，不能承诺重放同一模型回复或逐字节相同输出。本阶段未修改产品代码、未操作浏览器、未调用模型、未外部上传或发布；仅准备新清单、制作记录与隔离源目录。


## 本次完整成片与验收

- [中文完整版](../videos/dsh-claude-compat-2_0-complete-zh-CN.mp4)：60.867秒，1826完整解码帧，1.8MB。
- [English complete](../videos/dsh-claude-compat-2_0-complete-en.mp4)：64.033秒，1921完整解码帧，2.4MB。
- 封面取自各自最终编码视频安装段稳定画面：[中文](../videos/dsh-claude-compat-2_0-complete-zh-CN-poster.png)、[English](../videos/dsh-claude-compat-2_0-complete-en-poster.png)。

八个场景按顺序：安装入口 → `/cc-plugin` 管理与筛选 → `demo-brief-v2` 技能实际回复 → `/cc-resume` 预览与接续 → 接续续写结果 → Claude 桥接总览 → 能力下钻与即时搜索 → 文件查看与作用边界。全部1倍速，1440×900、30fps、H.264/yuv420p、SAR1:1、DAR8:5、faststart、无音轨。

技能段按真实 marks 裁掉模型等待（submit+0.8 至 result−0.3），回复完整保留；summary 段同样只剪等待。已打开两种语言全部八个稳定场景帧核对内容与隐私；两份视频在浏览器1倍速播放至 ended，呈现丢帧均为0，完整解码帧数分别记录。

前置编译错误已修正：构建器的场景名校验同样作用于输出前缀，点号不合法，因此最终前缀为 `dsh-claude-compat-2_0-complete`。素材失败的首拍目录保留作诊断，未参与成片。渲染前已修复 skill 场景符号链接指向成功重拍的 capture。

本轮本地交付；未更新 GitHub 附件、README 媒体引用或提交推送。录制用 Web profile 2.0.0 与任务自有 Web 服务保留在本机3080；桌面实例未改动。临时活动技能 demo-brief-v2 已删除，非活动源保留在 docs/demo-video/fixtures。
