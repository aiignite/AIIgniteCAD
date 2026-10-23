# AI 提示词示例

以下指令适用于已配置模型后的右侧 AI 面板。模型支持 Function Calling 时会直接返回对应工具调用；否则后端会降级解析文本 JSON。

## 绘图

```text
画一条从原点出发、长度 200 的水平线。
```

对应工具：`draw_line`

```text
画一个宽 120、高 80 的矩形，左下角在 (50, 50)。
```

对应工具：`draw_rectangle`

```text
在坐标 (300, 200) 画一个半径 40 的圆。
```

对应工具：`draw_circle`

```text
用多段线画一个 L 形：从 (0,0) 到 (100,0)，再到 (100,50)，最后到 (150,50)。
```

对应工具：`draw_polyline`

```text
在 (20, -20) 写文字 "AIIgniteCAD"。
```

对应工具：`draw_text`

## 编辑

```text
把选中的图形向右移动 50、向上移动 20。
```

对应工具：`move_elements`（未显式提供 ids 时作用于当前选择集）

```text
将选中的图形绕其中心旋转 45 度。
```

对应工具：`rotate_elements`

```text
复制选中的对象，并放到右侧 120 的位置。
```

对应工具：`copy_elements`

```text
以 x = 100 为对称轴镜像选中的对象。
```

对应工具：`mirror_elements`

```text
删除最后绘制的图形。
```

对应工具：`delete_last`

```text
清空画布。
```

对应工具：`clear_canvas`

## 组合任务

```text
画一个 200×120 的矩形，在矩形中心画一个半径 30 的圆，然后把圆向上移动 10。
```

AI 应依次产生 `draw_rectangle`、`draw_circle`、`move_elements` 三个工具调用。

## 失败与降级

- 模型不支持工具调用时，会输出包含 `elements` / `operation` 的 JSON；前端仍会解析并应用。
- 参数缺失或非法（例如半径为负数）时该调用被忽略，画布不会进入不一致状态。
- 未配置模型或网络失败时，文本对话会报错，但绘图、DXF 与本地保存不受影响。

## 调试

后端开启 `LOG_LEVEL=debug` 后可看到工具名与参数键（不会记录密钥）。指标端点：

```bash
curl http://localhost:3225/api/metrics | jq '.counters | with_entries(select(.key | startswith("ai.")))'
```
